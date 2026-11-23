/**
 * HTTP helpers shared by provider adapters.
 *
 * PRIVACY INVARIANT: errors may include the provider label, HTTP status, and at
 * most 300 characters of the response body. Never include headers, keys, or the
 * request body.
 */

const ERROR_BODY_MAX_CHARS = 300;

export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
}

/** Appends `path` unless the base URL already ends with it. */
export function buildEndpoint(baseUrl, path) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error('Provider base URL is required.');
  return base.endsWith(path) ? base : `${base}${path}`;
}

/** Parses Go-style durations used by OpenAI-compatible rate-limit headers: `1s`, `250ms`, `6m0s`, `1h2m`. */
function parseDuration(value) {
  const text = String(value || '').trim();
  if (!/^(\d+(\.\d+)?(ms|h|m|s))+$/.test(text)) return null;
  const units = { h: 3_600_000, m: 60_000, s: 1000, ms: 1 };
  let total = 0;
  for (const [, amount, , unit] of text.matchAll(/(\d+(\.\d+)?)(ms|h|m|s)/g)) total += Number(amount) * units[unit];
  return total;
}

/**
 * Milliseconds the provider asks us to wait, from `Retry-After` (seconds or HTTP date) or common
 * OpenAI-/Anthropic-compatible reset headers. Returns null when no hint is present.
 */
export function retryAfterMs(headers, now = Date.now()) {
  const get = (name) => headers?.get?.(name) ?? null;
  const retryAfter = get('retry-after');
  if (retryAfter !== null) {
    if (/^\d+(\.\d+)?$/.test(retryAfter.trim())) return Math.ceil(Number(retryAfter) * 1000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  // Reset hints per bucket. Prefer buckets reported as exhausted (remaining 0); a bucket with quota
  // left (for example a daily token budget) must not stretch the wait for a per-minute request limit.
  const hints = [];
  const buckets = [
    ['x-ratelimit-remaining-requests', 'x-ratelimit-reset-requests', parseDuration],
    ['x-ratelimit-remaining-tokens', 'x-ratelimit-reset-tokens', parseDuration],
    ['anthropic-ratelimit-requests-remaining', 'anthropic-ratelimit-requests-reset', resetDateDelay],
    ['anthropic-ratelimit-tokens-remaining', 'anthropic-ratelimit-tokens-reset', resetDateDelay]
  ];
  for (const [remainingHeader, resetHeader, parse] of buckets) {
    const delay = parse(get(resetHeader), now);
    if (delay !== null) hints.push({ delay, exhausted: get(remainingHeader)?.trim() === '0' });
  }
  if (!hints.length) return null;
  const exhausted = hints.filter((hint) => hint.exhausted);
  const delays = (exhausted.length ? exhausted : hints).map((hint) => hint.delay);
  return Math.ceil(exhausted.length ? Math.max(...delays) : Math.min(...delays));
}

function resetDateDelay(value, now) {
  const date = Date.parse(value || '');
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Provider HTTP failure. Carries status and retry hint for the rate limiter; message follows the privacy invariant. */
export class ProviderHttpError extends Error {
  constructor(message, { status, retryAfterMs: retryAfter = null } = {}) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.retryAfterMs = retryAfter;
  }
}

export async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderHttpError(`${label} failed (${response.status}): ${body.slice(0, ERROR_BODY_MAX_CHARS)}`, {
        status: response.status,
        retryAfterMs: retryAfterMs(response.headers)
      });
    }
    return response;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${label} timed out. Try a faster model or check the provider endpoint.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, options, timeoutMs, label) {
  const response = await fetchWithTimeout(url, options, timeoutMs, label);
  try {
    return await response.json();
  } catch (_) {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

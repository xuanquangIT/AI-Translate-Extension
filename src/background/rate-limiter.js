/**
 * Per-provider request scheduler for free-tier rate limits (RPM/TPM).
 *
 * - At most LIMITS.PROVIDER_MAX_CONCURRENCY requests per provider run at once; others queue.
 * - A 429 (or 503) blocks the whole provider until the server's retry hint (or exponential backoff)
 *   elapses, so queued requests wait instead of hammering the API, then retries the same request.
 * - If the provider asks to wait longer than LIMITS.RATE_LIMIT_MAX_WAIT_MS, or retries run out, the
 *   error is rethrown so `withFallback` can try another model.
 *
 * State is in memory: an MV3 worker restart simply starts with a clean slate.
 */

import { LIMITS } from '../shared/config.js';

const RETRYABLE_STATUS = new Set([429, 503]);
const providers = new Map();

const defaultClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};

function stateFor(key) {
  if (!providers.has(key)) providers.set(key, { active: 0, waiters: [], blockedUntil: 0 });
  return providers.get(key);
}

export function isRetryableError(error) {
  return RETRYABLE_STATUS.has(Number(error?.status));
}

export class RateLimitedError extends Error {
  constructor(message, { retryAfterMs = null, cause } = {}) {
    super(message, { cause });
    this.name = 'RateLimitedError';
    this.status = 429;
    this.retryAfterMs = retryAfterMs;
  }
}

function backoffDelay(attempt, error, random) {
  const hinted = Number(error?.retryAfterMs);
  if (Number.isFinite(hinted) && hinted > 0) return hinted + 250;
  const base = LIMITS.RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
  return Math.round(base * (0.8 + random() * 0.4));
}

async function acquire(state, maxConcurrent) {
  while (state.active >= maxConcurrent) await new Promise((resolve) => state.waiters.push(resolve));
  state.active += 1;
}

function release(state) {
  state.active -= 1;
  state.waiters.shift()?.();
}

/**
 * Runs `job` under the provider's concurrency limit, retrying rate-limit responses.
 * @template T
 * @param {string} key provider id
 * @param {() => Promise<T>} job
 * @returns {Promise<T>}
 */
export async function withRateLimit(
  key,
  job,
  {
    maxConcurrent = LIMITS.PROVIDER_MAX_CONCURRENCY,
    maxRetries = LIMITS.RATE_LIMIT_MAX_RETRIES,
    maxWaitMs = LIMITS.RATE_LIMIT_MAX_WAIT_MS,
    clock = defaultClock,
    random = Math.random
  } = {}
) {
  const state = stateFor(key);
  let attempt = 0;
  for (;;) {
    const wait = state.blockedUntil - clock.now();
    if (wait > maxWaitMs) {
      throw new RateLimitedError(`The provider is rate limited for ${Math.ceil(wait / 1000)}s.`, {
        retryAfterMs: wait
      });
    }
    if (wait > 0) await clock.sleep(wait);

    await acquire(state, maxConcurrent);
    if (state.blockedUntil > clock.now()) {
      // Another request hit a rate limit while this one queued for a slot: wait again instead of firing.
      release(state);
      continue;
    }
    try {
      return await job();
    } catch (error) {
      if (!isRetryableError(error)) throw error;
      const delay = backoffDelay(attempt, error, random);
      state.blockedUntil = Math.max(state.blockedUntil, clock.now() + delay);
      if (attempt >= maxRetries || delay > maxWaitMs) {
        throw new RateLimitedError(`${error.message} (rate limited; retries exhausted)`, {
          retryAfterMs: delay,
          cause: error
        });
      }
      attempt += 1;
    } finally {
      release(state);
    }
  }
}

/** Test helper: forget all provider state. */
export function resetRateLimiter() {
  providers.clear();
}

/**
 * Translation use cases: single text and one page batch. Owns cache, history,
 * instruction merging, and fallback. Provider HTTP lives in `src/translation`.
 */

import { LIMITS } from '../shared/config.js';
import { sanitizeIncomingText, sanitizeTranslatedText } from '../shared/text.js';
import { addTranslationHistory, getCombinedInstructions, loadSettingsWithSession } from '../storage/index.js';
import { translateBatchWithProvider, translateWithProvider } from '../translation/translate.js';
import { resolveModel, withFallback } from './model-resolution.js';
import { storageReady } from './storage-ready.js';
import { isRetryableError, withRateLimit } from './rate-limiter.js';
import {
  dedupe,
  getCachedTranslation,
  getCachedTranslations,
  setCachedTranslation,
  setCachedTranslations,
  translationCacheKey
} from './translation-cache.js';

async function combinedInstructions() {
  return String((await getCombinedInstructions()) || '')
    .trim()
    .slice(0, LIMITS.INSTRUCTIONS_MAX_CHARS);
}

function truncate(text) {
  return text.slice(0, LIMITS.HISTORY_TEXT_MAX_CHARS);
}

export async function translateSingleText({ text, fromLang, toLang, model, modelProvider, skipCache = false } = {}) {
  await storageReady;
  const source = sanitizeIncomingText(text);
  if (source.length < LIMITS.MIN_SELECTION_CHARS) throw new Error('Select at least two characters to translate.');

  const settings = await loadSettingsWithSession();
  const resolved = await resolveModel({ model, modelProvider });
  const options = {
    text: source,
    fromLang: fromLang || settings.fromLang,
    toLang: toLang || settings.toLang,
    model: resolved.model,
    modelProvider: resolved.provider.id,
    systemPrompt: settings.systemPrompt,
    styleInstruction: await combinedInstructions()
  };

  const key = translationCacheKey(options);
  if (!skipCache) {
    const cached = await getCachedTranslation(key);
    if (cached) return cached;
  }

  return dedupe(key, async () => {
    const attempted = await withFallback(resolved, ({ provider, model: modelId }) =>
      withRateLimit(provider.id, () => translateWithProvider({ ...options, provider, model: modelId }))
    );
    const translation = sanitizeTranslatedText(attempted.result, source);
    if (!translation) throw new Error('The provider returned an empty translation.');
    await setCachedTranslation(key, translation);
    await addTranslationHistory({
      sourceText: truncate(source),
      translation: truncate(translation),
      fromLang: options.fromLang,
      toLang: options.toLang,
      model: `${attempted.used.provider.name}: ${attempted.used.model}`
    });
    return translation;
  });
}

function cleanSegments(segments) {
  const seen = new Set();
  return (Array.isArray(segments) ? segments : [])
    .filter((segment) => {
      const valid =
        segment &&
        typeof segment.id === 'string' &&
        typeof segment.text === 'string' &&
        segment.text.trim() &&
        !seen.has(segment.id);
      if (valid) seen.add(segment.id);
      return valid;
    })
    .slice(0, LIMITS.PAGE_SEGMENTS_PER_REQUEST)
    .map((segment) => ({ id: segment.id, text: segment.text.trim().slice(0, LIMITS.PAGE_SEGMENT_MAX_CHARS) }));
}

/** One provider attempt for page segments, plus one follow-up request for IDs the model skipped. */
async function translateSegmentsWith({ provider, model }, options, segments) {
  const call = (batch) =>
    withRateLimit(provider.id, () =>
      translateBatchWithProvider({ ...options, segments: batch, provider, model, partial: true })
    );
  const translated = new Map();
  const first = await call(segments);
  first.translations.forEach((item) => translated.set(item.id, item.text));

  // Re-ask only for skipped IDs; an answer-shaped reply would just be rejected again.
  const rejected = new Set(first.rejectedIds || []);
  const missing = segments.filter((segment) => !translated.has(segment.id) && !rejected.has(segment.id));
  if (missing.length && translated.size) {
    const retry = await call(missing).catch(() => null);
    retry?.translations.forEach((item) => translated.set(item.id, item.text));
  }
  if (!translated.size) throw new Error(`${provider.name} returned no usable page translations.`);
  return translated;
}

/**
 * Translates one batch of `{ id, text }` page segments. Served from the session cache where possible,
 * the rest in one rate-limited provider request (with fallback). Partial success is a success: segments
 * the provider could not translate are listed in `failedIds` and stay untranslated on the page. When every
 * model is rate limited, the batch resolves with `retryAfterMs` so the caller can pause and retry.
 * @returns {Promise<{ translations: {id: string, text: string}[], failedIds: string[], retryAfterMs?: number }>}
 */
export async function translatePage({ fromLang, toLang, model, modelProvider, segments } = {}) {
  await storageReady;
  const batch = cleanSegments(segments);
  if (!batch.length) throw new Error('No page text is available to translate.');

  const settings = await loadSettingsWithSession();
  const resolved = await resolveModel({ model, modelProvider });
  const options = {
    fromLang: fromLang || settings.fromLang,
    toLang: toLang || settings.toLang,
    systemPrompt: settings.systemPrompt,
    styleInstruction: await combinedInstructions()
  };
  const keyFor = (text) =>
    translationCacheKey({ ...options, text, model: resolved.model, modelProvider: resolved.provider.id });

  const keys = new Map(batch.map((segment) => [segment.id, keyFor(segment.text)]));
  const cached = await getCachedTranslations([...keys.values()]);
  const result = new Map();
  for (const segment of batch) {
    const hit = cached.get(keys.get(segment.id));
    if (hit) result.set(segment.id, hit);
  }

  const misses = batch.filter((segment) => !result.has(segment.id));
  let retryAfterMs = null;
  if (misses.length) {
    // Track rate limiting so a batch where every model is throttled is reported as "try again later"
    // (the content script pauses) instead of as a hard failure.
    const throttle = { attempts: 0, limited: 0, waitMs: Infinity };
    const attempt = async (candidate) => {
      throttle.attempts += 1;
      try {
        return await translateSegmentsWith(candidate, options, misses);
      } catch (error) {
        if (isRetryableError(error)) {
          throttle.limited += 1;
          throttle.waitMs = Math.min(throttle.waitMs, Number(error.retryAfterMs) || LIMITS.RATE_LIMIT_BASE_DELAY_MS);
        }
        throw error;
      }
    };
    try {
      const attempted = await withFallback(resolved, attempt);
      const fresh = new Map();
      for (const [id, text] of attempted.result) {
        result.set(id, text);
        fresh.set(keys.get(id), text);
      }
      await setCachedTranslations(fresh);
    } catch (error) {
      if (!throttle.attempts || throttle.limited < throttle.attempts) throw error;
      retryAfterMs = Math.ceil(throttle.waitMs);
    }
  }

  return {
    translations: batch.filter((segment) => result.has(segment.id)).map((s) => ({ id: s.id, text: result.get(s.id) })),
    failedIds: batch.filter((segment) => !result.has(segment.id)).map((segment) => segment.id),
    ...(retryAfterMs !== null && { retryAfterMs })
  };
}

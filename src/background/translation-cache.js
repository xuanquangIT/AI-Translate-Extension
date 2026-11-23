/** Session-scoped single-translation cache plus in-flight request deduplication. */

import { LIMITS, TRANSLATION_CACHE_PREFIX } from '../shared/config.js';
import { stableHash } from '../shared/text.js';

const FIELD_SEPARATOR = '\u241f';
const inFlight = new Map();

/** Cache key covers every input that changes the output. Never include API keys. */
export function translationCacheKey({ text, fromLang, toLang, model, modelProvider, systemPrompt, styleInstruction }) {
  const fields = [text, fromLang, toLang, model, modelProvider, systemPrompt, styleInstruction];
  return `${TRANSLATION_CACHE_PREFIX}${stableHash(fields.join(FIELD_SEPARATOR))}`;
}

export async function getCachedTranslation(key) {
  const entry = (await chrome.storage.session.get([key]))[key];
  return entry && Date.now() - entry.at < LIMITS.TRANSLATION_CACHE_TTL_MS ? entry.text : null;
}

export async function setCachedTranslation(key, text) {
  await chrome.storage.session.set({ [key]: { text, at: Date.now() } });
}

/** Batch lookup. @returns {Map<string, string>} key → cached translation (fresh entries only). */
export async function getCachedTranslations(keys) {
  if (!keys.length) return new Map();
  const entries = await chrome.storage.session.get([...new Set(keys)]);
  const now = Date.now();
  const hits = new Map();
  for (const [key, entry] of Object.entries(entries)) {
    if (entry && now - entry.at < LIMITS.TRANSLATION_CACHE_TTL_MS) hits.set(key, entry.text);
  }
  return hits;
}

/** Batch write. Best effort: a full session quota must not fail the translation. */
export async function setCachedTranslations(map) {
  if (!map.size) return;
  const at = Date.now();
  const values = Object.fromEntries([...map].map(([key, text]) => [key, { text, at }]));
  await chrome.storage.session.set(values).catch(() => {});
}

/** Runs `job` once per key; concurrent callers with the same key share the promise. */
export async function dedupe(key, job) {
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = job();
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

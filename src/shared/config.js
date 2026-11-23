/**
 * Shared configuration for the provider-agnostic translation runtime.
 *
 * Pure module: no `chrome.*`, DOM, or network access. Safe to import from the
 * service worker, extension pages, and Node tests.
 */

export const API_TYPES = Object.freeze({
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic'
});

export const API_TYPE_LABELS = Object.freeze({
  [API_TYPES.OPENAI]: 'OpenAI-compatible',
  [API_TYPES.ANTHROPIC]: 'Anthropic-compatible'
});

export const DISPLAY_MODES = Object.freeze({
  BADGE: 'badge',
  REPLACE: 'replace'
});

export const DEFAULT_SYSTEM_PROMPT = [
  'You are a precise translation engine.',
  'Translate from {{sourceLanguage}} to {{targetLanguage}}.',
  'Return only the translated text. Do not add labels, explanations, notes, markdown fences, or analysis.',
  'Preserve meaning, tone, proper names, URLs, code-like tokens, punctuation, and line breaks.',
  'Keep the output formatting as close to the source as possible.'
].join('\n');

/** Durable defaults stored in `chrome.storage.local`. See docs/CONTRACTS.md. */
export const DEFAULTS = Object.freeze({
  model: '',
  modelProvider: '',
  favoriteModels: [],
  providers: [],
  fromLang: 'auto',
  toLang: 'vi',
  rememberKey: true,
  instructions: [],
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  translationDisplayMode: DISPLAY_MODES.BADGE,
  enableSelection: true
});

/** Runtime limits. Changing one is a behavior change: update docs and tests. */
export const LIMITS = Object.freeze({
  MODEL_CACHE_TTL_MS: 10 * 60 * 1000,
  TRANSLATION_CACHE_TTL_MS: 30 * 60 * 1000,
  HISTORY_MAX_ENTRIES: 50,
  HISTORY_TEXT_MAX_CHARS: 200,
  INSTRUCTIONS_MAX_CHARS: 5000,
  /** Upper bound per page batch; the content script packs batches by characters below this. */
  PAGE_SEGMENTS_PER_REQUEST: 60,
  PAGE_SEGMENT_MAX_CHARS: 2000,
  /** Concurrent provider requests per provider profile (protects free-tier RPM). */
  PROVIDER_MAX_CONCURRENCY: 2,
  /** 429/503 retries per request before falling back to another model. */
  RATE_LIMIT_MAX_RETRIES: 3,
  RATE_LIMIT_BASE_DELAY_MS: 2000,
  /** Longest in-worker wait for a rate limit; kept under the MV3 30 s idle limit. Longer waits go back to the caller. */
  RATE_LIMIT_MAX_WAIT_MS: 20_000,
  MIN_SELECTION_CHARS: 2
});

/** Session cache key prefix. Bump the version when the provider output contract changes. */
export const TRANSLATION_CACHE_PREFIX = 'translation_v3_';

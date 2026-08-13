/**
 * Shared configuration for the provider-agnostic translation runtime.
 */

export const API_TYPES = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic'
};

export const API_TYPE_LABELS = {
  [API_TYPES.OPENAI]: 'OpenAI-compatible',
  [API_TYPES.ANTHROPIC]: 'Anthropic-compatible'
};

export const DEFAULT_SYSTEM_PROMPT = [
  'You are a precise translation engine.',
  'Translate from {{sourceLanguage}} to {{targetLanguage}}.',
  'Return only the translated text. Do not add labels, explanations, notes, markdown fences, or analysis.',
  'Preserve meaning, tone, proper names, URLs, code-like tokens, punctuation, and line breaks.',
  'Keep the output formatting as close to the source as possible.'
].join('\n');

export const DEFAULTS = {
  model: '',
  modelProvider: '',
  favoriteModels: [],
  providers: [],
  fromLang: 'auto',
  toLang: 'vi',
  rememberKey: true,
  instructions: [],
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  translationDisplayMode: 'badge',
  enableSelection: true
};

export const LANGUAGES = [
  { code: 'auto', name: 'Auto detect' },
  { code: 'en', name: 'English' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'de', name: 'German' },
  { code: 'ru', name: 'Russian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'it', name: 'Italian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'th', name: 'Thai' },
  { code: 'id', name: 'Indonesian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' }
];

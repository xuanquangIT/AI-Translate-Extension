/** Supported language codes. Pure module shared by pages, service worker, and tests. */

export const AUTO_DETECT = 'auto';

export const LANGUAGES = Object.freeze([
  { code: AUTO_DETECT, name: 'Auto detect' },
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
]);

/** Languages valid as a translation target (everything except auto-detect). */
export const TARGET_LANGUAGES = Object.freeze(LANGUAGES.filter(({ code }) => code !== AUTO_DETECT));

/**
 * Settings read/write. Durable defaults live in `chrome.storage.local`; popup
 * overrides live in `chrome.storage.session` and reset with the browser session.
 */

import { DEFAULTS } from '../shared/config.js';
import { isProviderReady, normalizeFavoriteModels, normalizeProviders, pickAutoSelectedModel } from './normalize.js';

/** Local key -> session override key. */
const SESSION_KEY_MAP = Object.freeze({
  model: 'sessionModel',
  modelProvider: 'sessionModelProvider',
  fromLang: 'sessionFromLang',
  toLang: 'sessionToLang'
});

/** Keys that `SAVE_DEFAULT_SETTINGS` may write. Extend deliberately. */
const DEFAULT_SETTINGS_WRITABLE_KEYS = Object.freeze([
  'model',
  'modelProvider',
  'fromLang',
  'toLang',
  'rememberKey',
  'translationDisplayMode',
  'systemPrompt',
  'enableSelection'
]);

export async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return {
    ...DEFAULTS,
    ...stored,
    providers: normalizeProviders(stored.providers),
    favoriteModels: normalizeFavoriteModels(stored.favoriteModels),
    instructions: Array.isArray(stored.instructions) ? stored.instructions : []
  };
}

/** Local defaults merged with session overrides. Falls back to an auto-selected provider when the chosen one is not ready. */
export async function loadSettingsWithSession() {
  const defaults = await loadSettings();
  const session = await chrome.storage.session.get(Object.values(SESSION_KEY_MAP));
  const modelProvider = session.sessionModelProvider || defaults.modelProvider;
  const selectedProvider = defaults.providers.find((provider) => provider.id === modelProvider);

  const useSession = !modelProvider || isProviderReady(selectedProvider);
  const autoSelection = useSession ? null : pickAutoSelectedModel(defaults.providers);

  return {
    ...defaults,
    model: autoSelection?.model ?? session.sessionModel ?? defaults.model,
    modelProvider: autoSelection?.modelProvider ?? modelProvider,
    fromLang: session.sessionFromLang || defaults.fromLang,
    toLang: session.sessionToLang || defaults.toLang
  };
}

export async function saveSessionSettings(patch) {
  const input = patch || {};
  const sessionPatch = {};
  for (const [key, sessionKey] of Object.entries(SESSION_KEY_MAP)) {
    if (key in input) sessionPatch[sessionKey] = input[key];
  }
  if (Object.keys(sessionPatch).length) await chrome.storage.session.set(sessionPatch);
  if ('rememberKey' in input) await chrome.storage.local.set({ rememberKey: Boolean(input.rememberKey) });
}

export async function saveDefaultSettings(patch) {
  const input = patch || {};
  const clean = {};
  for (const key of DEFAULT_SETTINGS_WRITABLE_KEYS) {
    if (key in input) clean[key] = input[key];
  }
  await chrome.storage.local.set(clean);
}

export async function clearSessionModelSelection() {
  await chrome.storage.session.remove([SESSION_KEY_MAP.model, SESSION_KEY_MAP.modelProvider]);
}

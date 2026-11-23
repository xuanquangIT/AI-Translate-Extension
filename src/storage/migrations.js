/**
 * Storage initialization and idempotent migrations. Runs on every service
 * worker start.
 *
 * Rules: migrations must be idempotent, must copy data before removing a legacy
 * key, and must bump PROVIDER_MIGRATION_VERSION (or add a new version key) when
 * the stored shape changes. Covered by `tests/unit/storage.test.js`.
 */

import { API_TYPES, DEFAULTS } from '../shared/config.js';
import {
  isProviderReady,
  makeId,
  normalizeFavoriteModels,
  normalizeProvider,
  normalizeProviders,
  pickAutoSelectedModel
} from './normalize.js';

export const PROVIDER_MIGRATION_VERSION = 1;

const LEGACY_KEYS = Object.freeze([
  'apiKey',
  'styleInstruction',
  'apiKeys',
  'customApiKey',
  'customApiBaseUrl',
  'customApiInterface',
  'groqApiKey',
  'openrouterApiKey',
  'genericProviderMigrationVersion'
]);

function legacyProvider({ id, name, apiType, baseUrl, apiKey, model }) {
  if (!baseUrl || !apiKey) return null;
  return normalizeProvider({ id, name, apiType, baseUrl, apiKey, manualModels: model ? [model] : [], enabled: true });
}

/** v1.0 fixed providers (Gemini/Groq/OpenRouter/Custom) -> generic provider profiles. */
function migrateLegacyProviders(current, patch) {
  const providers = normalizeProviders(current.providers);
  const migrated = [];

  const custom = legacyProvider({
    id: 'legacy-custom',
    name: 'Migrated custom provider',
    apiType: current.customApiInterface === API_TYPES.ANTHROPIC ? API_TYPES.ANTHROPIC : API_TYPES.OPENAI,
    baseUrl: current.customApiBaseUrl,
    apiKey: current.customApiKey,
    model: current.modelProvider === 'custom' ? current.model : ''
  });
  if (custom) migrated.push(custom);

  const geminiKey = (current.apiKeys || []).find((key) => key?.active)?.key || current.apiKey;
  const gemini = legacyProvider({
    id: 'legacy-gemini',
    name: 'Migrated Gemini compatibility endpoint',
    apiType: API_TYPES.OPENAI,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: geminiKey,
    model: current.modelProvider === 'gemini' ? current.model : ''
  });
  if (gemini) migrated.push(gemini);

  const openrouter = legacyProvider({
    id: 'legacy-openrouter',
    name: 'Migrated OpenRouter',
    apiType: API_TYPES.OPENAI,
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: current.openrouterApiKey
  });
  const groq = legacyProvider({
    id: 'legacy-groq',
    name: 'Migrated Groq',
    apiType: API_TYPES.OPENAI,
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: current.groqApiKey
  });
  if (openrouter) migrated.push(openrouter);
  if (groq) migrated.push(groq);

  patch.providers = providers.length ? providers : migrated;
  patch.genericProviderMigrationVersion = PROVIDER_MIGRATION_VERSION;
  if (current.modelProvider === 'custom') patch.modelProvider = custom ? custom.id : '';
  if (current.modelProvider === 'gemini') patch.modelProvider = gemini ? gemini.id : '';
}

export async function initializeStorage() {
  const current = await chrome.storage.local.get([...Object.keys(DEFAULTS), ...LEGACY_KEYS]);

  const patch = { ...DEFAULTS, ...current };
  if (current.styleInstruction && !(current.instructions || []).length) {
    patch.instructions = [
      { id: makeId('instruction'), name: 'Migrated instruction', text: current.styleInstruction, enabled: true }
    ];
  }

  if (current.genericProviderMigrationVersion !== PROVIDER_MIGRATION_VERSION) {
    migrateLegacyProviders(current, patch);
  }

  patch.providers = normalizeProviders(patch.providers);
  patch.favoriteModels = normalizeFavoriteModels(patch.favoriteModels);
  const selectedIsReady = patch.providers.some(
    (provider) => provider.id === patch.modelProvider && isProviderReady(provider)
  );
  if (!patch.modelProvider || !selectedIsReady) {
    const auto = pickAutoSelectedModel(patch.providers);
    patch.modelProvider = auto.modelProvider;
    if (!patch.model) patch.model = auto.model;
  }

  await chrome.storage.local.set(patch);
  if (current.apiKey) await chrome.storage.local.remove(['apiKey']);
  if (current.styleInstruction) await chrome.storage.local.remove(['styleInstruction']);
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch (_) {
    // Older browsers without setAccessLevel keep the default access level.
  }
}

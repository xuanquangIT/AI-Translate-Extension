/**
 * Durable configuration and migration helpers. Provider profiles are the only
 * credential source used by the runtime.
 */

import { API_TYPES, DEFAULTS } from './config.js';

const PROVIDER_MIGRATION_VERSION = 1;

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeApiType(value) {
  return value === API_TYPES.ANTHROPIC ? API_TYPES.ANTHROPIC : API_TYPES.OPENAI;
}

function normalizeManualModels(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter((value) => value && !seen.has(value) && seen.add(value));
}

export function normalizeProvider(value) {
  const provider = value && typeof value === 'object' ? value : {};
  const id = String(provider.id || '').trim();
  if (!id) return null;

  return {
    id,
    name: String(provider.name || 'Untitled provider').trim().slice(0, 80) || 'Untitled provider',
    apiType: normalizeApiType(provider.apiType),
    baseUrl: String(provider.baseUrl || '').trim().replace(/\/+$/, ''),
    apiKey: String(provider.apiKey || '').trim(),
    enabled: provider.enabled !== false,
    manualModels: normalizeManualModels(provider.manualModels),
    createdAt: Number(provider.createdAt) || Date.now(),
    updatedAt: Number(provider.updatedAt) || Date.now()
  };
}

export function normalizeProviders(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map(normalizeProvider)
    .filter((provider) => provider && !seen.has(provider.id) && seen.add(provider.id));
}

export function isProviderReady(provider) {
  return Boolean(provider?.enabled && provider?.baseUrl && provider?.apiKey);
}

export function toFavoriteModelKey(model, modelProvider) {
  const cleanModel = String(model || '').trim();
  const cleanProvider = String(modelProvider || '').trim();
  return cleanModel && cleanProvider ? `${cleanProvider}::${cleanModel}` : '';
}

function normalizeFavoriteModels(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((item) => String(item || '').trim())
    .filter((item) => item.includes('::') && !seen.has(item) && seen.add(item));
}

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

export async function loadSettingsWithSession() {
  const defaults = await loadSettings();
  const session = await chrome.storage.session.get([
    'sessionModel', 'sessionModelProvider', 'sessionFromLang', 'sessionToLang'
  ]);
  const modelProvider = session.sessionModelProvider || defaults.modelProvider;
  const selectedProvider = defaults.providers.find((provider) => provider.id === modelProvider);

  const useSession = !modelProvider || isProviderReady(selectedProvider);
  const autoSelection = useSession ? null : await getAutoSelectedModel(defaults.providers);

  return {
    ...defaults,
    model: autoSelection?.model ?? session.sessionModel ?? defaults.model,
    modelProvider: autoSelection?.modelProvider ?? modelProvider,
    fromLang: session.sessionFromLang || defaults.fromLang,
    toLang: session.sessionToLang || defaults.toLang
  };
}

export async function saveSessionSettings(patch) {
  const mapping = {
    model: 'sessionModel',
    modelProvider: 'sessionModelProvider',
    fromLang: 'sessionFromLang',
    toLang: 'sessionToLang'
  };
  const sessionPatch = {};
  for (const [key, sessionKey] of Object.entries(mapping)) {
    if (key in (patch || {})) sessionPatch[sessionKey] = patch[key];
  }
  if (Object.keys(sessionPatch).length) await chrome.storage.session.set(sessionPatch);
  if ('rememberKey' in (patch || {})) await chrome.storage.local.set({ rememberKey: Boolean(patch.rememberKey) });
}

export async function saveDefaultSettings(patch) {
  const allowed = ['model', 'modelProvider', 'fromLang', 'toLang', 'rememberKey', 'translationDisplayMode', 'systemPrompt', 'enableSelection'];
  const clean = {};
  for (const key of allowed) {
    if (key in (patch || {})) clean[key] = patch[key];
  }
  await chrome.storage.local.set(clean);
}

export async function getProviders() {
  return (await loadSettings()).providers;
}

export async function saveProvider(input) {
  const providers = await getProviders();
  const existing = providers.find((provider) => provider.id === input?.id);
  const candidate = normalizeProvider({
    ...existing,
    ...input,
    id: existing?.id || input?.id || makeId('provider'),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  });

  if (!candidate.baseUrl) throw new Error('Provider base URL is required.');
  if (!candidate.apiKey) throw new Error('Provider API key is required.');

  const next = existing
    ? providers.map((provider) => provider.id === candidate.id ? candidate : provider)
    : [...providers, candidate];
  await chrome.storage.local.set({ providers: next });
  return candidate;
}

export async function removeProvider(id) {
  const providers = await getProviders();
  const next = providers.filter((provider) => provider.id !== id);
  await chrome.storage.local.set({ providers: next });

  const settings = await loadSettingsWithSession();
  if (settings.modelProvider === id) {
    const selection = await getAutoSelectedModel(next);
    await chrome.storage.local.set({ model: selection.model, modelProvider: selection.modelProvider });
    await chrome.storage.session.remove(['sessionModel', 'sessionModelProvider']);
  }
}

export async function getFavoriteModels() {
  return (await loadSettings()).favoriteModels;
}

export async function toggleFavoriteModel({ model, modelProvider }) {
  const key = toFavoriteModelKey(model, modelProvider);
  if (!key) throw new Error('Choose a provider and model before favoriting it.');
  const current = await getFavoriteModels();
  const exists = current.includes(key);
  const favoriteModels = exists ? current.filter((item) => item !== key) : [key, ...current];
  await chrome.storage.local.set({ favoriteModels });
  return { favoriteModels, isFavorite: !exists };
}

export async function addInstruction(name, text) {
  const { instructions = [] } = await loadSettings();
  const instruction = {
    id: makeId('instruction'),
    name: String(name || 'Instruction').trim().slice(0, 80) || 'Instruction',
    text: String(text || '').trim(),
    enabled: true
  };
  if (!instruction.text) throw new Error('Instruction text is required.');
  await chrome.storage.local.set({ instructions: [...instructions, instruction] });
  return instruction;
}

export async function updateInstruction(id, patch) {
  const { instructions = [] } = await loadSettings();
  const next = instructions.map((item) => item.id === id ? {
    ...item,
    ...(patch?.name !== undefined ? { name: String(patch.name).trim().slice(0, 80) } : {}),
    ...(patch?.text !== undefined ? { text: String(patch.text).trim() } : {}),
    ...(patch?.enabled !== undefined ? { enabled: Boolean(patch.enabled) } : {})
  } : item);
  await chrome.storage.local.set({ instructions: next });
}

export async function removeInstruction(id) {
  const { instructions = [] } = await loadSettings();
  await chrome.storage.local.set({ instructions: instructions.filter((item) => item.id !== id) });
}

export async function toggleInstruction(id) {
  const { instructions = [] } = await loadSettings();
  await chrome.storage.local.set({
    instructions: instructions.map((item) => item.id === id ? { ...item, enabled: !item.enabled } : item)
  });
}

export async function getCombinedInstructions() {
  const { instructions = [] } = await loadSettings();
  return instructions.filter((item) => item.enabled).map((item) => item.text).filter(Boolean).join('\n');
}

export async function getAutoSelectedModel(providers = null) {
  const list = providers || await getProviders();
  const provider = list.find(isProviderReady);
  return provider ? { model: provider.manualModels[0] || '', modelProvider: provider.id } : { model: '', modelProvider: '' };
}

export async function addTranslationHistory(entry) {
  const { translationHistory = [] } = await chrome.storage.local.get(['translationHistory']);
  const next = [{ id: makeId('history'), timestamp: Date.now(), ...entry }, ...translationHistory].slice(0, 50);
  await chrome.storage.local.set({ translationHistory: next });
}

export async function getTranslationHistory() {
  const { translationHistory = [] } = await chrome.storage.local.get(['translationHistory']);
  return Array.isArray(translationHistory) ? translationHistory : [];
}

export async function clearTranslationHistory() {
  await chrome.storage.local.set({ translationHistory: [] });
}

function legacyProvider({ id, name, apiType, baseUrl, apiKey, model }) {
  if (!baseUrl || !apiKey) return null;
  return normalizeProvider({ id, name, apiType, baseUrl, apiKey, manualModels: model ? [model] : [], enabled: true });
}

export async function initializeStorage() {
  const current = await chrome.storage.local.get([
    ...Object.keys(DEFAULTS), 'apiKey', 'styleInstruction', 'apiKeys',
    'customApiKey', 'customApiBaseUrl', 'customApiInterface', 'groqApiKey', 'openrouterApiKey',
    'genericProviderMigrationVersion'
  ]);

  const patch = { ...DEFAULTS, ...current };
  if (current.styleInstruction && !(current.instructions || []).length) {
    patch.instructions = [{ id: makeId('instruction'), name: 'Migrated instruction', text: current.styleInstruction, enabled: true }];
  }

  if (current.genericProviderMigrationVersion !== PROVIDER_MIGRATION_VERSION) {
    const providers = normalizeProviders(current.providers);
    const migrated = [];
    const custom = legacyProvider({
      id: 'legacy-custom', name: 'Migrated custom provider',
      apiType: current.customApiInterface === API_TYPES.ANTHROPIC ? API_TYPES.ANTHROPIC : API_TYPES.OPENAI,
      baseUrl: current.customApiBaseUrl, apiKey: current.customApiKey,
      model: current.modelProvider === 'custom' ? current.model : ''
    });
    if (custom) migrated.push(custom);
    const geminiKey = (current.apiKeys || []).find((key) => key?.active)?.key || current.apiKey;
    const gemini = legacyProvider({
      id: 'legacy-gemini', name: 'Migrated Gemini compatibility endpoint', apiType: API_TYPES.OPENAI,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: geminiKey,
      model: current.modelProvider === 'gemini' ? current.model : ''
    });
    if (gemini) migrated.push(gemini);
    const openrouter = legacyProvider({ id: 'legacy-openrouter', name: 'Migrated OpenRouter', apiType: API_TYPES.OPENAI, baseUrl: 'https://openrouter.ai/api/v1', apiKey: current.openrouterApiKey });
    const groq = legacyProvider({ id: 'legacy-groq', name: 'Migrated Groq', apiType: API_TYPES.OPENAI, baseUrl: 'https://api.groq.com/openai/v1', apiKey: current.groqApiKey });
    if (openrouter) migrated.push(openrouter);
    if (groq) migrated.push(groq);
    patch.providers = providers.length ? providers : migrated;
    patch.genericProviderMigrationVersion = PROVIDER_MIGRATION_VERSION;
    if (current.modelProvider === 'custom') patch.modelProvider = custom ? custom.id : '';
    if (current.modelProvider === 'gemini') patch.modelProvider = gemini ? gemini.id : '';
  }

  patch.providers = normalizeProviders(patch.providers);
  patch.favoriteModels = normalizeFavoriteModels(patch.favoriteModels);
  if (!patch.modelProvider || !patch.providers.some((provider) => provider.id === patch.modelProvider && isProviderReady(provider))) {
    const auto = await getAutoSelectedModel(patch.providers);
    patch.modelProvider = auto.modelProvider;
    if (!patch.model) patch.model = auto.model;
  }

  await chrome.storage.local.set(patch);
  if (current.apiKey) await chrome.storage.local.remove(['apiKey']);
  if (current.styleInstruction) await chrome.storage.local.remove(['styleInstruction']);
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch (_) {}
}

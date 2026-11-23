/** Per-provider model catalog with a session cache (LIMITS.MODEL_CACHE_TTL_MS). */

import { listProviderModels } from '../providers/index.js';
import { LIMITS } from '../shared/config.js';
import { toFavoriteModelKey } from '../shared/model-keys.js';
import { getFavoriteModels, getProviders, isProviderReady } from '../storage/index.js';
import { storageReady } from './storage-ready.js';

const CATALOG_KEY = 'providerModelCatalog';

/**
 * True when `modelId` may be offered for `provider`: manual models always, discovered
 * models only when listed in `enabledModels`. Legacy profiles (field absent) allow all.
 */
export function isModelSelectable(provider, modelId) {
  if (!provider || !modelId) return false;
  if (!Array.isArray(provider.enabledModels)) return true;
  return (provider.manualModels || []).includes(modelId) || provider.enabledModels.includes(modelId);
}

/** Manual models first, then discovered ones; `selectedOnly` drops models that are not selectable. */
function mergeModels(provider, discovered, { selectedOnly = true } = {}) {
  const seen = new Set();
  const manual = (provider.manualModels || []).map((id) => ({
    id,
    label: id,
    provider: provider.id,
    apiType: provider.apiType,
    tier: 'manual'
  }));
  const offered = selectedOnly
    ? (discovered || []).filter((model) => isModelSelectable(provider, model.id))
    : discovered || [];
  return [...manual, ...offered].filter((model) => !seen.has(model.id) && seen.add(model.id));
}

/** Unfiltered discovered models for one provider, from the session cache or `/models`. */
async function discoverModels(provider, catalog, errors, force) {
  const cached = catalog[provider.id];
  if (!force && cached && Date.now() - cached.at < LIMITS.MODEL_CACHE_TTL_MS) {
    if (cached.error) errors[provider.id] = cached.error;
    return cached.models;
  }
  try {
    const models = await listProviderModels(provider);
    catalog[provider.id] = { at: Date.now(), models };
    return models;
  } catch (error) {
    const message = error?.message || String(error);
    errors[provider.id] = message;
    catalog[provider.id] = { at: Date.now(), models: [], error: message };
    return [];
  }
}

async function readCatalog() {
  const session = await chrome.storage.session.get([CATALOG_KEY]);
  return session[CATALOG_KEY] || {};
}

/**
 * @returns {Promise<{models, favoriteModels, errors, providers}>} Favorites first, then by label.
 * `providers` is a public projection: it never contains API keys or base URLs.
 */
export async function getAvailableModels({ force = false } = {}) {
  await storageReady;
  const providers = (await getProviders()).filter(isProviderReady);
  const favorites = await getFavoriteModels();
  const catalog = await readCatalog();
  const errors = {};

  const results = await Promise.all(
    providers.map(async (provider) => mergeModels(provider, await discoverModels(provider, catalog, errors, force)))
  );
  await chrome.storage.session.set({ [CATALOG_KEY]: catalog });

  const favoriteSet = new Set(favorites);
  const models = results
    .flat()
    .map((model) => ({ ...model, isFavorite: favoriteSet.has(toFavoriteModelKey(model.id, model.provider)) }))
    .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.label.localeCompare(b.label));

  return {
    models,
    favoriteModels: favorites,
    errors,
    providers: providers.map(({ id, name, apiType, manualModels }) => ({ id, name, apiType, manualModels }))
  };
}

/**
 * Every model the Options checklist can offer for one provider: manual + all discovered,
 * unfiltered by selection. `enabledModels: null` means legacy (all discovered models shown).
 * @returns {Promise<{models: {id, name}[], enabledModels: string[]|null, error?: string}>} Never contains credentials.
 */
export async function getProviderModelOptions({ providerId, force = false } = {}) {
  await storageReady;
  const provider = (await getProviders()).find((item) => item.id === providerId);
  if (!provider) throw new Error('Provider not found.');
  if (!provider.baseUrl || !provider.apiKey) throw new Error('Provider base URL and API key are required.');

  const catalog = await readCatalog();
  const errors = {};
  const discovered = await discoverModels(provider, catalog, errors, force);
  await chrome.storage.session.set({ [CATALOG_KEY]: catalog });

  const result = {
    models: mergeModels(provider, discovered, { selectedOnly: false }).map(({ id, label }) => ({ id, name: label })),
    enabledModels: Array.isArray(provider.enabledModels) ? [...provider.enabledModels] : null
  };
  if (errors[provider.id]) result.error = errors[provider.id];
  return result;
}

/** Drops one provider's cached catalog, or all of them when `providerId` is empty. */
export async function invalidateProviderCatalog(providerId) {
  const { [CATALOG_KEY]: catalog = {} } = await chrome.storage.session.get([CATALOG_KEY]);
  if (providerId) delete catalog[providerId];
  else Object.keys(catalog).forEach((key) => delete catalog[key]);
  await chrome.storage.session.set({ [CATALOG_KEY]: catalog });
}

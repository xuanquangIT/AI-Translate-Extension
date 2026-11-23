/** Per-provider model catalog with a session cache (LIMITS.MODEL_CACHE_TTL_MS). */

import { listProviderModels } from '../providers/index.js';
import { LIMITS } from '../shared/config.js';
import { toFavoriteModelKey } from '../shared/model-keys.js';
import { getFavoriteModels, getProviders, isProviderReady } from '../storage/index.js';
import { storageReady } from './storage-ready.js';

const CATALOG_KEY = 'providerModelCatalog';

function mergeModels(provider, discovered) {
  const seen = new Set();
  const manual = (provider.manualModels || []).map((id) => ({
    id,
    label: id,
    provider: provider.id,
    apiType: provider.apiType,
    tier: 'manual'
  }));
  return [...manual, ...(discovered || [])].filter((model) => !seen.has(model.id) && seen.add(model.id));
}

async function modelsForProvider(provider, catalog, errors, force) {
  const cached = catalog[provider.id];
  if (!force && cached && Date.now() - cached.at < LIMITS.MODEL_CACHE_TTL_MS) {
    if (cached.error) errors[provider.id] = cached.error;
    return mergeModels(provider, cached.models);
  }
  try {
    const models = await listProviderModels(provider);
    catalog[provider.id] = { at: Date.now(), models };
    return mergeModels(provider, models);
  } catch (error) {
    const message = error?.message || String(error);
    errors[provider.id] = message;
    catalog[provider.id] = { at: Date.now(), models: [], error: message };
    return mergeModels(provider, []);
  }
}

/**
 * @returns {Promise<{models, favoriteModels, errors, providers}>} Favorites first, then by label.
 * `providers` is a public projection: it never contains API keys or base URLs.
 */
export async function getAvailableModels({ force = false } = {}) {
  await storageReady;
  const providers = (await getProviders()).filter(isProviderReady);
  const favorites = await getFavoriteModels();
  const session = await chrome.storage.session.get([CATALOG_KEY]);
  const catalog = session[CATALOG_KEY] || {};
  const errors = {};

  const results = await Promise.all(providers.map((provider) => modelsForProvider(provider, catalog, errors, force)));
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

/** Drops one provider's cached catalog, or all of them when `providerId` is empty. */
export async function invalidateProviderCatalog(providerId) {
  const { [CATALOG_KEY]: catalog = {} } = await chrome.storage.session.get([CATALOG_KEY]);
  if (providerId) delete catalog[providerId];
  else Object.keys(catalog).forEach((key) => delete catalog[key]);
  await chrome.storage.session.set({ [CATALOG_KEY]: catalog });
}

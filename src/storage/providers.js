/** Provider profile CRUD. Profiles are the only credential source used by the runtime. */

import { clearSessionModelSelection, loadSettings } from './settings.js';
import { parseFavoriteModelKey } from '../shared/model-keys.js';
import { isModelSelectable, makeId, normalizeProvider, pickAutoSelectedModel } from './normalize.js';

export async function getProviders() {
  return (await loadSettings()).providers;
}

export async function getAutoSelectedModel(providers = null) {
  return pickAutoSelectedModel(providers || (await getProviders()));
}

/**
 * Drops favorites, the durable default, and the session choice that point at a model
 * of `provider` that is no longer selectable (deselected or removed manual model).
 */
async function pruneUnselectableModels(provider, providers) {
  const {
    favoriteModels = [],
    model,
    modelProvider
  } = await chrome.storage.local.get(['favoriteModels', 'model', 'modelProvider']);
  const keep = (key) => {
    const favorite = parseFavoriteModelKey(key);
    return favorite?.providerId !== provider.id || isModelSelectable(provider, favorite.model);
  };
  const patch = {};
  if (Array.isArray(favoriteModels) && !favoriteModels.every(keep)) patch.favoriteModels = favoriteModels.filter(keep);
  if (modelProvider === provider.id && model && !isModelSelectable(provider, model)) {
    // Prefer another selectable model of the same provider, then the usual auto-selection
    // over the other providers, and only then this provider with an empty model.
    const others = providers.filter((item) => item.id !== provider.id);
    const hasModels = provider.manualModels.length > 0 || provider.enabledModels?.length > 0;
    const fromOthers = hasModels ? null : pickAutoSelectedModel(others);
    const selection = fromOthers?.modelProvider ? fromOthers : pickAutoSelectedModel([provider, ...others]);
    patch.model = selection.model;
    patch.modelProvider = selection.modelProvider;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);

  const { sessionModel, sessionModelProvider } = await chrome.storage.session.get([
    'sessionModel',
    'sessionModelProvider'
  ]);
  if (sessionModelProvider === provider.id && sessionModel && !isModelSelectable(provider, sessionModel)) {
    await clearSessionModelSelection();
  }
}

export async function saveProvider(input) {
  const providers = await getProviders();
  const existing = providers.find((provider) => provider.id === input?.id);
  // Editing without `enabledModels` keeps the stored selection (or legacy "all");
  // a brand-new provider starts with no discovered model selected.
  const enabledModels = Array.isArray(input?.enabledModels)
    ? input.enabledModels
    : existing
      ? existing.enabledModels
      : [];
  const candidate = normalizeProvider({
    ...existing,
    ...input,
    enabledModels,
    id: existing?.id || input?.id || makeId('provider'),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  });

  if (!candidate.baseUrl) throw new Error('Provider base URL is required.');
  if (!candidate.apiKey) throw new Error('Provider API key is required.');

  const next = existing
    ? providers.map((provider) => (provider.id === candidate.id ? candidate : provider))
    : [...providers, candidate];
  await chrome.storage.local.set({ providers: next });
  if (existing) await pruneUnselectableModels(candidate, next);
  return candidate;
}

export async function removeProvider(id) {
  // Read raw selections BEFORE removal: afterwards loadSettingsWithSession would
  // already auto-select another provider and hide the stale stored selection.
  // The durable default and the session override are reset independently so
  // removing a session-only provider never overwrites the user's default.
  const { modelProvider: storedDefault } = await chrome.storage.local.get(['modelProvider']);
  const { sessionModelProvider } = await chrome.storage.session.get(['sessionModelProvider']);

  const providers = await getProviders();
  const next = providers.filter((provider) => provider.id !== id);
  await chrome.storage.local.set({ providers: next });

  if (storedDefault === id) {
    const selection = pickAutoSelectedModel(next);
    await chrome.storage.local.set({ model: selection.model, modelProvider: selection.modelProvider });
  }
  if (sessionModelProvider === id) await clearSessionModelSelection();
}

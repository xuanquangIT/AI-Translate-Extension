/**
 * Picks the provider/model for a request and runs the fallback chain:
 * primary -> favorites (in order) -> every other available model.
 */

import { parseFavoriteModelKey, toFavoriteModelKey } from '../shared/model-keys.js';
import {
  getFavoriteModels,
  getProviders,
  isModelSelectable,
  isProviderReady,
  loadSettingsWithSession
} from '../storage/index.js';
import { getAvailableModels } from './model-catalog.js';

export async function resolveModel({ model, modelProvider } = {}) {
  const settings = await loadSettingsWithSession();
  const providerId = modelProvider || settings.modelProvider;
  const provider = (await getProviders()).find((item) => item.id === providerId);
  if (!provider || !isProviderReady(provider)) throw new Error('Choose a configured provider in Settings.');

  const modelId = String(model || settings.model || '').trim();
  if (modelId) return { provider, model: modelId };

  const available = await getAvailableModels();
  const first = available.models.find((item) => item.provider === provider.id);
  if (!first) {
    throw new Error(
      `No model is available for ${provider.name}. Check its models under Providers in Settings and tick the ones to use, or add a manual model.`
    );
  }
  return { provider, model: first.id };
}

/**
 * Ordered, de-duplicated `{ provider, model }` candidates starting with `primary`.
 * Favorites that are no longer selectable for their provider are skipped.
 */
export async function fallbackCandidates(primary) {
  const providers = new Map((await getProviders()).filter(isProviderReady).map((provider) => [provider.id, provider]));
  const catalog = await getAvailableModels();
  const candidates = [];
  const seen = new Set();
  const add = (providerId, model) => {
    const provider = providers.get(providerId);
    const key = toFavoriteModelKey(model, providerId);
    if (provider && key && !seen.has(key)) {
      seen.add(key);
      candidates.push({ provider, model });
    }
  };

  add(primary.provider.id, primary.model);
  for (const key of await getFavoriteModels()) {
    const favorite = parseFavoriteModelKey(key);
    if (favorite && isModelSelectable(providers.get(favorite.providerId), favorite.model)) {
      add(favorite.providerId, favorite.model);
    }
  }
  for (const model of catalog.models) add(model.provider, model.id);
  return candidates;
}

/** Runs `operation(candidate)` until one succeeds. @returns {{ result, used }} */
export async function withFallback(primary, operation) {
  try {
    return { result: await operation(primary), used: primary };
  } catch (error) {
    const candidates = await fallbackCandidates(primary);
    let lastError = error;
    for (const candidate of candidates.slice(1)) {
      try {
        return { result: await operation(candidate), used: candidate };
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }
    const firstMessage = error?.message || 'unknown provider error';
    const lastMessage = lastError?.message || firstMessage;
    throw new Error(`No model completed the translation. First error: ${firstMessage}. Last error: ${lastMessage}`);
  }
}

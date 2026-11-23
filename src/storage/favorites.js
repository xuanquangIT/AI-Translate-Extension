/** Favorite models, stored as unique `provider::model` keys, newest first. */

import { toFavoriteModelKey } from '../shared/model-keys.js';
import { loadSettings } from './settings.js';

export async function getFavoriteModels() {
  return (await loadSettings()).favoriteModels;
}

export async function toggleFavoriteModel({ model, modelProvider } = {}) {
  const key = toFavoriteModelKey(model, modelProvider);
  if (!key) throw new Error('Choose a provider and model before favoriting it.');
  const current = await getFavoriteModels();
  const exists = current.includes(key);
  const favoriteModels = exists ? current.filter((item) => item !== key) : [key, ...current];
  await chrome.storage.local.set({ favoriteModels });
  return { favoriteModels, isFavorite: !exists };
}

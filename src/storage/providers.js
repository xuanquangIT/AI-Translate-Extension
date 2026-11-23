/** Provider profile CRUD. Profiles are the only credential source used by the runtime. */

import { clearSessionModelSelection, loadSettings } from './settings.js';
import { makeId, normalizeProvider, pickAutoSelectedModel } from './normalize.js';

export async function getProviders() {
  return (await loadSettings()).providers;
}

export async function getAutoSelectedModel(providers = null) {
  return pickAutoSelectedModel(providers || (await getProviders()));
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
    ? providers.map((provider) => (provider.id === candidate.id ? candidate : provider))
    : [...providers, candidate];
  await chrome.storage.local.set({ providers: next });
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

/**
 * Background message router: one handler per BACKGROUND_MESSAGES type.
 *
 * Each handler receives `payload` and returns the success fields; the router
 * wraps them as `{ ok: true, ...fields }` and converts throws to
 * `{ ok: false, error }`. Adding a message: add the type to
 * `src/shared/messages.js`, a handler here, the sender, and a row in
 * docs/CONTRACTS.md. `tests/contract/` enforces coverage.
 */

import { BACKGROUND_MESSAGES as M } from '../shared/messages.js';
import {
  addInstruction,
  clearTranslationHistory,
  getInstructions,
  getProviders,
  getTranslationHistory,
  loadSettingsWithSession,
  removeInstruction,
  removeProvider,
  saveDefaultSettings,
  saveProvider,
  saveSessionSettings,
  toggleFavoriteModel,
  toggleInstruction,
  updateInstruction
} from '../storage/index.js';
import { getAvailableModels, getProviderModelOptions, invalidateProviderCatalog } from './model-catalog.js';
import { storageReady } from './storage-ready.js';
import { restorePageInTab, translatePageInTab, translateSelectionInTab } from './tab-jobs.js';
import { translatePage, translateSingleText } from './translation-service.js';

export const handlers = Object.freeze({
  [M.GET_SETTINGS]: async () => ({ settings: await loadSettingsWithSession() }),
  [M.SAVE_SETTINGS]: async (payload) => {
    await saveSessionSettings(payload || {});
  },
  [M.SAVE_DEFAULT_SETTINGS]: async (payload) => {
    await saveDefaultSettings(payload || {});
  },

  [M.GET_PROVIDERS]: async () => ({ providers: await getProviders() }),
  [M.SAVE_PROVIDER]: async (payload) => {
    const provider = await saveProvider(payload || {});
    await invalidateProviderCatalog(provider.id);
    return { provider };
  },
  [M.REMOVE_PROVIDER]: async (payload) => {
    await removeProvider(payload?.id);
    await invalidateProviderCatalog(payload?.id);
  },

  [M.GET_AVAILABLE_MODELS]: async (payload) => getAvailableModels({ force: Boolean(payload?.force) }),
  [M.REFRESH_PROVIDER_MODELS]: async (payload) => {
    await invalidateProviderCatalog(payload?.providerId);
    return getAvailableModels({ force: true });
  },
  [M.GET_PROVIDER_MODEL_OPTIONS]: async (payload) =>
    getProviderModelOptions({ providerId: payload?.providerId, force: Boolean(payload?.force) }),
  [M.TOGGLE_FAVORITE_MODEL]: async (payload) => toggleFavoriteModel(payload || {}),

  [M.GET_INSTRUCTIONS]: async () => ({ instructions: await getInstructions() }),
  [M.ADD_INSTRUCTION]: async (payload) => ({ instruction: await addInstruction(payload?.name, payload?.text) }),
  [M.UPDATE_INSTRUCTION]: async (payload) => {
    await updateInstruction(payload?.id, payload);
  },
  [M.REMOVE_INSTRUCTION]: async (payload) => {
    await removeInstruction(payload?.id);
  },
  [M.TOGGLE_INSTRUCTION]: async (payload) => {
    await toggleInstruction(payload?.id);
  },

  [M.TRANSLATE_TEXT]: async (payload) => ({ translation: await translateSingleText(payload || {}) }),
  [M.TRANSLATE_PAGE]: async (payload) => translatePage(payload || {}),
  [M.TRANSLATE_SELECTION_IN_TAB]: async (payload) => translateSelectionInTab(payload || {}),
  [M.TRANSLATE_PAGE_IN_TAB]: async (payload) => translatePageInTab(payload || {}),
  [M.RESTORE_PAGE_IN_TAB]: async (payload) => restorePageInTab(payload || {}),

  [M.GET_HISTORY]: async () => ({ history: await getTranslationHistory() }),
  [M.CLEAR_HISTORY]: async () => {
    await clearTranslationHistory();
  }
});

/** Dispatches one message and always resolves to the response envelope. */
export async function dispatchMessage(message) {
  try {
    await storageReady;
    const handler = Object.hasOwn(handlers, message?.type) ? handlers[message.type] : null;
    if (!handler) return { ok: false, error: 'Unknown message type.' };
    return { ok: true, ...((await handler(message.payload)) || {}) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

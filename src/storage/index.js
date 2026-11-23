/**
 * Storage public API. Only the background service worker imports this folder;
 * pages and the content script go through runtime messages.
 * Schema: docs/CONTRACTS.md#storage-schema.
 */

export { initializeStorage, PROVIDER_MIGRATION_VERSION } from './migrations.js';
export { isModelSelectable, isProviderReady, normalizeProvider, normalizeProviders } from './normalize.js';
export { loadSettings, loadSettingsWithSession, saveDefaultSettings, saveSessionSettings } from './settings.js';
export { getAutoSelectedModel, getProviders, removeProvider, saveProvider } from './providers.js';
export { getFavoriteModels, toggleFavoriteModel } from './favorites.js';
export {
  addInstruction,
  getCombinedInstructions,
  getInstructions,
  removeInstruction,
  toggleInstruction,
  updateInstruction
} from './instructions.js';
export { addTranslationHistory, clearTranslationHistory, getTranslationHistory } from './history.js';

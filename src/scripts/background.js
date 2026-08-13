/**
 * MV3 service worker: provider routing, state, cache, and runtime messaging.
 */

import { getCombinedInstructions, getFavoriteModels, getProviders, getTranslationHistory, clearTranslationHistory, addTranslationHistory, initializeStorage, isProviderReady, loadSettingsWithSession, removeInstruction, removeProvider, saveDefaultSettings, saveProvider, saveSessionSettings, toggleFavoriteModel, toggleInstruction, toFavoriteModelKey, addInstruction, updateInstruction } from './lib/storage.js';
import { listProviderModels, translateBatchWithProvider, translateWithProvider } from './lib/api.js';
import { sanitizeIncomingText, sanitizeTranslatedText, stableHash } from './lib/translation-utils.js';

const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
const TRANSLATION_CACHE_TTL_MS = 30 * 60 * 1000;
const PAGE_SEGMENT_LIMIT = 30;
const storageReady = initializeStorage().catch((error) => console.warn('[LingoFlux] storage initialization failed', error));
const inFlightTranslations = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  await storageReady;
  setupContextMenu();
});

chrome.runtime.onStartup.addListener(() => setupContextMenu());

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({
    id: 'lingoflux-translate', title: 'Translate with LingoFlux', contexts: ['selection']
  }));
}

function cacheKey({ text, fromLang, toLang, model, modelProvider, systemPrompt, styleInstruction }) {
  return `translation_v3_${stableHash([text, fromLang, toLang, model, modelProvider, systemPrompt, styleInstruction].join('\u241f'))}`;
}

async function getCachedTranslation(key) {
  const entry = (await chrome.storage.session.get([key]))[key];
  return entry && Date.now() - entry.at < TRANSLATION_CACHE_TTL_MS ? entry.text : null;
}

async function setCachedTranslation(key, text) {
  await chrome.storage.session.set({ [key]: { text, at: Date.now() } });
}

function mergeModels(provider, discovered) {
  const seen = new Set();
  const manual = (provider.manualModels || []).map((id) => ({ id, label: id, provider: provider.id, apiType: provider.apiType, tier: 'manual' }));
  return [...manual, ...(discovered || [])].filter((model) => !seen.has(model.id) && seen.add(model.id));
}

async function getAvailableModels({ force = false } = {}) {
  await storageReady;
  const providers = (await getProviders()).filter(isProviderReady);
  const favorites = await getFavoriteModels();
  const session = await chrome.storage.session.get(['providerModelCatalog']);
  const catalog = session.providerModelCatalog || {};
  const errors = {};

  const results = await Promise.all(providers.map(async (provider) => {
    const cached = catalog[provider.id];
    if (!force && cached && Date.now() - cached.at < MODEL_CACHE_TTL_MS) {
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
  }));
  await chrome.storage.session.set({ providerModelCatalog: catalog });
  const models = results.flat();
  const favoriteSet = new Set(favorites);
  return {
    models: models.map((model) => ({ ...model, isFavorite: favoriteSet.has(toFavoriteModelKey(model.id, model.provider)) }))
      .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.label.localeCompare(b.label)),
    favoriteModels: favorites,
    errors,
    providers: providers.map(({ id, name, apiType, manualModels }) => ({ id, name, apiType, manualModels }))
  };
}

async function invalidateProviderCatalog(providerId) {
  const { providerModelCatalog = {} } = await chrome.storage.session.get(['providerModelCatalog']);
  if (providerId) delete providerModelCatalog[providerId];
  else Object.keys(providerModelCatalog).forEach((key) => delete providerModelCatalog[key]);
  await chrome.storage.session.set({ providerModelCatalog });
}

async function resolveModel({ model, modelProvider }) {
  const settings = await loadSettingsWithSession();
  const providerId = modelProvider || settings.modelProvider;
  const provider = (await getProviders()).find((item) => item.id === providerId);
  if (!provider || !isProviderReady(provider)) throw new Error('Choose a configured provider in Settings.');
  const modelId = String(model || settings.model || '').trim();
  if (modelId) return { provider, model: modelId };
  const available = await getAvailableModels();
  const first = available.models.find((item) => item.provider === provider.id);
  if (!first) throw new Error(`No model is available for ${provider.name}. Refresh its models or add a manual model in Settings.`);
  return { provider, model: first.id };
}

function combineInstructions(saved) {
  return String(saved || '').trim().slice(0, 5000);
}

function parseFavoriteKey(value) {
  const index = String(value || '').indexOf('::');
  return index > 0 ? { providerId: value.slice(0, index), model: value.slice(index + 2) } : null;
}

async function fallbackCandidates(primary) {
  const providers = new Map((await getProviders()).filter(isProviderReady).map((provider) => [provider.id, provider]));
  const catalog = await getAvailableModels();
  const candidates = [];
  const seen = new Set();
  const add = (providerId, model) => {
    const provider = providers.get(providerId);
    const key = toFavoriteModelKey(model, providerId);
    if (provider && key && !seen.has(key)) { seen.add(key); candidates.push({ provider, model }); }
  };
  add(primary.provider.id, primary.model);
  for (const key of await getFavoriteModels()) {
    const favorite = parseFavoriteKey(key);
    if (favorite) add(favorite.providerId, favorite.model);
  }
  for (const model of catalog.models) add(model.provider, model.id);
  return candidates;
}

async function withFallback(primary, operation) {
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

function translationSignature(input) {
  return cacheKey(input);
}

async function translateSingleText({ text, fromLang, toLang, model, modelProvider, skipCache = false } = {}) {
  await storageReady;
  const source = sanitizeIncomingText(text);
  if (source.length < 2) throw new Error('Select at least two characters to translate.');
  const settings = await loadSettingsWithSession();
  const resolved = await resolveModel({ model, modelProvider });
  const options = {
    text: source,
    fromLang: fromLang || settings.fromLang,
    toLang: toLang || settings.toLang,
    model: resolved.model,
    modelProvider: resolved.provider.id,
    systemPrompt: settings.systemPrompt,
    styleInstruction: combineInstructions(await getCombinedInstructions())
  };
  const key = translationSignature(options);
  if (!skipCache) {
    const cached = await getCachedTranslation(key);
    if (cached) return cached;
  }
  if (inFlightTranslations.has(key)) return inFlightTranslations.get(key);

  const job = (async () => {
    const attempted = await withFallback(resolved, ({ provider, model }) => translateWithProvider({ ...options, provider, model }));
    const raw = attempted.result;
    const translation = sanitizeTranslatedText(raw, source);
    if (!translation) throw new Error('The provider returned an empty translation.');
    await setCachedTranslation(key, translation);
    await addTranslationHistory({ sourceText: source.slice(0, 200), translation: translation.slice(0, 200), fromLang: options.fromLang, toLang: options.toLang, model: `${attempted.used.provider.name}: ${attempted.used.model}` });
    return translation;
  })();
  inFlightTranslations.set(key, job);
  try {
    return await job;
  } finally {
    inFlightTranslations.delete(key);
  }
}

async function translatePage({ fromLang, toLang, model, modelProvider, segments } = {}) {
  await storageReady;
  const cleanSegments = (Array.isArray(segments) ? segments : []).filter((segment) => segment && typeof segment.id === 'string' && typeof segment.text === 'string' && segment.text.trim()).slice(0, PAGE_SEGMENT_LIMIT);
  if (!cleanSegments.length) throw new Error('No page text is available to translate.');
  const settings = await loadSettingsWithSession();
  const resolved = await resolveModel({ model, modelProvider });
  const options = {
    fromLang: fromLang || settings.fromLang,
    toLang: toLang || settings.toLang,
    systemPrompt: settings.systemPrompt,
    styleInstruction: combineInstructions(await getCombinedInstructions()),
    segments: cleanSegments
  };
  const attempted = await withFallback(resolved, ({ provider, model }) => translateBatchWithProvider({ ...options, provider, model }));
  return attempted.result;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function translateSelectionInTab({ tabId, ...request }) {
  if (!tabId) throw new Error('No target tab is available.');
  await chrome.scripting.executeScript({ target: { tabId }, files: ['scripts/content.js'] }).catch(() => {});
  const selection = await getSelectionFromTab(tabId, request.text);
  const translation = await translateSingleText({ ...request, text: selection.text });
  const inserted = await chrome.tabs.sendMessage(tabId, { type: 'INSERT_TRANSLATION', translation, selectionId: selection.selectionId });
  if (!inserted?.ok) throw new Error(inserted?.error || 'The translation completed but could not be inserted into the page.');
  return { translation };
}

async function translatePageInTab({ tabId, ...request }) {
  if (!tabId) throw new Error('No target tab is available.');
  await chrome.scripting.executeScript({ target: { tabId }, files: ['scripts/content.js'] }).catch(() => {});
  const extracted = await chrome.tabs.sendMessage(tabId, { type: 'TRANSLATE_PAGE_EXTRACT' });
  const segments = extracted?.segments || [];
  if (!extracted?.ok || !segments.length) throw new Error('No translatable text was found on this page.');
  const chunks = [];
  for (let index = 0; index < segments.length; index += 20) chunks.push(segments.slice(index, index + 20));
  const batches = await mapWithConcurrency(chunks, 2, (chunk) => translatePage({ ...request, segments: chunk }));
  const translations = batches.flatMap((batch) => batch.translations || []);
  const applied = await chrome.tabs.sendMessage(tabId, { type: 'TRANSLATE_PAGE_APPLY', translations });
  if (!applied?.ok) throw new Error(applied?.error || 'The translation completed but could not be applied to the page.');
  return { translatedCount: translations.length, segmentCount: segments.length };
}

async function getSelectionFromTab(tabId, fallbackText) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_SELECTION' });
    if (response?.ok && response.text) return response;
  } catch (_) {}
  return { text: sanitizeIncomingText(fallbackText), selectionId: '' };
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'lingoflux-translate' || !tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['scripts/content.js'] }).catch(() => {});
    const selection = await getSelectionFromTab(tab.id, info.selectionText);
    const translation = await translateSingleText({ text: selection.text });
    await chrome.tabs.sendMessage(tab.id, { type: 'INSERT_TRANSLATION', translation, selectionId: selection.selectionId });
  } catch (error) {
    await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_TOAST', message: error?.message || 'Translation failed.', toastType: 'error' }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      await storageReady;
      switch (message?.type) {
        case 'GET_SETTINGS': sendResponse({ ok: true, settings: await loadSettingsWithSession() }); break;
        case 'SAVE_SETTINGS': await saveSessionSettings(message.payload || {}); sendResponse({ ok: true }); break;
        case 'SAVE_DEFAULT_SETTINGS': await saveDefaultSettings(message.payload || {}); sendResponse({ ok: true }); break;
        case 'GET_PROVIDERS': sendResponse({ ok: true, providers: await getProviders() }); break;
        case 'SAVE_PROVIDER': {
          const provider = await saveProvider(message.payload || {});
          await invalidateProviderCatalog(provider.id);
          sendResponse({ ok: true, provider });
          break;
        }
        case 'REMOVE_PROVIDER': await removeProvider(message.payload?.id); await invalidateProviderCatalog(message.payload?.id); sendResponse({ ok: true }); break;
        case 'GET_AVAILABLE_MODELS': sendResponse({ ok: true, ...(await getAvailableModels({ force: Boolean(message.payload?.force) })) }); break;
        case 'REFRESH_PROVIDER_MODELS': await invalidateProviderCatalog(message.payload?.providerId); sendResponse({ ok: true, ...(await getAvailableModels({ force: true })) }); break;
        case 'TOGGLE_FAVORITE_MODEL': sendResponse({ ok: true, ...(await toggleFavoriteModel(message.payload || {})) }); break;
        case 'GET_INSTRUCTIONS': sendResponse({ ok: true, instructions: (await loadSettingsWithSession()).instructions }); break;
        case 'ADD_INSTRUCTION': sendResponse({ ok: true, instruction: await addInstruction(message.payload?.name, message.payload?.text) }); break;
        case 'UPDATE_INSTRUCTION': await updateInstruction(message.payload?.id, message.payload); sendResponse({ ok: true }); break;
        case 'REMOVE_INSTRUCTION': await removeInstruction(message.payload?.id); sendResponse({ ok: true }); break;
        case 'TOGGLE_INSTRUCTION': await toggleInstruction(message.payload?.id); sendResponse({ ok: true }); break;
        case 'TRANSLATE_TEXT': sendResponse({ ok: true, translation: await translateSingleText(message.payload || {}) }); break;
        case 'TRANSLATE_PAGE': sendResponse({ ok: true, ...(await translatePage(message.payload || {})) }); break;
        case 'TRANSLATE_SELECTION_IN_TAB': sendResponse({ ok: true, ...(await translateSelectionInTab(message.payload || {})) }); break;
        case 'TRANSLATE_PAGE_IN_TAB': sendResponse({ ok: true, ...(await translatePageInTab(message.payload || {})) }); break;
        case 'GET_HISTORY': sendResponse({ ok: true, history: await getTranslationHistory() }); break;
        case 'CLEAR_HISTORY': await clearTranslationHistory(); sendResponse({ ok: true }); break;
        default: sendResponse({ ok: false, error: 'Unknown message type.' });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true;
});

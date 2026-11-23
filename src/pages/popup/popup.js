/**
 * Popup: quick translation, session-scoped language/model choice, history.
 * Long-running tab jobs run in the service worker so the popup may close.
 */

import { BACKGROUND_MESSAGES as M } from '../../shared/messages.js';
import { $, fillLanguageSelects, setBusy, setStatus as renderStatus, textElement } from '../shared/dom.js';
import { isFavoriteSelection, renderModelOptions, selectedModel } from '../shared/model-picker.js';
import { broadcastDisplayMode, broadcastSelectionEnabled, request } from '../shared/runtime.js';

const PROMPT_SAVE_DEBOUNCE_MS = 500;
const state = { settings: {}, providers: [], models: [], favorites: [], errors: {} };
let promptSaveTimer;

const setStatus = (text, isError = false) => renderStatus($('status'), text, isError);
const currentModel = () => selectedModel($('model'));

// ---------------------------------------------------------------- rendering

function renderProviderSummary() {
  const selected = currentModel();
  const provider = state.providers.find((item) => item.id === selected.modelProvider);
  $('providerSummary').textContent = provider
    ? `${provider.name} · ${selected.model || 'choose a model'}`
    : 'Set up a provider to begin';
}

function renderFavoriteButton() {
  const button = $('btnFavorite');
  const favorite = isFavoriteSelection($('model'), state.favorites);
  button.disabled = !currentModel().model;
  button.textContent = favorite ? '★' : '☆';
  button.title = favorite ? 'Remove favorite' : 'Add favorite';
}

function renderModels(preferredModel = state.settings.model, preferredProvider = state.settings.modelProvider) {
  renderModelOptions($('model'), {
    models: state.models,
    providers: state.providers,
    favorites: state.favorites,
    preferredModel,
    preferredProvider,
    emptyLabel: 'Configure a provider in Settings'
  });
  renderFavoriteButton();
  renderProviderSummary();
}

function renderPlacement(mode) {
  document.querySelectorAll('.mode-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
}

async function renderHistory() {
  const response = await chrome.runtime.sendMessage({ type: M.GET_HISTORY });
  const list = $('historyList');
  list.replaceChildren();
  for (const item of response?.history || []) {
    const row = document.createElement('div');
    row.className = 'history-item';
    row.append(
      textElement('div', 'history-source', item.sourceText),
      textElement('div', 'history-result', item.translation)
    );
    list.appendChild(row);
  }
  if (!list.children.length) list.appendChild(textElement('p', 'status', 'No recent translations.'));
}

// ---------------------------------------------------------------- state sync

async function loadModels(force = false, preferred = {}) {
  const response = await request(
    force ? M.REFRESH_PROVIDER_MODELS : M.GET_AVAILABLE_MODELS,
    force ? {} : undefined,
    'Unable to load model catalog.'
  );
  state.models = response.models || [];
  state.favorites = response.favoriteModels || [];
  state.errors = response.errors || {};
  state.providers = response.providers || state.providers;
  renderModels(preferred.model, preferred.modelProvider);
  const error = Object.values(state.errors).find(Boolean);
  if (error) setStatus(error, true);
}

async function saveSession() {
  await chrome.runtime.sendMessage({
    type: M.SAVE_SETTINGS,
    payload: { ...currentModel(), fromLang: $('fromLang').value, toLang: $('toLang').value }
  });
}

async function saveSystemPrompt({ announce = false } = {}) {
  clearTimeout(promptSaveTimer);
  promptSaveTimer = undefined;
  const systemPrompt = $('systemPrompt').value.trim();
  await request(M.SAVE_DEFAULT_SETTINGS, { systemPrompt }, 'Unable to save the system prompt.');
  state.settings.systemPrompt = systemPrompt;
  if (announce) setStatus('Custom system prompt saved.');
}

function scheduleSystemPromptSave() {
  clearTimeout(promptSaveTimer);
  promptSaveTimer = setTimeout(
    () => saveSystemPrompt().catch((error) => setStatus(error.message, true)),
    PROMPT_SAVE_DEBOUNCE_MS
  );
}

function translationPayload() {
  return { ...currentModel(), fromLang: $('fromLang').value, toLang: $('toLang').value };
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab is available.');
  return tab.id;
}

// ---------------------------------------------------------------- actions

/** Runs a translation action with busy state; always saves a pending prompt edit first. */
async function runAction(button, busyLabel, startMessage, action) {
  setBusy(button, true, busyLabel);
  setStatus(startMessage);
  try {
    await saveSystemPrompt();
    setStatus(await action());
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

async function translateDirect() {
  const text = $('directInput').value.trim();
  if (!text) return setStatus('Enter text to translate.', true);
  $('directOutput').hidden = true;
  return runAction($('btnDirectTranslate'), 'Translating…', '', async () => {
    const result = await request(M.TRANSLATE_TEXT, { ...translationPayload(), text }, 'Translation failed.');
    $('directOutputText').textContent = result.translation;
    $('directOutput').hidden = false;
    return 'Translation complete.';
  });
}

function translateSelection() {
  return runAction($('btnSelection'), 'Working…', 'Translation will continue even if this popup closes.', async () => {
    await request(
      M.TRANSLATE_SELECTION_IN_TAB,
      { ...translationPayload(), tabId: await activeTabId() },
      'Translation failed.'
    );
    return 'Translation inserted into the page.';
  });
}

function translatePage() {
  return runAction(
    $('btnTranslatePage'),
    'Translating…',
    'Page translation will continue even if this popup closes.',
    async () => {
      await request(
        M.TRANSLATE_PAGE_IN_TAB,
        { ...translationPayload(), tabId: await activeTabId() },
        'Page translation failed.'
      );
      return 'Translating visible text first; the rest is translated as you scroll.';
    }
  );
}

async function restorePage() {
  const button = $('btnRestorePage');
  setBusy(button, true, 'Restoring…');
  try {
    const result = await request(M.RESTORE_PAGE_IN_TAB, { tabId: await activeTabId() }, 'Unable to restore the page.');
    setStatus(result.restored ? 'Original page text restored.' : 'Nothing to restore on this page.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

async function refreshModels() {
  const button = $('btnRefreshModels');
  setBusy(button, true, '…');
  try {
    await loadModels(true, currentModel());
    setStatus('Model catalog refreshed.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

async function toggleFavorite() {
  const selected = currentModel();
  const result = await chrome.runtime.sendMessage({ type: M.TOGGLE_FAVORITE_MODEL, payload: selected });
  if (!result?.ok) return setStatus(result?.error || 'Unable to change favorite.', true);
  state.favorites = result.favoriteModels || [];
  return renderModels(selected.model, selected.modelProvider);
}

async function setSelectionEnabled(enabled) {
  await request(M.SAVE_DEFAULT_SETTINGS, { enableSelection: enabled });
  await broadcastSelectionEnabled(enabled);
  setStatus(enabled ? 'Selection tools enabled.' : 'Selection tools disabled.');
}

async function setDisplayMode(mode) {
  renderPlacement(mode);
  await request(M.SAVE_DEFAULT_SETTINGS, { translationDisplayMode: mode });
  await broadcastDisplayMode(mode);
  setStatus(`${mode === 'replace' ? 'Replace' : 'Badge'} placement selected.`);
}

// ---------------------------------------------------------------- wiring

function bindEvents() {
  $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('fromLang').addEventListener('change', saveSession);
  $('toLang').addEventListener('change', saveSession);
  $('model').addEventListener('change', () => {
    renderFavoriteButton();
    renderProviderSummary();
    saveSession();
  });
  $('btnRefreshModels').addEventListener('click', refreshModels);
  $('btnFavorite').addEventListener('click', toggleFavorite);

  $('systemPrompt').addEventListener('input', scheduleSystemPromptSave);
  $('btnSaveSystemPrompt').addEventListener('click', async () => {
    const button = $('btnSaveSystemPrompt');
    setBusy(button, true, 'Saving…');
    try {
      await saveSystemPrompt({ announce: true });
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(button, false);
    }
  });
  window.addEventListener('blur', () => {
    if (promptSaveTimer) saveSystemPrompt().catch(() => {});
  });

  $('btnDirectTranslate').addEventListener('click', translateDirect);
  $('directInput').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      translateDirect();
    }
  });
  $('btnSelection').addEventListener('click', translateSelection);
  $('btnTranslatePage').addEventListener('click', translatePage);
  $('btnRestorePage').addEventListener('click', restorePage);
  $('btnCopyDirect').addEventListener('click', () =>
    navigator.clipboard
      .writeText($('directOutputText').textContent)
      .then(() => setStatus('Copied.'))
      .catch(() => setStatus('Unable to copy.', true))
  );

  $('enableSelection').addEventListener('change', (event) =>
    setSelectionEnabled(event.target.checked).catch((error) => setStatus(error.message, true))
  );
  document
    .querySelectorAll('.mode-button')
    .forEach((button) =>
      button.addEventListener('click', () =>
        setDisplayMode(button.dataset.mode).catch((error) => setStatus(error.message, true))
      )
    );

  $('btnHistory').addEventListener('click', async () => {
    const panel = $('historyPanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) await renderHistory();
  });
  $('btnClearHistory').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: M.CLEAR_HISTORY });
    renderHistory();
  });
}

async function init() {
  fillLanguageSelects($('fromLang'), $('toLang'));
  const response = await request(M.GET_SETTINGS, undefined, 'Unable to load settings.');
  state.settings = response.settings || {};
  $('fromLang').value = state.settings.fromLang || 'auto';
  $('toLang').value = state.settings.toLang || 'vi';
  $('systemPrompt').value = state.settings.systemPrompt || '';
  $('enableSelection').checked = state.settings.enableSelection !== false;
  renderPlacement(state.settings.translationDisplayMode || 'badge');

  const providers = await chrome.runtime.sendMessage({ type: M.GET_PROVIDERS });
  state.providers = providers?.providers || [];
  await loadModels(false);
}

bindEvents();
init().catch((error) => setStatus(error.message, true));

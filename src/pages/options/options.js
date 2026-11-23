/**
 * Options page: provider profiles, persistent translation defaults, system
 * prompt, and reusable preferences. All writes go through the background router.
 */

import { API_TYPE_LABELS, API_TYPES } from '../../shared/config.js';
import { BACKGROUND_MESSAGES as M } from '../../shared/messages.js';
import { $, fillLanguageSelects, setStatus as renderStatus, textElement } from '../shared/dom.js';
import { isFavoriteSelection, renderModelOptions, selectedModel } from '../shared/model-picker.js';
import { request } from '../shared/runtime.js';

const state = { settings: {}, providers: [], models: [], favorites: [], errors: {} };

const message = (text, isError = false) => renderStatus($('status'), text, isError);
const currentModel = () => selectedModel($('model'));
const maskKey = (value) => (value ? `••••${value.slice(-4)}` : 'No key');

function actionButton(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button secondary';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

// ---------------------------------------------------------------- models

function renderFavoriteButton() {
  const favorited = isFavoriteSelection($('model'), state.favorites);
  $('btnFavoriteModel').disabled = !currentModel().model;
  $('btnFavoriteModel').textContent = favorited ? 'Unfavorite' : 'Favorite';
}

function renderModels(preferredModel = state.settings.model, preferredProvider = state.settings.modelProvider) {
  renderModelOptions($('model'), {
    models: state.models,
    providers: state.providers,
    favorites: state.favorites,
    preferredModel,
    preferredProvider,
    emptyLabel: 'Add a provider or a manual model'
  });
  renderFavoriteButton();
  const errorText = Object.values(state.errors).find(Boolean);
  $('modelHelp').textContent = errorText || 'Favorites appear first and are used as fallback candidates.';
}

async function loadModels({ force = false, providerId = '', preferredModel, preferredProvider } = {}) {
  const result = await request(
    force ? M.REFRESH_PROVIDER_MODELS : M.GET_AVAILABLE_MODELS,
    force ? { providerId } : undefined,
    'Unable to load models.'
  );
  state.models = result.models || [];
  state.favorites = result.favoriteModels || [];
  state.errors = result.errors || {};
  if (!state.providers.length) state.providers = result.providers || [];
  renderModels(preferredModel, preferredProvider);
}

async function refreshModels(providerId = '') {
  message('Refreshing model catalog…');
  await loadModels({ force: true, providerId });
  message('Model catalog refreshed.');
}

async function toggleFavorite() {
  const selected = currentModel();
  const result = await chrome.runtime.sendMessage({ type: M.TOGGLE_FAVORITE_MODEL, payload: selected });
  if (!result?.ok) return message(result?.error || 'Unable to change favorite.', true);
  state.favorites = result.favoriteModels || [];
  return renderModels(selected.model, selected.modelProvider);
}

// ---------------------------------------------------------------- providers

function providerRow(provider) {
  const row = document.createElement('div');
  row.className = `provider-row${provider.enabled === false ? ' disabled' : ''}`;

  const info = document.createElement('div');
  info.className = 'provider-info';
  const apiLabel = API_TYPE_LABELS[provider.apiType] || API_TYPE_LABELS[API_TYPES.OPENAI];
  const meta = `${apiLabel} · ${provider.baseUrl} · ${maskKey(provider.apiKey)} · ${provider.manualModels?.length || 0} manual models`;
  info.append(textElement('div', 'provider-name', provider.name), textElement('div', 'provider-meta', meta));

  const tag = textElement('span', 'tag', provider.enabled === false ? 'Disabled' : 'Ready');

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.append(
    actionButton('Edit', () => openProviderForm(provider)),
    actionButton('Refresh models', () => refreshModels(provider.id).catch((error) => message(error.message, true))),
    actionButton('Remove', () => removeProvider(provider))
  );

  row.append(info, tag, actions);
  return row;
}

function renderProviders() {
  const list = $('providersList');
  list.replaceChildren();
  if (!state.providers.length) {
    list.appendChild(textElement('p', 'subtle', 'No providers yet. Add one to start translating.'));
    return;
  }
  state.providers.forEach((provider) => list.appendChild(providerRow(provider)));
}

async function loadProviders() {
  const result = await request(M.GET_PROVIDERS, undefined, 'Unable to load providers.');
  state.providers = result.providers || [];
  renderProviders();
}

function openProviderForm(provider = null) {
  $('providerForm').hidden = false;
  $('providerFormTitle').textContent = provider ? 'Edit provider' : 'Add provider';
  $('providerId').value = provider?.id || '';
  $('providerName').value = provider?.name || '';
  $('providerApiType').value = provider?.apiType || API_TYPES.OPENAI;
  $('providerBaseUrl').value = provider?.baseUrl || '';
  $('providerApiKey').value = provider?.apiKey || '';
  $('providerManualModels').value = (provider?.manualModels || []).join('\n');
  $('providerName').focus();
}

function closeProviderForm() {
  $('providerForm').hidden = true;
  $('providerForm').reset();
  $('providerId').value = '';
}

function providerFormPayload() {
  return {
    id: $('providerId').value || undefined,
    name: $('providerName').value,
    apiType: $('providerApiType').value,
    baseUrl: $('providerBaseUrl').value,
    apiKey: $('providerApiKey').value,
    manualModels: $('providerManualModels')
      .value.split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean)
  };
}

async function saveProvider(refresh = false) {
  const result = await request(M.SAVE_PROVIDER, providerFormPayload(), 'Unable to save provider.');
  closeProviderForm();
  await loadProviders();
  await loadModels({ force: refresh, providerId: result.provider.id, preferredProvider: result.provider.id });
  message(refresh ? 'Provider saved and models refreshed.' : 'Provider saved.');
}

async function removeProvider(provider) {
  if (!confirm(`Remove ${provider.name}? This only removes its local configuration.`)) return;
  const result = await chrome.runtime.sendMessage({ type: M.REMOVE_PROVIDER, payload: { id: provider.id } });
  if (!result?.ok) return message(result?.error || 'Unable to remove provider.', true);
  await loadProviders();
  await loadModels();
  message('Provider removed.');
}

// ---------------------------------------------------------------- defaults

async function saveDefaults() {
  const mode = document.querySelector('input[name="displayMode"]:checked').value;
  const payload = {
    ...currentModel(),
    fromLang: $('fromLang').value,
    toLang: $('toLang').value,
    translationDisplayMode: mode,
    systemPrompt: $('systemPrompt').value.trim()
  };
  const result = await chrome.runtime.sendMessage({ type: M.SAVE_DEFAULT_SETTINGS, payload });
  if (!result?.ok) return message(result?.error || 'Unable to save defaults.', true);
  await chrome.runtime.sendMessage({ type: M.SAVE_SETTINGS, payload });
  return message('Translation defaults saved.');
}

// ---------------------------------------------------------------- instructions

function editInstruction(item) {
  $('instructionId').value = item.id;
  $('instructionName').value = item.name;
  $('instructionText').value = item.text;
  $('btnCancelInstruction').hidden = false;
  $('instructionName').focus();
}

function instructionRow(item) {
  const row = document.createElement('div');
  row.className = 'instruction-row';
  const info = document.createElement('div');
  info.className = 'instruction-info';
  info.append(textElement('div', 'instruction-name', item.name), textElement('div', 'instruction-text', item.text));

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.append(
    actionButton(item.enabled ? 'Disable' : 'Enable', async () => {
      await chrome.runtime.sendMessage({ type: M.TOGGLE_INSTRUCTION, payload: { id: item.id } });
      loadInstructions();
    }),
    actionButton('Edit', () => editInstruction(item)),
    actionButton('Remove', async () => {
      await chrome.runtime.sendMessage({ type: M.REMOVE_INSTRUCTION, payload: { id: item.id } });
      loadInstructions();
    })
  );
  row.append(info, actions);
  return row;
}

async function loadInstructions() {
  const result = await chrome.runtime.sendMessage({ type: M.GET_INSTRUCTIONS });
  const list = $('instructionsList');
  list.replaceChildren();
  (result?.instructions || []).forEach((item) => list.appendChild(instructionRow(item)));
  if (!list.children.length) list.appendChild(textElement('p', 'subtle', 'No reusable preferences yet.'));
}

function clearInstructionForm() {
  $('instructionForm').reset();
  $('instructionId').value = '';
  $('btnCancelInstruction').hidden = true;
}

async function saveInstruction() {
  const id = $('instructionId').value;
  const payload = { id, name: $('instructionName').value || 'Preference', text: $('instructionText').value };
  const result = await chrome.runtime.sendMessage({ type: id ? M.UPDATE_INSTRUCTION : M.ADD_INSTRUCTION, payload });
  if (!result?.ok) return message(result?.error || 'Unable to save preference.', true);
  clearInstructionForm();
  await loadInstructions();
  return message('Preference saved.');
}

// ---------------------------------------------------------------- wiring

function bindEvents() {
  const reportErrors = (fn) => (event) => fn(event).catch((error) => message(error.message, true));

  $('btnNewProvider').addEventListener('click', () => openProviderForm());
  $('btnCancelProvider').addEventListener('click', closeProviderForm);
  $('providerForm').addEventListener(
    'submit',
    reportErrors(async (event) => {
      event.preventDefault();
      await saveProvider(false);
    })
  );
  $('btnSaveAndRefresh').addEventListener(
    'click',
    reportErrors(() => saveProvider(true))
  );
  $('btnRefreshModels').addEventListener(
    'click',
    reportErrors(() => refreshModels())
  );
  $('model').addEventListener('change', renderFavoriteButton);
  $('btnFavoriteModel').addEventListener('click', reportErrors(toggleFavorite));
  $('btnSaveDefaults').addEventListener('click', reportErrors(saveDefaults));
  $('instructionForm').addEventListener(
    'submit',
    reportErrors(async (event) => {
      event.preventDefault();
      await saveInstruction();
    })
  );
  $('btnCancelInstruction').addEventListener('click', clearInstructionForm);
}

async function init() {
  fillLanguageSelects($('fromLang'), $('toLang'));
  const result = await request(M.GET_SETTINGS, undefined, 'Unable to load settings.');
  state.settings = result.settings || {};
  $('fromLang').value = state.settings.fromLang || 'auto';
  $('toLang').value = state.settings.toLang || 'vi';
  $('systemPrompt').value = state.settings.systemPrompt || '';
  const mode = state.settings.translationDisplayMode || 'badge';
  document.querySelector(`input[name="displayMode"][value="${mode}"]`).checked = true;
  await loadProviders();
  await loadModels();
  await loadInstructions();
}

bindEvents();
init().catch((error) => message(error.message, true));

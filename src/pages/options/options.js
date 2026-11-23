/**
 * Options page: provider profiles, persistent translation defaults, system
 * prompt, and reusable preferences. All writes go through the background router.
 */

import { API_TYPE_LABELS, API_TYPES } from '../../shared/config.js';
import { BACKGROUND_MESSAGES as M } from '../../shared/messages.js';
import { $, fillLanguageSelects, setStatus as renderStatus, textElement } from '../shared/dom.js';
import {
  countSelection,
  createSelection,
  describeSaved,
  describeSelection,
  filterModels,
  selectableModels,
  selectionChanged,
  selectionToEnabled,
  setChecked
} from '../shared/model-checklist.js';
import { isFavoriteSelection, renderModelOptions, selectedModel } from '../shared/model-picker.js';
import { request } from '../shared/runtime.js';

/**
 * `panels` holds the per-provider model checklist state (it survives re-rendering the provider
 * list); `views` maps a provider ID to the DOM of its currently rendered checklist.
 */
const state = { settings: {}, providers: [], models: [], favorites: [], errors: {}, panels: new Map() };
const views = new Map();

const message = (text, isError = false) => renderStatus($('status'), text, isError);
const currentModel = () => selectedModel($('model'));
const maskKey = (value) => (value ? `••••${value.slice(-4)}` : 'No key');
const providerById = (id) => state.providers.find((provider) => provider.id === id);
const manualIdsOf = (id) => providerById(id)?.manualModels || [];
const isReadyProvider = (provider) => provider.enabled !== false && Boolean(provider.baseUrl && provider.apiKey);

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
  const hasReadyProvider = state.providers.some(isReadyProvider);
  const nothingSelected = hasReadyProvider && !state.models.length;
  renderModelOptions($('model'), {
    models: state.models,
    providers: state.providers,
    favorites: state.favorites,
    preferredModel,
    preferredProvider,
    emptyLabel: nothingSelected ? 'No models selected yet' : 'Add a provider or a manual model'
  });
  renderFavoriteButton();
  const errorText = Object.values(state.errors).find(Boolean);
  const help = nothingSelected
    ? 'No models selected yet. Open a provider’s Models list above and tick the models you want here.'
    : 'Only models ticked in a provider appear here. Favorites come first and are used as fallback candidates.';
  $('modelHelp').textContent = errorText || help;
  $('modelHelp').classList.toggle('attention', nothingSelected && !errorText);
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

/** Refreshes every provider's catalog, then re-checks the open model checklists that have no unsaved ticks. */
async function refreshModels() {
  message('Refreshing model catalog…');
  await loadModels({ force: true });
  for (const [providerId, panel] of state.panels) {
    if (panel.open && panel.status !== 'loading' && !panelChanged(providerId)) await loadModelPanel(providerId);
  }
  message('Model catalog refreshed.');
}

/** Reloads the default-model picker after a provider's selection changed, keeping the user's pick when possible. */
async function reloadModelPicker() {
  const picked = currentModel();
  const result = await request(M.GET_SETTINGS, undefined, 'Unable to load settings.');
  state.settings = result.settings || state.settings;
  await loadModels({ preferredModel: picked.model, preferredProvider: picked.modelProvider });
  const now = currentModel();
  if (picked.model && (now.model !== picked.model || now.modelProvider !== picked.modelProvider)) {
    renderModels(state.settings.model, state.settings.modelProvider);
  }
}

async function toggleFavorite() {
  const selected = currentModel();
  const result = await chrome.runtime.sendMessage({ type: M.TOGGLE_FAVORITE_MODEL, payload: selected });
  if (!result?.ok) return message(result?.error || 'Unable to change favorite.', true);
  state.favorites = result.favoriteModels || [];
  return renderModels(selected.model, selected.modelProvider);
}

// ---------------------------------------------------------------- providers

// ---- model checklist (one per provider): discovered models the user ticks to show in the pickers

function ensurePanel(providerId) {
  if (!state.panels.has(providerId)) {
    state.panels.set(providerId, {
      open: false,
      status: 'idle', // idle | loading | ready | failed
      error: '',
      discoveryError: '',
      models: [],
      enabledModels: [],
      selection: new Set(),
      query: '',
      saving: false,
      notice: '',
      token: 0,
      inflight: null
    });
  }
  return state.panels.get(providerId);
}

function panelChanged(providerId) {
  const panel = ensurePanel(providerId);
  return (
    panel.status === 'ready' &&
    selectionChanged(panel.models, panel.selection, panel.enabledModels, manualIdsOf(providerId))
  );
}

function panelStatusText(panel, counts) {
  if (panel.status === 'loading') return { text: 'Checking available models…', error: false };
  if (panel.status === 'failed') return { text: `Could not check models: ${panel.error}`, error: true };
  if (panel.status !== 'ready') return { text: '', error: false };
  if (panel.discoveryError) {
    return { text: `Model discovery failed: ${panel.discoveryError}. Manual models are still available.`, error: true };
  }
  if (!counts.total) {
    const text = counts.manual
      ? 'No models were discovered. Manual models are always available.'
      : 'This provider returned no models. Edit it to add manual model IDs.';
    return { text, error: false };
  }
  if (panel.enabledModels === null) {
    return { text: 'Every model is shown until you save a selection. Untick the ones you do not need.', error: false };
  }
  if (!counts.selected) return { text: 'No models selected yet. Tick the ones you want to use.', error: false };
  return { text: '', error: false };
}

function modelItem(model, { checked, locked }) {
  const label = document.createElement('label');
  label.className = `model-item${locked ? ' locked' : ''}`;
  label.title = model.id;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = model.id;
  input.checked = checked;
  input.disabled = locked;
  label.append(input, textElement('span', 'model-name', model.name || model.id));
  if (model.name && model.name !== model.id) label.append(textElement('span', 'model-id', model.id));
  if (locked) label.append(textElement('span', 'tag', 'manual'));
  return label;
}

/** Re-renders the rows (search/select-all/clear/new data); checkbox clicks only call `paintPanelMeta`. */
function paintPanelList(providerId) {
  const view = views.get(providerId);
  if (!view) return;
  const panel = ensurePanel(providerId);
  const manual = new Set(manualIdsOf(providerId));
  const scrollTop = view.list.scrollTop;
  view.list.replaceChildren();
  if (panel.status === 'ready') {
    const shown = filterModels(panel.models, panel.query);
    shown.forEach((model) => {
      const locked = manual.has(model.id);
      view.list.appendChild(modelItem(model, { checked: locked || panel.selection.has(model.id), locked }));
    });
    if (!shown.length) view.list.appendChild(textElement('p', 'hint model-empty', 'No models match your search.'));
  }
  view.list.scrollTop = scrollTop;
}

function paintPanelMeta(providerId) {
  const view = views.get(providerId);
  if (!view) return;
  const panel = ensurePanel(providerId);
  const manual = manualIdsOf(providerId);
  const ready = panel.status === 'ready';
  const counts = countSelection(panel.models, panel.selection, manual);
  const shown = selectableModels(filterModels(panel.models, panel.query), manual).length;
  const hasChecklist = ready && counts.total > 0;
  const busy = panel.saving;

  view.summaryInfo.textContent = ready
    ? describeSelection(counts, counts.total)
    : describeSaved(providerById(providerId)?.enabledModels);
  const status = panelStatusText(panel, counts);
  view.status.textContent = status.text;
  view.status.className = `model-status${status.error ? ' error' : ''}`;

  view.toolbar.hidden = !hasChecklist;
  view.counter.hidden = !hasChecklist;
  view.list.hidden = !hasChecklist;
  view.actions.hidden = !hasChecklist;
  view.counter.textContent = hasChecklist ? describeSelection(counts, shown) : '';
  view.search.disabled = busy;
  view.selectAll.disabled = busy;
  view.clear.disabled = busy;
  view.list.querySelectorAll('input').forEach((input) => {
    input.disabled = busy || manual.includes(input.value);
  });
  view.save.disabled = busy || !hasChecklist || Boolean(panel.discoveryError);
  view.save.textContent = busy ? 'Saving…' : 'Save selection';
  view.dirty.textContent = panelChanged(providerId) ? 'Unsaved changes' : panel.notice;
}

function paintPanel(providerId) {
  paintPanelList(providerId);
  paintPanelMeta(providerId);
}

/** Asks the background for a provider's manual + discovered models and rebuilds its selection. */
function loadModelPanel(providerId, { force = false } = {}) {
  const panel = ensurePanel(providerId);
  if (panel.inflight && !force) return panel.inflight;
  const token = ++panel.token;
  panel.status = 'loading';
  panel.error = '';
  panel.notice = '';
  paintPanel(providerId);

  const run = (async () => {
    try {
      const result = await request(
        M.GET_PROVIDER_MODEL_OPTIONS,
        { providerId, force },
        'Unable to check the available models.'
      );
      if (token !== panel.token) return;
      panel.models = result.models || [];
      panel.enabledModels = Array.isArray(result.enabledModels) ? result.enabledModels : null;
      panel.discoveryError = result.error || '';
      panel.selection = createSelection(panel.models, panel.enabledModels, manualIdsOf(providerId));
      panel.status = 'ready';
    } catch (error) {
      if (token !== panel.token) return;
      panel.models = [];
      panel.discoveryError = '';
      panel.error = error.message;
      panel.status = 'failed';
    }
    paintPanel(providerId);
  })();
  panel.inflight = run;
  run.finally(() => {
    if (panel.inflight === run) panel.inflight = null;
  });
  return run;
}

/** Persists the ticked models as the provider's `enabledModels`, then refreshes the default-model picker. */
async function saveModelSelection(providerId) {
  const provider = providerById(providerId);
  const panel = ensurePanel(providerId);
  if (!provider || panel.status !== 'ready') return;
  const enabledModels = selectionToEnabled(panel.models, panel.selection, provider.manualModels || []);
  panel.saving = true;
  paintPanelMeta(providerId);
  try {
    await request(
      M.SAVE_PROVIDER,
      {
        id: provider.id,
        name: provider.name,
        apiType: provider.apiType,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        enabled: provider.enabled,
        manualModels: provider.manualModels || [],
        enabledModels
      },
      'Unable to save the model selection.'
    );
    panel.enabledModels = enabledModels;
    panel.notice = 'Selection saved.';
    panel.saving = false;
    await loadProviders();
    await reloadModelPicker();
    message(
      enabledModels.length
        ? `Saved: ${enabledModels.length} model${enabledModels.length === 1 ? '' : 's'} will appear in the model pickers.`
        : 'Saved: no discovered models selected. Only manual models will appear in the pickers.'
    );
  } finally {
    panel.saving = false;
    paintPanel(providerId);
  }
}

function modelPanel(provider) {
  const id = provider.id;
  const panel = ensurePanel(id);

  const details = document.createElement('details');
  details.className = 'model-panel';
  details.open = panel.open;
  const summaryInfo = textElement('span', 'model-panel-summary', '');
  const summary = document.createElement('summary');
  summary.append(textElement('span', 'model-panel-title', 'Models'), summaryInfo);

  const status = textElement('p', 'model-status', '');
  status.setAttribute('role', 'status');
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'model-search';
  search.placeholder = 'Search models';
  search.autocomplete = 'off';
  search.value = panel.query;
  search.setAttribute('aria-label', `Search models of ${provider.name}`);
  const selectAll = actionButton('Select all shown', () => {
    panel.selection = setChecked(panel.selection, filterModels(panel.models, panel.query), true, manualIdsOf(id));
    paintPanel(id);
  });
  const clear = actionButton('Clear', () => {
    panel.selection = setChecked(panel.selection, filterModels(panel.models, panel.query), false, manualIdsOf(id));
    paintPanel(id);
  });
  clear.title = 'Untick every model shown by the search';
  const toolbar = document.createElement('div');
  toolbar.className = 'model-toolbar';
  toolbar.append(search, selectAll, clear);

  const counter = textElement('div', 'hint model-counter', '');
  counter.setAttribute('aria-live', 'polite');
  const list = document.createElement('div');
  list.className = 'model-list';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', `Models of ${provider.name}`);

  const save = actionButton('Save selection', () =>
    saveModelSelection(id).catch((error) => message(error.message, true))
  );
  save.className = 'button primary';
  const dirty = textElement('span', 'hint', '');
  const actions = document.createElement('div');
  actions.className = 'model-actions';
  actions.append(save, dirty);

  const body = document.createElement('div');
  body.className = 'model-panel-body';
  body.append(status, toolbar, counter, list, actions);
  details.append(summary, body);

  details.addEventListener('toggle', () => {
    panel.open = details.open;
    if (details.open && panel.status === 'idle') loadModelPanel(id);
  });
  search.addEventListener('input', () => {
    panel.query = search.value;
    paintPanel(id);
  });
  list.addEventListener('change', (event) => {
    const input = event.target;
    if (input?.type !== 'checkbox') return;
    panel.selection = setChecked(panel.selection, [{ id: input.value }], input.checked, manualIdsOf(id));
    paintPanelMeta(id);
  });

  views.set(id, {
    details,
    summaryInfo,
    status,
    toolbar,
    search,
    selectAll,
    clear,
    counter,
    list,
    actions,
    save,
    dirty
  });
  paintPanel(id);
  return details;
}

/** Opens a provider's checklist and (re)loads its models. Never throws: failures show inside the panel. */
function showProviderModels(providerId, { force = false } = {}) {
  const panel = ensurePanel(providerId);
  panel.open = true;
  const view = views.get(providerId);
  if (view) view.details.open = true;
  return loadModelPanel(providerId, { force });
}

// ---- provider rows

function providerRow(provider) {
  const row = document.createElement('div');
  row.className = 'provider-row';

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
    actionButton('Refresh models', () =>
      refreshProviderModels(provider).catch((error) => message(error.message, true))
    ),
    actionButton('Remove', () => removeProvider(provider))
  );

  row.append(info, tag, actions);
  return row;
}

function providerItem(provider) {
  const item = document.createElement('div');
  item.className = `provider-item${provider.enabled === false ? ' disabled' : ''}`;
  item.append(providerRow(provider), modelPanel(provider));
  return item;
}

function renderProviders() {
  const list = $('providersList');
  list.replaceChildren();
  views.clear();
  if (!state.providers.length) {
    list.appendChild(textElement('p', 'subtle', 'No providers yet. Add one to start translating.'));
    return;
  }
  state.providers.forEach((provider) => list.appendChild(providerItem(provider)));
}

/** Row "Refresh models": re-discovers one provider's models, shows its checklist, then updates the picker. */
async function refreshProviderModels(provider) {
  message(`Refreshing models for ${provider.name}…`);
  await showProviderModels(provider.id, { force: true });
  await loadModels({ preferredModel: currentModel().model, preferredProvider: currentModel().modelProvider });
  const panel = ensurePanel(provider.id);
  if (panel.status === 'failed') return message(`Could not check models for ${provider.name}: ${panel.error}`, true);
  if (panel.discoveryError)
    return message(`Model discovery failed for ${provider.name}: ${panel.discoveryError}`, true);
  return message(`Models refreshed for ${provider.name}.`);
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

/**
 * Saves the form, then checks the provider's models and shows them as a checklist. The edit form
 * never sends `enabledModels`, so editing keeps the stored selection; a new provider starts empty.
 */
async function saveProvider(refresh = false) {
  const result = await request(M.SAVE_PROVIDER, providerFormPayload(), 'Unable to save provider.');
  const providerId = result.provider.id;
  closeProviderForm();
  ensurePanel(providerId).open = true;
  await loadProviders();
  // The checklist loads first so the picker reload below reads a warm catalog (no second discovery).
  await showProviderModels(providerId, { force: refresh });
  await loadModels({ preferredProvider: providerId });
  const panel = ensurePanel(providerId);
  if (panel.status === 'failed')
    return message(`Provider saved, but models could not be checked: ${panel.error}`, true);
  if (panel.discoveryError) return message(`Provider saved, but model discovery failed: ${panel.discoveryError}`, true);
  const done = refresh ? 'Provider saved and models refreshed.' : 'Provider saved.';
  const discovered = selectableModels(panel.models, manualIdsOf(providerId)).length;
  const needsChoice = panel.enabledModels !== null && !panel.enabledModels.length && discovered > 0;
  return message(needsChoice ? `${done} Tick the models you want to use, then click Save selection.` : done);
}

async function removeProvider(provider) {
  if (!confirm(`Remove ${provider.name}? This only removes its local configuration.`)) return;
  const result = await chrome.runtime.sendMessage({ type: M.REMOVE_PROVIDER, payload: { id: provider.id } });
  if (!result?.ok) return message(result?.error || 'Unable to remove provider.', true);
  state.panels.delete(provider.id);
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

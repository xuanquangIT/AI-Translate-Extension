const languages = [['auto', 'Auto detect'], ['en', 'English'], ['vi', 'Vietnamese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['fr', 'French'], ['es', 'Spanish'], ['de', 'German'], ['ru', 'Russian'], ['pt', 'Portuguese'], ['it', 'Italian'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['th', 'Thai'], ['id', 'Indonesian'], ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish'], ['uk', 'Ukrainian']];
const $ = (id) => document.getElementById(id);
const state = { settings: {}, providers: [], models: [], favorites: [], errors: {} };

function message(text, error = false) { const el = $('status'); el.textContent = text || ''; el.className = `status${error ? ' error' : ''}`; }
function option(select, value, label) { const el = document.createElement('option'); el.value = value; el.textContent = label; select.appendChild(el); return el; }
function favoriteKey(model, provider) { return model && provider ? `${provider}::${model}` : ''; }
function selectedModel() { const selected = $('model').selectedOptions[0]; return { model: selected?.value || '', modelProvider: selected?.dataset.provider || '' }; }
function maskKey(value) { return value ? `••••${value.slice(-4)}` : 'No key'; }

function fillLanguages() {
  for (const [code, label] of languages) option($('fromLang'), code, label);
  for (const [code, label] of languages.filter(([code]) => code !== 'auto')) option($('toLang'), code, label);
}

function renderModels(preferredModel = state.settings.model, preferredProvider = state.settings.modelProvider) {
  const select = $('model'); select.replaceChildren();
  const favoriteSet = new Set(state.favorites);
  const favorites = state.models.filter((item) => item.isFavorite);
  if (favorites.length) {
    const group = document.createElement('optgroup'); group.label = 'Favorites';
    favorites.forEach((item) => appendModel(group, item, true)); select.appendChild(group);
  }
  for (const provider of state.providers) {
    const models = state.models.filter((item) => item.provider === provider.id && !favoriteSet.has(favoriteKey(item.id, item.provider)));
    if (!models.length) continue;
    const group = document.createElement('optgroup'); group.label = provider.name;
    models.forEach((item) => appendModel(group, item)); select.appendChild(group);
  }
  if (!select.options.length) option(select, '', 'Add a provider or a manual model').disabled = true;
  const exact = [...select.options].find((item) => item.value === preferredModel && item.dataset.provider === preferredProvider) || [...select.options].find((item) => item.value === preferredModel);
  if (exact) exact.selected = true; else [...select.options].find((item) => !item.disabled)?.setAttribute('selected', 'selected');
  updateFavoriteButton();
  const errorText = Object.values(state.errors).filter(Boolean)[0];
  $('modelHelp').textContent = errorText || 'Favorites appear first and are used as fallback candidates.';
}

function appendModel(group, item, favorite = false) {
  const el = option(group, item.id, `${favorite ? '★ ' : ''}${item.label}${item.tier === 'manual' ? ' · manual' : ''}`);
  el.dataset.provider = item.provider; el.title = item.id;
}

function updateFavoriteButton() {
  const selected = selectedModel();
  const favorited = state.favorites.includes(favoriteKey(selected.model, selected.modelProvider));
  $('btnFavoriteModel').disabled = !selected.model;
  $('btnFavoriteModel').textContent = favorited ? 'Unfavorite' : 'Favorite';
}

function renderProviders() {
  const list = $('providersList'); list.replaceChildren();
  if (!state.providers.length) { const empty = document.createElement('p'); empty.className = 'subtle'; empty.textContent = 'No providers yet. Add one to start translating.'; list.appendChild(empty); return; }
  for (const provider of state.providers) {
    const row = document.createElement('div'); row.className = `provider-row${provider.enabled === false ? ' disabled' : ''}`;
    const info = document.createElement('div'); info.className = 'provider-info';
    const name = document.createElement('div'); name.className = 'provider-name'; name.textContent = provider.name;
    const meta = document.createElement('div'); meta.className = 'provider-meta'; meta.textContent = `${provider.apiType === 'anthropic' ? 'Anthropic-compatible' : 'OpenAI-compatible'} · ${provider.baseUrl} · ${maskKey(provider.apiKey)} · ${provider.manualModels?.length || 0} manual models`;
    info.append(name, meta);
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = provider.enabled === false ? 'Disabled' : 'Ready';
    const actions = document.createElement('div'); actions.className = 'row-actions';
    actions.append(actionButton('Edit', () => editProvider(provider)), actionButton('Refresh models', () => refreshModels(provider.id)), actionButton('Remove', () => removeProvider(provider)));
    row.append(info, tag, actions); list.appendChild(row);
  }
}

function actionButton(label, handler) { const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = label; button.addEventListener('click', handler); return button; }

function openProviderForm(provider = null) {
  $('providerForm').hidden = false; $('providerFormTitle').textContent = provider ? 'Edit provider' : 'Add provider';
  $('providerId').value = provider?.id || ''; $('providerName').value = provider?.name || ''; $('providerApiType').value = provider?.apiType || 'openai'; $('providerBaseUrl').value = provider?.baseUrl || ''; $('providerApiKey').value = provider?.apiKey || ''; $('providerManualModels').value = (provider?.manualModels || []).join('\n');
  $('providerName').focus();
}
function closeProviderForm() { $('providerForm').hidden = true; $('providerForm').reset(); $('providerId').value = ''; }
function editProvider(provider) { openProviderForm(provider); }

async function saveProvider(refresh = false) {
  const payload = { id: $('providerId').value || undefined, name: $('providerName').value, apiType: $('providerApiType').value, baseUrl: $('providerBaseUrl').value, apiKey: $('providerApiKey').value, manualModels: $('providerManualModels').value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) };
  const result = await chrome.runtime.sendMessage({ type: 'SAVE_PROVIDER', payload });
  if (!result?.ok) throw new Error(result?.error || 'Unable to save provider.');
  closeProviderForm(); await loadProviders(); await loadModels({ force: refresh, providerId: result.provider.id, preferredProvider: result.provider.id }); message(refresh ? 'Provider saved and models refreshed.' : 'Provider saved.');
}
async function removeProvider(provider) { if (!confirm(`Remove ${provider.name}? This only removes its local configuration.`)) return; const result = await chrome.runtime.sendMessage({ type: 'REMOVE_PROVIDER', payload: { id: provider.id } }); if (!result?.ok) return message(result?.error || 'Unable to remove provider.', true); await loadProviders(); await loadModels(); message('Provider removed.'); }
async function refreshModels(providerId = '') { message('Refreshing model catalog…'); await loadModels({ force: true, providerId }); message('Model catalog refreshed.'); }

async function loadProviders() { const result = await chrome.runtime.sendMessage({ type: 'GET_PROVIDERS' }); if (!result?.ok) throw new Error(result?.error || 'Unable to load providers.'); state.providers = result.providers || []; renderProviders(); }
async function loadModels({ force = false, providerId = '', preferredModel, preferredProvider } = {}) { const type = force ? 'REFRESH_PROVIDER_MODELS' : 'GET_AVAILABLE_MODELS'; const result = await chrome.runtime.sendMessage({ type, payload: force ? { providerId } : undefined }); if (!result?.ok) throw new Error(result?.error || 'Unable to load models.'); state.models = result.models || []; state.favorites = result.favoriteModels || []; state.errors = result.errors || {}; if (!state.providers.length) state.providers = result.providers || []; renderModels(preferredModel, preferredProvider); }

async function loadInstructions() {
  const result = await chrome.runtime.sendMessage({ type: 'GET_INSTRUCTIONS' }); const list = $('instructionsList'); list.replaceChildren();
  for (const item of result?.instructions || []) {
    const row = document.createElement('div'); row.className = 'instruction-row'; const info = document.createElement('div'); info.className = 'instruction-info';
    const name = document.createElement('div'); name.className = 'instruction-name'; name.textContent = item.name; const text = document.createElement('div'); text.className = 'instruction-text'; text.textContent = item.text; info.append(name, text);
    const actions = document.createElement('div'); actions.className = 'row-actions'; actions.append(actionButton(item.enabled ? 'Disable' : 'Enable', async () => { await chrome.runtime.sendMessage({ type: 'TOGGLE_INSTRUCTION', payload: { id: item.id } }); loadInstructions(); }), actionButton('Edit', () => { $('instructionId').value = item.id; $('instructionName').value = item.name; $('instructionText').value = item.text; $('btnCancelInstruction').hidden = false; $('instructionName').focus(); }), actionButton('Remove', async () => { await chrome.runtime.sendMessage({ type: 'REMOVE_INSTRUCTION', payload: { id: item.id } }); loadInstructions(); })); row.append(info, actions); list.appendChild(row);
  }
  if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'subtle'; empty.textContent = 'No reusable preferences yet.'; list.appendChild(empty); }
}

function clearInstructionForm() { $('instructionForm').reset(); $('instructionId').value = ''; $('btnCancelInstruction').hidden = true; }

async function init() {
  fillLanguages();
  const result = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }); if (!result?.ok) throw new Error(result?.error || 'Unable to load settings.');
  state.settings = result.settings || {}; $('fromLang').value = state.settings.fromLang || 'auto'; $('toLang').value = state.settings.toLang || 'vi'; $('systemPrompt').value = state.settings.systemPrompt || '';
  document.querySelector(`input[name="displayMode"][value="${state.settings.translationDisplayMode || 'badge'}"]`).checked = true;
  await loadProviders(); await loadModels(); await loadInstructions();
}

$('btnNewProvider').addEventListener('click', () => openProviderForm()); $('btnCancelProvider').addEventListener('click', closeProviderForm); $('providerForm').addEventListener('submit', async (event) => { event.preventDefault(); try { await saveProvider(false); } catch (error) { message(error.message, true); } }); $('btnSaveAndRefresh').addEventListener('click', async () => { try { await saveProvider(true); } catch (error) { message(error.message, true); } });
$('btnRefreshModels').addEventListener('click', async () => { try { await refreshModels(); } catch (error) { message(error.message, true); } });
$('model').addEventListener('change', updateFavoriteButton); $('btnFavoriteModel').addEventListener('click', async () => { const selected = selectedModel(); const result = await chrome.runtime.sendMessage({ type: 'TOGGLE_FAVORITE_MODEL', payload: selected }); if (!result?.ok) return message(result?.error || 'Unable to change favorite.', true); state.favorites = result.favoriteModels || []; renderModels(selected.model, selected.modelProvider); });
$('btnSaveDefaults').addEventListener('click', async () => { const selected = selectedModel(); const mode = document.querySelector('input[name="displayMode"]:checked').value; const payload = { ...selected, fromLang: $('fromLang').value, toLang: $('toLang').value, translationDisplayMode: mode, systemPrompt: $('systemPrompt').value.trim() }; const result = await chrome.runtime.sendMessage({ type: 'SAVE_DEFAULT_SETTINGS', payload }); if (!result?.ok) return message(result?.error || 'Unable to save defaults.', true); await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload }); message('Translation defaults saved.'); });
$('instructionForm').addEventListener('submit', async (event) => { event.preventDefault(); const id = $('instructionId').value; const payload = { id, name: $('instructionName').value || 'Preference', text: $('instructionText').value }; const result = await chrome.runtime.sendMessage({ type: id ? 'UPDATE_INSTRUCTION' : 'ADD_INSTRUCTION', payload }); if (!result?.ok) return message(result?.error || 'Unable to save preference.', true); clearInstructionForm(); await loadInstructions(); message('Preference saved.'); }); $('btnCancelInstruction').addEventListener('click', clearInstructionForm);

init().catch((error) => message(error.message, true));

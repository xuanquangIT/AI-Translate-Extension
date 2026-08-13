const languages = [['auto', 'Auto detect'], ['en', 'English'], ['vi', 'Vietnamese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['fr', 'French'], ['es', 'Spanish'], ['de', 'German'], ['ru', 'Russian'], ['pt', 'Portuguese'], ['it', 'Italian'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['th', 'Thai'], ['id', 'Indonesian'], ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish'], ['uk', 'Ukrainian']];
const $ = (id) => document.getElementById(id);
const state = { settings: {}, providers: [], models: [], favorites: [], errors: {} };
let promptSaveTimer;

function setStatus(text = '', error = false) { const el = $('status'); el.textContent = text; el.className = `status${error ? ' error' : ''}`; }
function addOption(parent, value, label) { const option = document.createElement('option'); option.value = value; option.textContent = label; parent.appendChild(option); return option; }
function selectedModel() { const option = $('model').selectedOptions[0]; return { model: option?.value || '', modelProvider: option?.dataset.provider || '' }; }
function keyOf(model, provider) { return model && provider ? `${provider}::${model}` : ''; }

function fillLanguages() { languages.forEach(([code, label]) => addOption($('fromLang'), code, label)); languages.filter(([code]) => code !== 'auto').forEach(([code, label]) => addOption($('toLang'), code, label)); }

function renderModels(preferredModel = state.settings.model, preferredProvider = state.settings.modelProvider) {
  const select = $('model'); select.replaceChildren(); const favoriteSet = new Set(state.favorites);
  const favorites = state.models.filter((item) => item.isFavorite);
  if (favorites.length) { const group = document.createElement('optgroup'); group.label = 'Favorites'; favorites.forEach((item) => addModel(group, item, true)); select.appendChild(group); }
  for (const provider of state.providers) {
    const models = state.models.filter((item) => item.provider === provider.id && !favoriteSet.has(keyOf(item.id, item.provider)));
    if (!models.length) continue;
    const group = document.createElement('optgroup'); group.label = provider.name; models.forEach((item) => addModel(group, item)); select.appendChild(group);
  }
  if (!select.options.length) addOption(select, '', 'Configure a provider in Settings').disabled = true;
  const chosen = [...select.options].find((item) => item.value === preferredModel && item.dataset.provider === preferredProvider) || [...select.options].find((item) => item.value === preferredModel) || [...select.options].find((item) => !item.disabled);
  if (chosen) chosen.selected = true;
  updateFavorite();
  const selected = selectedModel(); const provider = state.providers.find((item) => item.id === selected.modelProvider);
  $('providerSummary').textContent = provider ? `${provider.name} · ${selected.model || 'choose a model'}` : 'Set up a provider to begin';
}

function addModel(group, item, favorite = false) { const option = addOption(group, item.id, `${favorite ? '★ ' : ''}${item.label}${item.tier === 'manual' ? ' · manual' : ''}`); option.dataset.provider = item.provider; option.title = item.id; }
function updateFavorite() { const selected = selectedModel(); const favorite = state.favorites.includes(keyOf(selected.model, selected.modelProvider)); $('btnFavorite').disabled = !selected.model; $('btnFavorite').textContent = favorite ? '★' : '☆'; $('btnFavorite').title = favorite ? 'Remove favorite' : 'Add favorite'; }
function updatePlacement(mode) { document.querySelectorAll('.mode-button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode)); }

async function loadModels(force = false, preferred = {}) {
  const response = await chrome.runtime.sendMessage({ type: force ? 'REFRESH_PROVIDER_MODELS' : 'GET_AVAILABLE_MODELS', payload: force ? {} : undefined });
  if (!response?.ok) throw new Error(response?.error || 'Unable to load model catalog.');
  state.models = response.models || []; state.favorites = response.favoriteModels || []; state.errors = response.errors || {}; state.providers = response.providers || state.providers;
  renderModels(preferred.model, preferred.modelProvider);
  const error = Object.values(state.errors).filter(Boolean)[0]; if (error) setStatus(error, true);
}

async function saveSession() { const selected = selectedModel(); await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { ...selected, fromLang: $('fromLang').value, toLang: $('toLang').value } }); }
async function saveSystemPrompt({ announce = false } = {}) {
  clearTimeout(promptSaveTimer);
  promptSaveTimer = undefined;
  const systemPrompt = $('systemPrompt').value.trim();
  const response = await chrome.runtime.sendMessage({ type: 'SAVE_DEFAULT_SETTINGS', payload: { systemPrompt } });
  if (!response?.ok) throw new Error(response?.error || 'Unable to save the system prompt.');
  state.settings.systemPrompt = systemPrompt;
  if (announce) setStatus('Custom system prompt saved.');
}
function scheduleSystemPromptSave() {
  clearTimeout(promptSaveTimer);
  promptSaveTimer = setTimeout(() => saveSystemPrompt().catch((error) => setStatus(error.message, true)), 500);
}
async function ensureSystemPromptSaved() { await saveSystemPrompt(); }
function translationPayload() { return { ...selectedModel(), fromLang: $('fromLang').value, toLang: $('toLang').value }; }
function setBusy(button, busy, label) { button.disabled = busy; if (!button.dataset.label) button.dataset.label = button.textContent; button.textContent = busy ? label : button.dataset.label; }

async function activeTabId() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw new Error('No active tab is available.'); return tab.id; }

async function translateDirect() {
  const text = $('directInput').value.trim(); if (!text) return setStatus('Enter text to translate.', true);
  const button = $('btnDirectTranslate'); setBusy(button, true, 'Translating…'); $('directOutput').hidden = true; setStatus('');
  try { await ensureSystemPromptSaved(); const result = await chrome.runtime.sendMessage({ type: 'TRANSLATE_TEXT', payload: { ...translationPayload(), text } }); if (!result?.ok) throw new Error(result?.error || 'Translation failed.'); $('directOutputText').textContent = result.translation; $('directOutput').hidden = false; setStatus('Translation complete.'); } catch (error) { setStatus(error.message, true); } finally { setBusy(button, false); }
}

async function translateSelection() {
  const button = $('btnSelection'); setBusy(button, true, 'Working…'); setStatus('Translation will continue even if this popup closes.');
  try { await ensureSystemPromptSaved(); const result = await chrome.runtime.sendMessage({ type: 'TRANSLATE_SELECTION_IN_TAB', payload: { ...translationPayload(), tabId: await activeTabId() } }); if (!result?.ok) throw new Error(result?.error || 'Translation failed.'); setStatus('Translation inserted into the page.'); } catch (error) { setStatus(error.message, true); } finally { setBusy(button, false); }
}

async function translatePage() {
  const button = $('btnTranslatePage'); setBusy(button, true, 'Translating…'); setStatus('Page translation will continue even if this popup closes.');
  try { await ensureSystemPromptSaved(); const result = await chrome.runtime.sendMessage({ type: 'TRANSLATE_PAGE_IN_TAB', payload: { ...translationPayload(), tabId: await activeTabId() } }); if (!result?.ok) throw new Error(result?.error || 'Page translation failed.'); setStatus(`Translated ${result.translatedCount} of ${result.segmentCount} segments.`); } catch (error) { setStatus(error.message, true); } finally { setBusy(button, false); }
}

async function renderHistory() { const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' }); const list = $('historyList'); list.replaceChildren(); for (const item of response?.history || []) { const row = document.createElement('div'); row.className = 'history-item'; const source = document.createElement('div'); source.className = 'history-source'; source.textContent = item.sourceText; const result = document.createElement('div'); result.className = 'history-result'; result.textContent = item.translation; row.append(source, result); list.appendChild(row); } if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'status'; empty.textContent = 'No recent translations.'; list.appendChild(empty); } }

async function init() {
  fillLanguages(); const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }); if (!response?.ok) throw new Error(response?.error || 'Unable to load settings.');
  state.settings = response.settings || {}; $('fromLang').value = state.settings.fromLang || 'auto'; $('toLang').value = state.settings.toLang || 'vi'; $('systemPrompt').value = state.settings.systemPrompt || ''; $('enableSelection').checked = state.settings.enableSelection !== false; updatePlacement(state.settings.translationDisplayMode || 'badge');
  const providers = await chrome.runtime.sendMessage({ type: 'GET_PROVIDERS' }); state.providers = providers?.providers || []; await loadModels(false);
}

$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage()); $('fromLang').addEventListener('change', saveSession); $('toLang').addEventListener('change', saveSession); $('model').addEventListener('change', () => { updateFavorite(); saveSession(); const selected = selectedModel(); const provider = state.providers.find((item) => item.id === selected.modelProvider); $('providerSummary').textContent = provider ? `${provider.name} · ${selected.model}` : ''; });
$('btnRefreshModels').addEventListener('click', async () => { const button = $('btnRefreshModels'); setBusy(button, true, '…'); try { await loadModels(true, selectedModel()); setStatus('Model catalog refreshed.'); } catch (error) { setStatus(error.message, true); } finally { setBusy(button, false); } });
$('btnFavorite').addEventListener('click', async () => { const selected = selectedModel(); const result = await chrome.runtime.sendMessage({ type: 'TOGGLE_FAVORITE_MODEL', payload: selected }); if (!result?.ok) return setStatus(result?.error || 'Unable to change favorite.', true); state.favorites = result.favoriteModels || []; renderModels(selected.model, selected.modelProvider); });
$('systemPrompt').addEventListener('input', scheduleSystemPromptSave); $('btnSaveSystemPrompt').addEventListener('click', async () => { const button = $('btnSaveSystemPrompt'); setBusy(button, true, 'Saving…'); try { await saveSystemPrompt({ announce: true }); } catch (error) { setStatus(error.message, true); } finally { setBusy(button, false); } });
window.addEventListener('blur', () => { if (promptSaveTimer) saveSystemPrompt().catch(() => {}); });
$('btnDirectTranslate').addEventListener('click', translateDirect); $('directInput').addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); translateDirect(); } }); $('btnSelection').addEventListener('click', translateSelection); $('btnTranslatePage').addEventListener('click', translatePage);
$('btnCopyDirect').addEventListener('click', () => navigator.clipboard.writeText($('directOutputText').textContent).then(() => setStatus('Copied.')).catch(() => setStatus('Unable to copy.', true))); $('enableSelection').addEventListener('change', async (event) => { const enabled = event.target.checked; await chrome.storage.local.set({ enableSelection: enabled }); const tabs = await chrome.tabs.query({}); await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'SET_SELECTION_ENABLED', enabled }).catch(() => {}))); setStatus(enabled ? 'Selection tools enabled.' : 'Selection tools disabled.'); });
document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', async () => { const mode = button.dataset.mode; updatePlacement(mode); await chrome.storage.local.set({ translationDisplayMode: mode }); const tabs = await chrome.tabs.query({}); await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'SET_DISPLAY_MODE', mode }).catch(() => {}))); setStatus(`${mode === 'replace' ? 'Replace' : 'Badge'} placement selected.`); }));
$('btnHistory').addEventListener('click', async () => { const panel = $('historyPanel'); panel.hidden = !panel.hidden; if (!panel.hidden) await renderHistory(); }); $('btnClearHistory').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' }); renderHistory(); });

init().catch((error) => setStatus(error.message, true));

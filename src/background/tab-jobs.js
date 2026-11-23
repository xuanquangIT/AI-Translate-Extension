/**
 * Tab-scoped jobs owned by the service worker so they survive popup closure.
 * Talks to the content script through CONTENT_MESSAGES only.
 */

import { CONTENT_MESSAGES, CONTENT_SCRIPT_FILE } from '../shared/messages.js';
import { sanitizeIncomingText } from '../shared/text.js';
import { translateSingleText } from './translation-service.js';

/** Injects the content script; safe because the script guards against double load. Fails silently on restricted tabs. */
export async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] }).catch(() => {});
}

export async function getSelectionFromTab(tabId, fallbackText) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: CONTENT_MESSAGES.GET_SELECTION });
    if (response?.ok && response.text) return response;
  } catch (_) {
    // Content script unavailable: fall back to the browser-provided text.
  }
  return { text: sanitizeIncomingText(fallbackText), selectionId: '' };
}

export async function showToastInTab(tabId, message, toastType = 'info') {
  await chrome.tabs.sendMessage(tabId, { type: CONTENT_MESSAGES.SHOW_TOAST, message, toastType }).catch(() => {});
}

export async function translateSelectionInTab({ tabId, ...request } = {}) {
  if (!tabId) throw new Error('No target tab is available.');
  await ensureContentScript(tabId);
  const selection = await getSelectionFromTab(tabId, request.text);
  const translation = await translateSingleText({ ...request, text: selection.text });
  const inserted = await chrome.tabs.sendMessage(tabId, {
    type: CONTENT_MESSAGES.INSERT_TRANSLATION,
    translation,
    selectionId: selection.selectionId
  });
  if (!inserted?.ok)
    throw new Error(inserted?.error || 'The translation completed but could not be inserted into the page.');
  return { translation };
}

const PAGE_UNAVAILABLE = 'LingoFlux cannot access this page. Browser and store pages cannot be translated.';

/**
 * Starts (or restarts with new options) a live page-translation session in the tab and returns at once.
 * The content script then translates what is on screen first, more as the user scrolls, and re-applies
 * cached translations when the page re-renders. Each batch comes back through `TRANSLATE_PAGE`.
 */
export async function translatePageInTab({ tabId, fromLang, toLang, model, modelProvider } = {}) {
  if (!tabId) throw new Error('No target tab is available.');
  await ensureContentScript(tabId);
  const options = { fromLang, toLang, model, modelProvider };
  const response = await chrome.tabs
    .sendMessage(tabId, { type: CONTENT_MESSAGES.TRANSLATE_PAGE_START, options })
    .catch(() => null);
  if (!response) throw new Error(PAGE_UNAVAILABLE);
  if (!response.ok) throw new Error(response.error || 'Page translation could not start.');
  return { started: true, pending: response.pending || 0 };
}

/** Stops the tab's page-translation session and restores the original text. */
export async function restorePageInTab({ tabId } = {}) {
  if (!tabId) throw new Error('No target tab is available.');
  const response = await chrome.tabs
    .sendMessage(tabId, { type: CONTENT_MESSAGES.TRANSLATE_PAGE_RESTORE })
    .catch(() => null);
  if (!response) return { restored: 0 };
  if (!response.ok) throw new Error(response.error || 'The original page text could not be restored.');
  return { restored: response.restored || 0 };
}

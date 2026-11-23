/** Extension-page helpers for talking to the background service worker and tabs. */

import { CONTENT_MESSAGES } from '../../shared/messages.js';

/**
 * Sends a background message and returns the response, throwing on `{ ok: false }`.
 * @param {string} type One of BACKGROUND_MESSAGES.
 */
export async function request(type, payload, fallbackError = 'Request failed.') {
  const response = await chrome.runtime.sendMessage(payload === undefined ? { type } : { type, payload });
  if (!response?.ok) throw new Error(response?.error || fallbackError);
  return response;
}

/** Sends a content message to every tab; tabs without the content script are ignored. */
export async function broadcastToTabs(message) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => {})));
}

export function broadcastSelectionEnabled(enabled) {
  return broadcastToTabs({ type: CONTENT_MESSAGES.SET_SELECTION_ENABLED, enabled });
}

export function broadcastDisplayMode(mode) {
  return broadcastToTabs({ type: CONTENT_MESSAGES.SET_DISPLAY_MODE, mode });
}

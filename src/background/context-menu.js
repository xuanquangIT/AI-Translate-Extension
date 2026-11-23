/** "Translate with LingoFlux" selection context menu. */

import { CONTENT_MESSAGES, CONTEXT_MENU_ID } from '../shared/messages.js';
import { ensureContentScript, getSelectionFromTab, showToastInTab } from './tab-jobs.js';
import { translateSingleText } from './translation-service.js';

export function setupContextMenu() {
  chrome.contextMenus.removeAll(() =>
    chrome.contextMenus.create({ id: CONTEXT_MENU_ID, title: 'Translate with LingoFlux', contexts: ['selection'] })
  );
}

export async function handleContextMenuClick(info, tab) {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) return;
  try {
    await ensureContentScript(tab.id);
    const selection = await getSelectionFromTab(tab.id, info.selectionText);
    const translation = await translateSingleText({ text: selection.text });
    await chrome.tabs.sendMessage(tab.id, {
      type: CONTENT_MESSAGES.INSERT_TRANSLATION,
      translation,
      selectionId: selection.selectionId
    });
  } catch (error) {
    await showToastInTab(tab.id, error?.message || 'Translation failed.', 'error');
  }
}

/**
 * MV3 service worker entry. Only wires browser events to modules; keep logic
 * out of this file. Listeners must be registered synchronously at top level.
 */

import { handleContextMenuClick, setupContextMenu } from './context-menu.js';
import { dispatchMessage } from './router.js';
import { storageReady } from './storage-ready.js';

chrome.runtime.onInstalled.addListener(async () => {
  await storageReady;
  setupContextMenu();
});

chrome.runtime.onStartup.addListener(() => setupContextMenu());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  dispatchMessage(message).then(sendResponse);
  return true; // Keep the channel open for the async response.
});

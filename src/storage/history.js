/** Local translation history, newest first, capped at LIMITS.HISTORY_MAX_ENTRIES. */

import { LIMITS } from '../shared/config.js';
import { makeId } from './normalize.js';

export async function addTranslationHistory(entry) {
  const { translationHistory = [] } = await chrome.storage.local.get(['translationHistory']);
  const next = [{ id: makeId('history'), timestamp: Date.now(), ...entry }, ...translationHistory].slice(
    0,
    LIMITS.HISTORY_MAX_ENTRIES
  );
  await chrome.storage.local.set({ translationHistory: next });
}

export async function getTranslationHistory() {
  const { translationHistory = [] } = await chrome.storage.local.get(['translationHistory']);
  return Array.isArray(translationHistory) ? translationHistory : [];
}

export async function clearTranslationHistory() {
  await chrome.storage.local.set({ translationHistory: [] });
}

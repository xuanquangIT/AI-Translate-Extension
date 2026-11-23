/** Pure normalization helpers for stored records. No `chrome.*` access. */

import { API_TYPES } from '../shared/config.js';
import { isFavoriteModelKey } from '../shared/model-keys.js';

export function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeApiType(value) {
  return value === API_TYPES.ANTHROPIC ? API_TYPES.ANTHROPIC : API_TYPES.OPENAI;
}

function uniqueTrimmed(values, accept = Boolean) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter((value) => accept(value) && !seen.has(value) && seen.add(value));
}

export function normalizeProvider(value) {
  const provider = value && typeof value === 'object' ? value : {};
  const id = String(provider.id || '').trim();
  if (!id) return null;

  return {
    id,
    name:
      String(provider.name || 'Untitled provider')
        .trim()
        .slice(0, 80) || 'Untitled provider',
    apiType: normalizeApiType(provider.apiType),
    baseUrl: String(provider.baseUrl || '')
      .trim()
      .replace(/\/+$/, ''),
    apiKey: String(provider.apiKey || '').trim(),
    enabled: provider.enabled !== false,
    manualModels: uniqueTrimmed(provider.manualModels),
    createdAt: Number(provider.createdAt) || Date.now(),
    updatedAt: Number(provider.updatedAt) || Date.now()
  };
}

export function normalizeProviders(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map(normalizeProvider)
    .filter((provider) => provider && !seen.has(provider.id) && seen.add(provider.id));
}

export function normalizeFavoriteModels(values) {
  return uniqueTrimmed(values, isFavoriteModelKey);
}

export function isProviderReady(provider) {
  return Boolean(provider?.enabled && provider?.baseUrl && provider?.apiKey);
}

/** First ready provider and its first manual model (may be empty until discovery). */
export function pickAutoSelectedModel(providers) {
  const provider = (providers || []).find(isProviderReady);
  return provider
    ? { model: provider.manualModels[0] || '', modelProvider: provider.id }
    : { model: '', modelProvider: '' };
}

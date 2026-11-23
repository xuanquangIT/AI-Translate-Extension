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

  const normalized = {
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
  // `enabledModels` absent = legacy profile: every discovered model is offered.
  // A stored array (even empty) is authoritative.
  if (Array.isArray(provider.enabledModels)) normalized.enabledModels = uniqueTrimmed(provider.enabledModels);
  return normalized;
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

/**
 * True when `modelId` may be offered for `provider`: manual models always, discovered
 * models only when selected in `enabledModels` (legacy profiles without the field allow all).
 */
export function isModelSelectable(provider, modelId) {
  if (!provider || !modelId) return false;
  if (!Array.isArray(provider.enabledModels)) return true;
  return (provider.manualModels || []).includes(modelId) || provider.enabledModels.includes(modelId);
}

/** First ready provider and its first manual (else selected) model; may be empty until discovery. */
export function pickAutoSelectedModel(providers) {
  const provider = (providers || []).find(isProviderReady);
  return provider
    ? { model: provider.manualModels[0] || provider.enabledModels?.[0] || '', modelProvider: provider.id }
    : { model: '', modelProvider: '' };
}

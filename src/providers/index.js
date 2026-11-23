/**
 * Provider adapter registry. Adding an API interface = new adapter file
 * exporting `headers(apiKey)` and `completeChat(input)`, plus one entry in
 * `ADAPTERS` and `API_TYPES`. See the `lingoflux-provider` agent skill.
 *
 * Layer rule: no `chrome.*`, storage, or DOM access in this folder.
 */

import { API_TYPES } from '../shared/config.js';
import { buildEndpoint, fetchJson } from './http.js';
import * as anthropic from './anthropic.js';
import * as openai from './openai.js';

const MODELS_TIMEOUT_MS = 15_000;

const ADAPTERS = Object.freeze({
  [API_TYPES.OPENAI]: openai,
  [API_TYPES.ANTHROPIC]: anthropic
});

function adapterFor(provider) {
  return ADAPTERS[provider?.apiType] || openai;
}

const NON_CHAT_MODEL_TERMS = [
  'embedding',
  'rerank',
  'moderation',
  'audio',
  'speech',
  'tts',
  'whisper',
  'transcri',
  'image-generation'
];

export function isLikelyChatModel(id) {
  const value = String(id || '').toLowerCase();
  return Boolean(value) && !NON_CHAT_MODEL_TERMS.some((term) => value.includes(term));
}

function normalizeModel(raw, provider) {
  const id = String(raw?.id || raw?.name || raw?.model || '')
    .replace(/^models\//, '')
    .trim();
  if (!id || !isLikelyChatModel(id)) return null;
  return {
    id,
    label: String(raw?.display_name || raw?.displayName || raw?.name || id),
    provider: provider.id,
    apiType: provider.apiType,
    tier: 'api'
  };
}

/** Lists chat-capable models from `{base}/models`, sorted by label. */
export async function listProviderModels(provider) {
  const data = await fetchJson(
    buildEndpoint(provider.baseUrl, '/models'),
    { method: 'GET', headers: adapterFor(provider).headers(provider.apiKey) },
    MODELS_TIMEOUT_MS,
    `${provider.name} model discovery`
  );
  const rawModels = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return rawModels
    .map((raw) => normalizeModel(raw, provider))
    .filter(Boolean)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Sends one system + user exchange and returns the raw assistant text. */
export function completeChat(input) {
  return adapterFor(input.provider).completeChat(input);
}

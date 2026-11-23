/** Anthropic-compatible adapter: `{base}/models`, `{base}/messages`, `x-api-key` auth. */

import { buildEndpoint, fetchJson } from './http.js';

const ANTHROPIC_VERSION = '2023-06-01';

export function headers(apiKey) {
  return { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION };
}

function extractText(data) {
  const text = (Array.isArray(data?.content) ? data.content : [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Anthropic-compatible provider returned an empty response.');
  return text;
}

export async function completeChat({ provider, model, system, user, maxTokens, timeoutMs, label }) {
  const data = await fetchJson(
    buildEndpoint(provider.baseUrl, '/messages'),
    {
      method: 'POST',
      headers: headers(provider.apiKey),
      body: JSON.stringify({
        model,
        system,
        messages: [{ role: 'user', content: user }],
        temperature: 0,
        max_tokens: maxTokens
      })
    },
    timeoutMs,
    label
  );
  return extractText(data);
}

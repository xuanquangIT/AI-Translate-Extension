/** OpenAI-compatible adapter: `{base}/models`, `{base}/chat/completions`, Bearer auth. */

import { buildEndpoint, fetchJson } from './http.js';

export function headers(apiKey) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('\n')
      .trim();
    if (text) return text;
  }
  throw new Error('OpenAI-compatible provider returned an empty response.');
}

export async function completeChat({ provider, model, system, user, maxTokens, timeoutMs, label }) {
  const data = await fetchJson(
    buildEndpoint(provider.baseUrl, '/chat/completions'),
    {
      method: 'POST',
      headers: headers(provider.apiKey),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0,
        max_tokens: maxTokens
      })
    },
    timeoutMs,
    label
  );
  return extractText(data);
}

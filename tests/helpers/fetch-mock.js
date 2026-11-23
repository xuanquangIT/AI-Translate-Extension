/** Replaces globalThis.fetch for one test. Returns captured requests; restore with `t.after`. */

export function mockFetch(t, responder) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
    return responder(url, options, calls.length - 1);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

export function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

export const openAiChat = (content) => jsonResponse({ choices: [{ message: { content } }] });
export const anthropicChat = (text) => jsonResponse({ content: [{ type: 'text', text }] });

export const testProvider = (overrides = {}) => ({
  id: 'test-openai',
  name: 'Test OpenAI',
  apiType: 'openai',
  baseUrl: 'https://provider.example/v1',
  apiKey: 'test-only',
  enabled: true,
  manualModels: [],
  ...overrides
});

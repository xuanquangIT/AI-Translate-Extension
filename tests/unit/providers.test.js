import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEndpoint } from '../../src/providers/http.js';
import { isLikelyChatModel, listProviderModels } from '../../src/providers/index.js';
import { jsonResponse, mockFetch, testProvider } from '../helpers/fetch-mock.js';

test('buildEndpoint trims slashes and does not duplicate the path', () => {
  assert.equal(buildEndpoint('https://a.example/v1/', '/models'), 'https://a.example/v1/models');
  assert.equal(buildEndpoint('https://a.example/v1/models', '/models'), 'https://a.example/v1/models');
  assert.throws(() => buildEndpoint('  ', '/models'), /base URL is required/);
});

test('isLikelyChatModel filters non-chat models', () => {
  assert.equal(isLikelyChatModel('gpt-4.1-mini'), true);
  for (const id of ['text-embedding-3', 'whisper-1', 'tts-1', 'omni-moderation', '']) {
    assert.equal(isLikelyChatModel(id), false, id);
  }
});

test('listProviderModels normalizes OpenAI `data` and Gemini `models/` IDs, sorted by label', async (t) => {
  mockFetch(t, () =>
    jsonResponse({
      data: [{ id: 'zeta-chat' }, { id: 'text-embedding-3' }, { id: 'models/alpha-chat', display_name: 'Alpha' }]
    })
  );
  const models = await listProviderModels(testProvider());
  assert.deepEqual(
    models.map((model) => [model.id, model.label, model.provider, model.tier]),
    [
      ['alpha-chat', 'Alpha', 'test-openai', 'api'],
      ['zeta-chat', 'zeta-chat', 'test-openai', 'api']
    ]
  );
});

test('listProviderModels uses Anthropic headers for Anthropic profiles', async (t) => {
  const calls = mockFetch(t, () => jsonResponse({ data: [] }));
  await listProviderModels(testProvider({ apiType: 'anthropic' }));
  assert.equal(calls[0].options.headers['x-api-key'], 'test-only');
  assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01');
});

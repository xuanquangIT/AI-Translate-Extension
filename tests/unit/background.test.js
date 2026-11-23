/** Service-worker orchestration: router envelope, cache, fallback. Uses chrome + fetch mocks. */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { installChromeMock, resetChromeStorage } from '../helpers/chrome-mock.js';
import { jsonResponse, mockFetch, openAiChat } from '../helpers/fetch-mock.js';

const chrome = installChromeMock();
const { dispatchMessage, handlers } = await import('../../src/background/router.js');
const { storageReady } = await import('../../src/background/storage-ready.js');
const { translationCacheKey } = await import('../../src/background/translation-cache.js');
const { resetRateLimiter } = await import('../../src/background/rate-limiter.js');
await storageReady;

const provider = (id, manualModels) => ({
  id,
  name: id,
  apiType: 'openai',
  baseUrl: `https://${id}.example/v1`,
  apiKey: `key-${id}`,
  enabled: true,
  manualModels
});

function seed({ favoriteModels = [] } = {}) {
  resetChromeStorage(chrome, {
    local: {
      genericProviderMigrationVersion: 1,
      providers: [provider('p1', ['m1']), provider('p2', ['m2'])],
      modelProvider: 'p1',
      model: 'm1',
      favoriteModels,
      instructions: []
    }
  });
}

beforeEach(() => {
  seed();
  resetRateLimiter();
});

describe('router envelope', () => {
  test('unknown types return ok:false', async () => {
    assert.deepEqual(await dispatchMessage({ type: 'NOPE' }), { ok: false, error: 'Unknown message type.' });
    assert.deepEqual(await dispatchMessage({ type: 'toString' }), { ok: false, error: 'Unknown message type.' });
  });

  test('handler errors become ok:false with the message', async () => {
    const response = await dispatchMessage({ type: 'TRANSLATE_TEXT', payload: { text: 'x' } });
    assert.deepEqual(response, { ok: false, error: 'Select at least two characters to translate.' });
  });

  test('void handlers return ok:true', async () => {
    assert.deepEqual(await dispatchMessage({ type: 'CLEAR_HISTORY' }), { ok: true });
  });

  test('every handler is a function', () => {
    for (const [type, handler] of Object.entries(handlers)) assert.equal(typeof handler, 'function', type);
  });
});

describe('translation service', () => {
  test('translates, caches, and records history', async (t) => {
    const calls = mockFetch(t, () => openAiChat('{"translation":"Xin chào"}'));
    const first = await dispatchMessage({ type: 'TRANSLATE_TEXT', payload: { text: 'Hello' } });
    const second = await dispatchMessage({ type: 'TRANSLATE_TEXT', payload: { text: 'Hello' } });

    assert.deepEqual(first, { ok: true, translation: 'Xin chào' });
    assert.deepEqual(second, first);
    assert.equal(calls.length, 1, 'second call is served from the session cache');
    const history = (await dispatchMessage({ type: 'GET_HISTORY' })).history;
    assert.equal(history[0].model, 'p1: m1');
  });

  test('falls back to a favorite on another provider when the primary fails', async (t) => {
    seed({ favoriteModels: ['p2::m2'] });
    const calls = mockFetch(t, (url) => {
      if (url.endsWith('/models')) return jsonResponse({ data: [] });
      if (url.startsWith('https://p1.')) return { ok: false, status: 500, text: async () => 'down' };
      return openAiChat('{"translation":"Bonjour"}');
    });
    const response = await dispatchMessage({ type: 'TRANSLATE_TEXT', payload: { text: 'Hello there' } });

    assert.deepEqual(response, { ok: true, translation: 'Bonjour' });
    const chatCalls = calls.filter((call) => call.url.endsWith('/chat/completions'));
    assert.deepEqual(
      chatCalls.map((call) => [call.url, call.body.model]),
      [
        ['https://p1.example/v1/chat/completions', 'm1'],
        ['https://p2.example/v1/chat/completions', 'm2']
      ]
    );
  });

  test('cache keys never contain the API key and change with the model', () => {
    const input = {
      text: 'Hi',
      fromLang: 'en',
      toLang: 'vi',
      model: 'm1',
      modelProvider: 'p1',
      systemPrompt: '',
      styleInstruction: ''
    };
    const key = translationCacheKey(input);
    assert.match(key, /^translation_v3_/);
    assert.notEqual(key, translationCacheKey({ ...input, model: 'm2' }));
  });
});

describe('page translation batches', () => {
  const batchReply = (items) => openAiChat(JSON.stringify({ translations: items }));
  const segments = [
    { id: 's0', text: 'Hello' },
    { id: 's1', text: 'Goodbye' }
  ];
  const chatCalls = (calls) => calls.filter((call) => call.url.endsWith('/chat/completions'));

  test('translates a batch and serves repeated segments from the session cache', async (t) => {
    const calls = mockFetch(t, () =>
      batchReply([
        { id: 's0', text: 'Xin chào' },
        { id: 's1', text: 'Tạm biệt' }
      ])
    );
    const first = await dispatchMessage({ type: 'TRANSLATE_PAGE', payload: { segments } });
    assert.deepEqual(first, {
      ok: true,
      translations: [
        { id: 's0', text: 'Xin chào' },
        { id: 's1', text: 'Tạm biệt' }
      ],
      failedIds: []
    });

    const second = await dispatchMessage({
      type: 'TRANSLATE_PAGE',
      payload: { segments: [{ id: 'x7', text: 'Goodbye' }] }
    });
    assert.deepEqual(second.translations, [{ id: 'x7', text: 'Tạm biệt' }]);
    assert.equal(chatCalls(calls).length, 1, 'cached segments never reach the provider');
  });

  test('partial output is a success; skipped IDs get one follow-up request', async (t) => {
    const calls = mockFetch(t, (url, options, index) =>
      index === 0 ? batchReply([{ id: 's0', text: 'Xin chào' }]) : batchReply([])
    );
    const response = await dispatchMessage({ type: 'TRANSLATE_PAGE', payload: { segments } });
    assert.deepEqual(response, { ok: true, translations: [{ id: 's0', text: 'Xin chào' }], failedIds: ['s1'] });
    const sent = chatCalls(calls).map((call) => JSON.parse(call.body.messages.at(-1).content).segments);
    assert.deepEqual(sent, [segments, [segments[1]]]);
  });

  test('answer-shaped entries are not re-sent in the follow-up request', async (t) => {
    const questions = [
      { id: 's0', text: 'Hello' },
      { id: 's1', text: 'What is 2 + 2?' },
      { id: 's2', text: 'Goodbye' }
    ];
    const calls = mockFetch(t, (url, options, index) =>
      index === 0
        ? batchReply([
            { id: 's0', text: 'Xin chào' },
            { id: 's1', text: 'The answer is 4.' }
          ])
        : batchReply([{ id: 's2', text: 'Tạm biệt' }])
    );
    const response = await dispatchMessage({ type: 'TRANSLATE_PAGE', payload: { segments: questions } });
    assert.deepEqual(response.failedIds, ['s1']);
    const sent = chatCalls(calls).map((call) => JSON.parse(call.body.messages.at(-1).content).segments);
    assert.deepEqual(sent, [questions, [questions[2]]]);
  });

  test('a rate-limited provider resolves with retryAfterMs instead of failing', async (t) => {
    const calls = mockFetch(t, () => ({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '120' }),
      text: async () => 'Too Many Requests'
    }));
    const response = await dispatchMessage({ type: 'TRANSLATE_PAGE', payload: { segments } });
    assert.equal(response.ok, true);
    assert.deepEqual(response.translations, []);
    assert.deepEqual(response.failedIds, ['s0', 's1']);
    assert.ok(response.retryAfterMs >= 120_000, String(response.retryAfterMs));
    assert.deepEqual(
      chatCalls(calls).map((call) => call.url),
      ['https://p1.example/v1/chat/completions', 'https://p2.example/v1/chat/completions'],
      'each model is tried once; a long block is not retried inside the worker'
    );
  });

  test('other provider errors still fail the batch', async (t) => {
    mockFetch(t, () => ({ ok: false, status: 401, text: async () => 'bad key' }));
    const response = await dispatchMessage({ type: 'TRANSLATE_PAGE', payload: { segments } });
    assert.equal(response.ok, false);
    assert.match(response.error, /401/);
  });

  test('TRANSLATE_PAGE_IN_TAB starts the tab session and reports restricted pages', async () => {
    const sent = [];
    chrome.tabs.sendMessage = async (tabId, message) => {
      sent.push([tabId, message.type]);
      return { ok: true, pending: 12 };
    };
    const started = await dispatchMessage({ type: 'TRANSLATE_PAGE_IN_TAB', payload: { tabId: 7, toLang: 'vi' } });
    assert.deepEqual(started, { ok: true, started: true, pending: 12 });
    assert.deepEqual(sent, [[7, 'TRANSLATE_PAGE_START']]);

    chrome.tabs.sendMessage = async () => {
      throw new Error('Could not establish connection.');
    };
    const blocked = await dispatchMessage({ type: 'TRANSLATE_PAGE_IN_TAB', payload: { tabId: 7 } });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /cannot access this page/);

    chrome.tabs.sendMessage = async () => ({ ok: true, restored: 5 });
    assert.deepEqual(await dispatchMessage({ type: 'RESTORE_PAGE_IN_TAB', payload: { tabId: 7 } }), {
      ok: true,
      restored: 5
    });
    chrome.tabs.sendMessage = async () => ({ ok: true });
  });
});

describe('model catalog', () => {
  test('public provider projection excludes credentials', async (t) => {
    mockFetch(t, () => jsonResponse({ data: [{ id: 'remote-chat' }] }));
    const response = await dispatchMessage({ type: 'GET_AVAILABLE_MODELS' });
    assert.equal(response.ok, true);
    for (const item of response.providers) {
      assert.deepEqual(Object.keys(item).sort(), ['apiType', 'id', 'manualModels', 'name']);
    }
    assert.ok(response.models.some((model) => model.id === 'remote-chat'));
  });
});

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { installChromeMock, resetChromeStorage } from '../helpers/chrome-mock.js';

const chrome = installChromeMock();
const storage = await import('../../src/storage/index.js');
const { DEFAULT_SYSTEM_PROMPT } = await import('../../src/shared/config.js');

const readyProvider = (id, extra = {}) => ({
  id,
  name: id,
  apiType: 'openai',
  baseUrl: `https://${id}.example/v1/`,
  apiKey: 'k',
  manualModels: ['m1'],
  ...extra
});

beforeEach(() => resetChromeStorage(chrome));

describe('normalizeProvider', () => {
  test('drops records without id, trims URL slashes, dedupes manual models', () => {
    assert.equal(storage.normalizeProvider({}), null);
    const provider = storage.normalizeProvider({
      id: 'p',
      baseUrl: 'https://x/v1///',
      manualModels: ['a', ' a ', '', 'b']
    });
    assert.equal(provider.baseUrl, 'https://x/v1');
    assert.deepEqual(provider.manualModels, ['a', 'b']);
    assert.equal(provider.apiType, 'openai');
    assert.equal(provider.enabled, true);
  });
});

describe('initializeStorage', () => {
  test('fresh install writes defaults', async () => {
    await storage.initializeStorage();
    const settings = await storage.loadSettings();
    assert.equal(settings.toLang, 'vi');
    assert.equal(settings.systemPrompt, DEFAULT_SYSTEM_PROMPT);
    assert.deepEqual(settings.providers, []);
    assert.equal(chrome.storage.local.data.genericProviderMigrationVersion, 1);
  });

  test('migrates legacy Gemini/custom keys into provider profiles and removes only the copied legacy key', async () => {
    resetChromeStorage(chrome, {
      local: {
        apiKey: 'gemini-key',
        customApiKey: 'custom-key',
        customApiBaseUrl: 'https://custom.example/v1',
        customApiInterface: 'anthropic',
        modelProvider: 'custom',
        model: 'claude-x',
        styleInstruction: 'Keep brand names.'
      }
    });
    await storage.initializeStorage();
    const { providers, modelProvider, instructions } = await storage.loadSettings();

    assert.deepEqual(
      providers.map((provider) => [provider.id, provider.apiType]),
      [
        ['legacy-custom', 'anthropic'],
        ['legacy-gemini', 'openai']
      ]
    );
    assert.deepEqual(providers[0].manualModels, ['claude-x']);
    assert.equal(modelProvider, 'legacy-custom');
    assert.equal(instructions[0].text, 'Keep brand names.');
    assert.equal('apiKey' in chrome.storage.local.data, false);
    assert.equal('styleInstruction' in chrome.storage.local.data, false);
    assert.equal(chrome.storage.local.data.customApiKey, 'custom-key', 'legacy keys are not deleted');
  });

  test('is idempotent', async () => {
    resetChromeStorage(chrome, { local: { apiKey: 'gemini-key' } });
    await storage.initializeStorage();
    const first = structuredClone(chrome.storage.local.data);
    await storage.initializeStorage();
    assert.deepEqual(chrome.storage.local.data.providers, first.providers);
  });

  test('auto-selects the first ready provider when the selection is invalid', async () => {
    resetChromeStorage(chrome, {
      local: { genericProviderMigrationVersion: 1, modelProvider: 'gone', providers: [readyProvider('p1')] }
    });
    await storage.initializeStorage();
    assert.equal(chrome.storage.local.data.modelProvider, 'p1');
    assert.equal(chrome.storage.local.data.model, 'm1');
  });
});

describe('settings', () => {
  test('session overrides win over local defaults', async () => {
    resetChromeStorage(chrome, {
      local: { providers: [readyProvider('p1')], modelProvider: 'p1', model: 'm1', toLang: 'vi' },
      session: { sessionToLang: 'ja', sessionModel: 'm2', sessionModelProvider: 'p1' }
    });
    const settings = await storage.loadSettingsWithSession();
    assert.equal(settings.toLang, 'ja');
    assert.equal(settings.model, 'm2');
  });

  test('saveDefaultSettings ignores keys outside the allow-list', async () => {
    await storage.saveDefaultSettings({ toLang: 'fr', providers: ['evil'], apiKey: 'x' });
    assert.equal(chrome.storage.local.data.toLang, 'fr');
    assert.equal('providers' in chrome.storage.local.data, false);
    assert.equal('apiKey' in chrome.storage.local.data, false);
  });
});

describe('providers and favorites', () => {
  test('saveProvider validates required fields', async () => {
    await assert.rejects(storage.saveProvider({ name: 'x', apiKey: 'k' }), /base URL is required/);
    await assert.rejects(storage.saveProvider({ name: 'x', baseUrl: 'https://x' }), /API key is required/);
  });

  test('removing the selected provider re-selects and clears session choice', async () => {
    resetChromeStorage(chrome, {
      local: { providers: [readyProvider('p1'), readyProvider('p2')], modelProvider: 'p1', model: 'm1' },
      session: { sessionModelProvider: 'p1', sessionModel: 'm1' }
    });
    await storage.removeProvider('p1');
    assert.equal(chrome.storage.local.data.modelProvider, 'p2');
    assert.equal('sessionModelProvider' in chrome.storage.session.data, false);
  });

  test('removing a session-only provider keeps the stored default', async () => {
    resetChromeStorage(chrome, {
      local: {
        providers: [readyProvider('p1'), readyProvider('p2'), readyProvider('p3')],
        modelProvider: 'p1',
        model: 'm1'
      },
      session: { sessionModelProvider: 'p2', sessionModel: 'm1' }
    });
    await storage.removeProvider('p2');
    assert.equal(chrome.storage.local.data.modelProvider, 'p1');
    assert.equal(chrome.storage.local.data.model, 'm1');
    assert.equal('sessionModelProvider' in chrome.storage.session.data, false);
  });

  test('removing an unselected provider changes no selection', async () => {
    resetChromeStorage(chrome, {
      local: { providers: [readyProvider('p1'), readyProvider('p2')], modelProvider: 'p1', model: 'm1' },
      session: { sessionModelProvider: 'p1', sessionModel: 'm1' }
    });
    await storage.removeProvider('p2');
    assert.equal(chrome.storage.local.data.modelProvider, 'p1');
    assert.equal(chrome.storage.session.data.sessionModelProvider, 'p1');
  });

  test('favorites are provider-qualified and toggle', async () => {
    const added = await storage.toggleFavoriteModel({ model: 'm1', modelProvider: 'p1' });
    assert.deepEqual(added, { favoriteModels: ['p1::m1'], isFavorite: true });
    const removed = await storage.toggleFavoriteModel({ model: 'm1', modelProvider: 'p1' });
    assert.deepEqual(removed, { favoriteModels: [], isFavorite: false });
    await assert.rejects(storage.toggleFavoriteModel({ model: 'm1' }), /Choose a provider and model/);
  });
});

describe('history and instructions', () => {
  test('history is capped at 50 newest-first entries', async () => {
    for (let index = 0; index < 55; index += 1) await storage.addTranslationHistory({ sourceText: `s${index}` });
    const history = await storage.getTranslationHistory();
    assert.equal(history.length, 50);
    assert.equal(history[0].sourceText, 's54');
  });

  test('combined instructions include only enabled entries', async () => {
    const first = await storage.addInstruction('A', 'Use formal tone.');
    await storage.addInstruction('B', 'Keep product names.');
    await storage.toggleInstruction(first.id);
    assert.equal(await storage.getCombinedInstructions(), 'Keep product names.');
    await assert.rejects(storage.addInstruction('C', '  '), /text is required/);
  });
});

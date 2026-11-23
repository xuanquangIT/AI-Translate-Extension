import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { buildBatchTranslationRequest } from '../../src/translation/prompt.js';
import { parseBatchTranslationResponse } from '../../src/translation/response.js';
import { buildMtPrompt } from '../../scripts/local-mt/lib.mjs';
import {
  DEFAULT_SELECTION,
  LOCAL_MODELS,
  buildIndexTranslatePrompt,
  parseModelSelection,
  perModelBudget,
  readSelection,
  resolveModel,
  writeSelection
} from '../../scripts/local-mt/models.mjs';
import { createHandler, pickRoute } from '../../scripts/local-mt/server.mjs';
import { LLAMA_PORT, modelFile, modelId } from '../../scripts/local-mt/paths.mjs';

const tray = readFileSync(new URL('../../scripts/local-mt/tray.ps1', import.meta.url), 'utf8');

test('parseModelSelection accepts one key, a list, or all, in catalog order', () => {
  assert.deepEqual(
    parseModelSelection('gemma').map((model) => model.key),
    ['gemma']
  );
  assert.deepEqual(
    parseModelSelection(' Index , gemma ').map((model) => model.key),
    ['gemma', 'index']
  );
  assert.deepEqual(
    parseModelSelection('all').map((model) => model.key),
    LOCAL_MODELS.map((model) => model.key)
  );
  assert.deepEqual(
    parseModelSelection('').map((model) => model.key),
    [DEFAULT_SELECTION]
  );
  assert.throws(() => parseModelSelection('gemma,llama'), /Unknown model "llama"/);
  assert.throws(() => parseModelSelection(','), /No model selected/);
});

test('resolveModel gives each model its own llama-server port, file, and id', () => {
  const [gemma, index] = LOCAL_MODELS;
  const g = resolveModel(gemma, { llamaPort: LLAMA_PORT });
  const i = resolveModel(index, { llamaPort: LLAMA_PORT, quant: 'Q4_K_M' });
  assert.equal(g.port, LLAMA_PORT);
  assert.equal(i.port, LLAMA_PORT + 1);
  // Gemma keeps the existing file and id (paths.mjs), so an existing LingoFlux provider keeps its model name.
  assert.equal(g.file, modelFile());
  assert.equal(g.id, modelId());
  assert.equal(resolveModel(gemma, { llamaPort: 1, quant: 'Q8_0' }).id, 'gemma-4-e2b-q8_0');
  // --quant applies to Gemma only; Index-Translate is published and measured at Q8_0.
  assert.match(i.file, /Index-Translate-2B\.Q8_0\.gguf$/);
  assert.equal(i.id, 'index-translate-2b-q8_0');
  assert.equal(
    i.url,
    'https://huggingface.co/IndexTeam/Index-Translate-2B-GGUF/resolve/main/Index-Translate-2B.Q8_0.gguf'
  );
  assert.equal(g.embedOnGpu, true);
  assert.equal(i.embedOnGpu, false);
});

test('each model gets its own prompt format', () => {
  const [gemma, index] = LOCAL_MODELS;
  const input = { text: 'Hello', sourceLanguage: 'en', targetLanguage: 'vi' };
  assert.equal(gemma.buildPrompt(input), buildMtPrompt(input));
  assert.equal(index.buildPrompt(input), '请将以下文本翻译为越南语，直接输出翻译结果，不要进行任何解释。\n\nHello');
  assert.match(buildIndexTranslatePrompt({ text: 'x', targetLanguage: 'ja' }), /翻译为日语/);
  // A language without a Chinese name falls back to its English name.
  assert.match(buildIndexTranslatePrompt({ text: 'x', targetLanguage: 'Swahili' }), /翻译为Swahili/);
});

test('perModelBudget splits slots and KV cache when two models share the GPU', () => {
  assert.deepEqual(perModelBudget({ parallel: 32, ctx: 32768 }, 1), { parallel: 32, ctx: 32768 });
  assert.deepEqual(perModelBudget({ parallel: 32, ctx: 32768 }, 2), { parallel: 16, ctx: 16384 });
  assert.deepEqual(perModelBudget({ parallel: 1, ctx: 4096 }, 2), { parallel: 1, ctx: 4096 });
});

test('the saved selection round-trips and falls back to the default when missing or invalid', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lingoflux-local-mt-'));
  try {
    const file = path.join(dir, 'nested', 'config.json');
    assert.equal(readSelection(file), DEFAULT_SELECTION);
    writeSelection('All', file);
    assert.equal(readSelection(file), 'all');
    assert.throws(() => writeSelection('nope', file), /Unknown model/);
    writeFileSync(file, '{"models":"nope"}');
    assert.equal(readSelection(file), DEFAULT_SELECTION);
    writeFileSync(file, 'not json');
    assert.equal(readSelection(file), DEFAULT_SELECTION);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pickRoute matches the requested model id and falls back to the first loaded model', () => {
  const routes = [{ id: 'gemma-4-e2b-q4_k_m' }, { id: 'index-translate-2b-q8_0' }];
  assert.equal(pickRoute(routes, 'index-translate-2b-q8_0').id, 'index-translate-2b-q8_0');
  assert.equal(pickRoute(routes, 'gemma-4-e2b-q4_k_m').id, 'gemma-4-e2b-q4_k_m');
  assert.equal(pickRoute(routes, 'some-old-name').id, 'gemma-4-e2b-q4_k_m');
  assert.equal(pickRoute(routes, undefined).id, 'gemma-4-e2b-q4_k_m');
});

function invoke(handler, { method = 'GET', url = '/', body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  req.method = method;
  req.url = url;
  return new Promise((resolve) => {
    const res = {
      writeHead(status) {
        this.status = status;
      },
      end(payload) {
        resolve({ status: this.status, body: JSON.parse(payload) });
      }
    };
    handler(req, res);
  });
}

function twoModelHandler(calls) {
  const route = (id, buildPrompt) => ({
    id,
    buildPrompt,
    translateText: async ({ prompt }) => {
      calls.push({ id, prompt });
      return { text: `[${id}]`, promptTokens: 1, completionTokens: 1 };
    }
  });
  return createHandler({
    concurrency: 2,
    routes: [route('gemma-4-e2b-q4_k_m', buildMtPrompt), route('index-translate-2b-q8_0', buildIndexTranslatePrompt)]
  });
}

test('the bridge lists every loaded model and routes each request to the one it names', async () => {
  const calls = [];
  const handler = twoModelHandler(calls);
  const models = await invoke(handler, { url: '/v1/models' });
  assert.deepEqual(
    models.body.data.map((item) => item.id),
    ['gemma-4-e2b-q4_k_m', 'index-translate-2b-q8_0']
  );

  const segments = [{ id: 's0', text: 'Hello' }];
  const request = buildBatchTranslationRequest({ fromLang: 'en', toLang: 'vi', segments });
  const send = (model) =>
    invoke(handler, {
      method: 'POST',
      url: '/v1/chat/completions',
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user }
        ]
      })
    });

  const index = await send('index-translate-2b-q8_0');
  assert.equal(index.status, 200);
  assert.equal(index.body.model, 'index-translate-2b-q8_0');
  assert.equal(
    parseBatchTranslationResponse(index.body.choices[0].message.content, ['s0']).translations[0].text,
    '[index-translate-2b-q8_0]'
  );
  assert.match(calls.at(-1).prompt, /^请将以下文本翻译为越南语/);

  const unknown = await send('model-from-an-old-provider');
  assert.equal(unknown.status, 200);
  assert.equal(calls.at(-1).id, 'gemma-4-e2b-q4_k_m');
  assert.match(calls.at(-1).prompt, /^Translate the following text from English into Vietnamese\./);
});

test('tray.ps1 model catalog matches models.mjs (keys, files, port offsets)', () => {
  for (const model of LOCAL_MODELS) {
    const entry = tray.match(
      new RegExp(`^\\s*${model.key} = @\\{ Label = '([^']+)'; File = "?'?([^"';]+)"?'?; PortOffset = (\\d+) \\}`, 'm')
    );
    assert.ok(entry, `tray.ps1 has no catalog entry for ${model.key}`);
    assert.equal(entry[1], model.label);
    assert.equal(entry[2], model.fileFor(model.quantizable ? '$Quant' : model.defaultQuant));
    assert.equal(Number(entry[3]), model.portOffset);
  }
  assert.match(tray, /all\s+= 'Both models \(load all\)'/);
  assert.match(tray, /--models \$selection/);
});

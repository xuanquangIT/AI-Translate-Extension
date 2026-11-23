/**
 * Throughput benchmark for the local MT stack started by `npm run local-mt:start`.
 *   1. llama-server directly: aggregate output tok/s at several concurrency levels.
 *   2. Through the bridge with the real extension adapter: one page batch, and a whole page sent
 *      the way the content script does (batches of ≤ 2500 chars, 2 in flight).
 *
 * Usage: node scripts/local-mt/bench.mjs [--port 37813] [--llama-port 37814] [--levels 1,4,8,16,32] [--target vi]
 */

import { execFileSync } from 'node:child_process';
import { translateBatchWithProvider } from '../../src/translation/translate.js';
import { buildMtPrompt, mapWithConcurrency, segmentMaxTokens } from './lib.mjs';
import { completionBody } from './server.mjs';
import { BRIDGE_PORT, LLAMA_PORT } from './paths.mjs';

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const bridge = `http://127.0.0.1:${arg('--port', BRIDGE_PORT)}/v1`;
const llama = `http://127.0.0.1:${arg('--llama-port', LLAMA_PORT)}`;
const levels = arg('--levels', '1,4,8,16,32').split(',').map(Number);
const target = arg('--target', 'vi');

const SENTENCES = [
  'The city council approved a new budget on Tuesday after three hours of debate.',
  'Officials said the plan would add 120 new bus routes and repair 45 bridges by 2028.',
  'Critics argued that the proposal ignores rising housing costs in the northern districts.',
  'Read the full report at https://example.com/budget-2027 for details on each project.',
  'The mayor promised quarterly updates and an independent audit of all spending.',
  'Residents can submit feedback online until December 15 or attend public hearings.',
  'Browser extensions let users customize how they experience the web, from blocking ads to translating pages.',
  'A good translation keeps names, numbers, and links intact while sounding natural to native readers.',
  'Researchers found that smaller models can match larger ones when they are trained for a single task.',
  'Click "Save changes" to keep your settings, or press Escape to close this dialog without saving.'
];

function vram() {
  try {
    return execFileSync('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader'], {
      encoding: 'utf8'
    }).trim();
  } catch {
    return 'n/a';
  }
}

async function rawTranslate(text) {
  const t0 = performance.now();
  const response = await fetch(`${llama}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      completionBody(buildMtPrompt({ text, sourceLanguage: 'en', targetLanguage: target }), segmentMaxTokens(text))
    )
  });
  const data = await response.json();
  return {
    ms: performance.now() - t0,
    out: data.usage?.completion_tokens ?? 0,
    text: data.choices?.[0]?.message?.content
  };
}

console.log(`VRAM before: ${vram()}`);
await rawTranslate(SENTENCES[0]); // warm-up

console.log('\n--- llama-server direct (one segment per request) ---');
for (const level of levels) {
  const jobs = Array.from({ length: Math.max(level * 3, 10) }, (_, i) => SENTENCES[i % SENTENCES.length]);
  const t0 = performance.now();
  const results = await mapWithConcurrency(jobs, level, rawTranslate);
  const wall = (performance.now() - t0) / 1000;
  const out = results.reduce((sum, r) => sum + r.out, 0);
  const avg = results.reduce((sum, r) => sum + r.ms, 0) / results.length;
  console.log(
    `concurrency ${String(level).padStart(2)}: ${jobs.length} req, ${out} out tok in ${wall.toFixed(2)} s ` +
      `→ ${(out / wall).toFixed(0)} tok/s aggregate, ${(out / results.length / (avg / 1000)).toFixed(0)} tok/s per stream, ` +
      `avg latency ${avg.toFixed(0)} ms`
  );
}
console.log(`VRAM under load: ${vram()}`);

const provider = { id: 'local-mt', name: 'Local MT', apiType: 'openai', baseUrl: bridge, apiKey: 'local' };
const model = (await (await fetch(`${bridge}/models`)).json()).data[0].id;
const common = { provider, model, fromLang: 'en', toLang: target, systemPrompt: '', styleInstruction: '' };

function makeBatch(prefix, maxChars = 2500, maxSegments = 40) {
  const segments = [];
  let chars = 0;
  for (let i = 0; segments.length < maxSegments; i++) {
    const text = SENTENCES[i % SENTENCES.length];
    if (chars + text.length > maxChars) break;
    segments.push({ id: `${prefix}${i}`, text });
    chars += text.length;
  }
  return { segments, chars };
}

console.log('\n--- through bridge + extension adapter ---');
const one = makeBatch('t');
let t0 = performance.now();
const result = await translateBatchWithProvider({ ...common, segments: one.segments });
console.log(
  `1 page batch: ${result.translations.length}/${one.segments.length} segments, ${one.chars} chars, ` +
    `${(performance.now() - t0).toFixed(0)} ms`
);
for (const item of result.translations.slice(0, 3)) console.log(`  ${item.id}: ${item.text}`);

const BATCHES = 12;
const page = Array.from({ length: BATCHES }, (_, b) => makeBatch(`p${b}_`));
const pageChars = page.reduce((sum, batch) => sum + batch.chars, 0);
t0 = performance.now();
const pageResults = await mapWithConcurrency(page, 2, (batch) =>
  translateBatchWithProvider({ ...common, segments: batch.segments })
);
const pageSeconds = (performance.now() - t0) / 1000;
const ok = pageResults.reduce((sum, r) => sum + r.translations.length, 0);
const total = page.reduce((sum, batch) => sum + batch.segments.length, 0);
console.log(
  `whole page (${BATCHES} batches, 2 in flight like the content script): ${ok}/${total} segments, ` +
    `${pageChars} chars in ${pageSeconds.toFixed(1)} s → ${(pageChars / pageSeconds).toFixed(0)} chars/s`
);

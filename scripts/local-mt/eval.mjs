/**
 * Translation benchmark for one candidate model (see docs/LOCAL_MT.md, "Choosing a model").
 *
 *   1. llama-bench: standard prompt (pp512) and generation (tg128) speed with the same offload settings.
 *   2. llama-server on a separate port: single-stream probe (time to first token, prompt and generation tok/s),
 *      then every test item at --parallel concurrency, recording each output, its tokens, and the peak VRAM.
 *
 * Usage: node scripts/local-mt/eval.mjs --model <id> [--parallel 8] [--ctx 32768] [--port 37815]
 *        [--sets crafted,flores,wmt24pp,ntrex] [--limit N] [--url http://127.0.0.1:PORT (use a running server)]
 * Outputs go to .local-mt/eval/runs/<id>/ (git-ignored). Test text is never printed, only counts and timings.
 */

import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildEvalRequest, findModel, percentile, readEvalResponse } from './eval-lib.mjs';
import { mapWithConcurrency, segmentMaxTokens } from './lib.mjs';
import { LLAMA_DIR, LOCAL_MT_DIR, MODELS_DIR } from './paths.mjs';

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const model = findModel(arg('--model', ''));
const parallel = Number(arg('--parallel', 8));
const ctx = Number(arg('--ctx', model.ctx ?? 32768));
const port = Number(arg('--port', 37815));
const sets = arg('--sets', 'crafted,flores,wmt24pp,ntrex').split(',');
const limit = Number(arg('--limit', 0));
const externalUrl = arg('--url', '');
const ngl = String(arg('--ngl', model.ngl));
const skipBench = args.includes('--skip-bench');

const EVAL_DIR = path.join(LOCAL_MT_DIR, 'eval');
const outDir = path.join(EVAL_DIR, 'runs', model.id);
mkdirSync(outDir, { recursive: true });
const exe = (name) => path.join(LLAMA_DIR, process.platform === 'win32' ? `${name}.exe` : name);
const modelPath = path.join(MODELS_DIR, model.file);
if (!externalUrl && !existsSync(modelPath)) {
  console.error(`Missing model file: ${modelPath}`);
  process.exit(1);
}

function loadItems() {
  const items = [];
  if (sets.includes('crafted')) {
    const crafted = JSON.parse(readFileSync(new URL('./eval-items.json', import.meta.url), 'utf8'));
    for (const item of crafted.items) items.push({ ...item, set: 'crafted' });
  }
  const publicFile = path.join(EVAL_DIR, 'data', 'public.jsonl');
  if (existsSync(publicFile)) {
    for (const line of readFileSync(publicFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      if (sets.includes(item.set)) items.push(item);
    }
  }
  return limit > 0 ? items.slice(0, limit) : items;
}

function vramUsedMiB() {
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], {
      encoding: 'utf8'
    });
    return Number(out.trim().split('\n')[0]);
  } catch {
    return Number.NaN;
  }
}

function serverArgs() {
  return [
    '-m',
    modelPath,
    '-ngl',
    ngl,
    '--parallel',
    String(parallel),
    '-c',
    String(ctx),
    '--kv-unified',
    '--load-mode',
    'none',
    '-fa',
    'on',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--no-webui',
    '--cache-ram',
    '0',
    ...(model.kvType ? ['-ctk', model.kvType, '-ctv', model.kvType] : []),
    ...(model.embedOnGpu ? ['--override-tensor', 'token_embd=CUDA0'] : []),
    '--jinja'
  ];
}

async function runLlamaBench(layers = ngl) {
  const { stdout } = await promisify(execFile)(
    exe('llama-bench'),
    [
      '-m',
      modelPath,
      '-ngl',
      String(layers),
      '-fa',
      '1',
      ...(model.kvType ? ['-ctk', model.kvType, '-ctv', model.kvType] : []),
      '-p',
      '512',
      '-n',
      '128',
      '-r',
      '3',
      '-o',
      'json'
    ],
    { maxBuffer: 16 * 1024 * 1024 }
  );
  const rows = JSON.parse(stdout);
  const pick = (test) => rows.find((row) => (test === 'pp' ? row.n_prompt > 0 : row.n_gen > 0));
  return { pp512: pick('pp')?.avg_ts ?? null, tg128: pick('tg')?.avg_ts ?? null };
}

async function startServer() {
  const child = spawn(exe('llama-server'), serverArgs(), { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  child.stderr.on('data', (chunk) => {
    log = (log + chunk.toString()).slice(-20_000);
  });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 300_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`llama-server exited (${child.exitCode}):\n${log.slice(-3000)}`);
    try {
      if ((await fetch(`${url}/health`)).ok) return { child, url };
    } catch {}
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('llama-server did not become ready within 300 s.');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function post(url, request) {
  const response = await fetch(`${url}${request.path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

/** Streams one request and measures time to first token; generation/prompt speed come from llama-server timings. */
async function streamProbe(url, request) {
  const started = performance.now();
  const response = await fetch(`${url}${request.path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request.body, stream: true, timings_per_token: false })
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const decoder = new TextDecoder();
  let buffer = '';
  let ttft = null;
  let timings = null;
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let data;
      try {
        data = JSON.parse(payload);
      } catch {
        continue;
      }
      const piece = data.choices?.[0]?.delta?.content ?? data.content ?? '';
      if (ttft === null && piece) ttft = performance.now() - started;
      if (data.timings) timings = data.timings;
    }
  }
  return {
    ttftMs: ttft,
    totalMs: performance.now() - started,
    promptPerSecond: timings?.prompt_per_second ?? null,
    predictedPerSecond: timings?.predicted_per_second ?? null,
    promptTokens: timings?.prompt_n ?? null,
    predictedTokens: timings?.predicted_n ?? null
  };
}

const PROBES = [
  { src: 'en', tgt: 'vi', text: 'Please restart the application to apply the update.' },
  {
    src: 'en',
    tgt: 'vi',
    text:
      'The committee will publish its final recommendations next spring, after consulting teachers, parents, and ' +
      'students in every province. Officials expect the changes to take effect at the start of the 2028 school year.'
  },
  {
    src: 'en',
    tgt: 'vi',
    text:
      'Local translation keeps page text on the device and has no rate limits. The trade-off is quality: a small ' +
      'model running on a laptop GPU is fast, but it can miss idioms, confuse speakers in a dialogue, or choose the ' +
      'wrong pronoun for a family member. A benchmark therefore has to measure more than speed. It should include ' +
      'everyday conversation, news, technical documentation, legal and medical instructions, slang, and text with ' +
      'markup or placeholders, and it should compare every model on exactly the same items with the same settings. ' +
      'Only then can we decide which model gives the best balance between translation quality and tokens per second.'
  }
];

const items = loadItems();
console.log(`[eval] ${model.label}: ${items.length} items, parallel ${parallel}, ngl ${ngl}`);

const summary = {
  kvType: model.kvType ?? 'f16',
  model: model.id,
  label: model.label,
  file: model.file,
  fileBytes: existsSync(modelPath) ? statSync(modelPath).size : null,
  parallel,
  ngl,
  ctx,
  items: items.length
};
async function benchInto(target, layers) {
  console.log(`[eval] llama-bench pp512/tg128 (ngl ${layers}) ...`);
  try {
    target.llamaBench = { ...(await runLlamaBench(layers)), ngl: String(layers) };
    console.log(`[eval] llama-bench: ${JSON.stringify(target.llamaBench)}`);
  } catch (error) {
    target.llamaBench = { error: String(error.message).slice(0, 300) };
    console.log('[eval] llama-bench failed; continuing.');
  }
}

if (!externalUrl && !skipBench) await benchInto(summary, ngl);

summary.vramBaselineMiB = vramUsedMiB();
let server = null;
const url = externalUrl || (server = await startServer()).url;
let peak = vramUsedMiB();
const sampler = setInterval(() => {
  const used = vramUsedMiB();
  if (used > peak) peak = used;
}, 1000);

try {
  summary.vramLoadedMiB = vramUsedMiB();
  await post(url, buildEvalRequest(model.style, PROBES[0], 64)); // warm-up

  summary.probe = [];
  for (const probe of PROBES) {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await streamProbe(url, buildEvalRequest(model.style, probe, 512)));
    const median = (key) =>
      percentile(
        runs.map((run) => run[key]).filter((value) => value !== null),
        50
      );
    summary.probe.push({
      chars: probe.text.length,
      ttftMs: median('ttftMs'),
      totalMs: median('totalMs'),
      promptPerSecond: median('promptPerSecond'),
      predictedPerSecond: median('predictedPerSecond'),
      promptTokens: median('promptTokens'),
      predictedTokens: median('predictedTokens')
    });
  }
  console.log(
    `[eval] single stream: ${JSON.stringify(summary.probe.map((p) => Math.round(p.predictedPerSecond)))} tok/s`
  );

  const started = performance.now();
  let done = 0;
  const outputs = await mapWithConcurrency(items, parallel, async (item) => {
    const t0 = performance.now();
    let result;
    try {
      let budget = segmentMaxTokens(item.source);
      result = readEvalResponse(
        await post(url, buildEvalRequest(model.style, { text: item.source, src: item.src, tgt: item.tgt }, budget))
      );
      if (result.finish === 'length') {
        budget = Math.min(4096, budget * 4);
        result = readEvalResponse(
          await post(url, buildEvalRequest(model.style, { text: item.source, src: item.src, tgt: item.tgt }, budget))
        );
      }
    } catch (error) {
      result = { text: '', error: String(error.message).slice(0, 200), promptTokens: 0, completionTokens: 0 };
    }
    done += 1;
    if (done % 50 === 0) console.log(`[eval] ${done}/${items.length}`);
    return {
      id: item.id,
      set: item.set,
      domain: item.domain,
      level: item.level ?? null,
      src: item.src,
      tgt: item.tgt,
      hyp: result.text,
      finish: result.finish ?? 'error',
      error: result.error,
      ms: Math.round(performance.now() - t0),
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens
    };
  });
  const wallSeconds = (performance.now() - started) / 1000;
  const completion = outputs.reduce((sum, row) => sum + (row.completionTokens || 0), 0);
  summary.batch = {
    wallSeconds,
    completionTokens: completion,
    aggregateTokPerSecond: completion / wallSeconds,
    sourceChars: items.reduce((sum, item) => sum + item.source.length, 0),
    errors: outputs.filter((row) => row.error).length,
    truncated: outputs.filter((row) => row.finish === 'length').length,
    p50ms: percentile(
      outputs.map((row) => row.ms),
      50
    ),
    p95ms: percentile(
      outputs.map((row) => row.ms),
      95
    )
  };
  summary.vramPeakMiB = peak;
  writeFileSync(path.join(outDir, 'outputs.jsonl'), outputs.map((row) => JSON.stringify(row)).join('\n') + '\n');
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(
    `[eval] ${items.length} items in ${wallSeconds.toFixed(1)} s, ${summary.batch.aggregateTokPerSecond.toFixed(0)} ` +
      `tok/s aggregate, ${summary.batch.errors} errors, ${summary.batch.truncated} truncated, ` +
      `VRAM peak ${peak} MiB (baseline ${summary.vramBaselineMiB})`
  );
} finally {
  clearInterval(sampler);
  if (server) {
    server.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

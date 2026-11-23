/**
 * Starts one llama-server per selected local model (GPU, continuous batching) and the LingoFlux bridge in front.
 *
 * Usage: node scripts/local-mt/start.mjs [--models gemma|index|all|gemma,index] [--quant Q4_K_M] [--parallel 32]
 *        [--ctx 32768] [--port 37813] [--llama-port 37814] [--llama-server <path>] [--embed-device CUDA0|none]
 * --models defaults to the saved selection (.local-mt/config.json, written by the tray), else gemma.
 * Model N listens on --llama-port + its offset (Gemma 37814, Index-Translate 37815); the bridge routes by model id.
 * --parallel and --ctx are the totals for the GPU; with two models each gets half (--kv-unified per server).
 * All layers are offloaded (-ngl 99). --embed-device moves Gemma 4's input embedding tables (about 1.7 GB) from
 * host RAM to the GPU; pass "none" for non-CUDA builds. --quant applies to Gemma only.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseModelSelection, perModelBudget, readSelection, resolveModel } from './models.mjs';
import { BRIDGE_PORT, LLAMA_DIR, LLAMA_PORT } from './paths.mjs';
import { startServer } from './server.mjs';

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const selection = arg('--models', readSelection());
const quant = arg('--quant', '');
const port = Number(arg('--port', BRIDGE_PORT));
const llamaPort = Number(arg('--llama-port', LLAMA_PORT));
const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const serverPath = arg('--llama-server', path.join(LLAMA_DIR, exe));
const embedDevice = arg('--embed-device', 'CUDA0');

let selected;
try {
  selected = parseModelSelection(selection);
} catch (error) {
  console.error(`[local-mt] ${error.message}`);
  process.exit(1);
}
const budget = perModelBudget(
  { parallel: Number(arg('--parallel', 32)), ctx: Number(arg('--ctx', 32768)) },
  selected.length
);
const models = selected.map((model) => resolveModel(model, { quant, llamaPort }));

const missing = [['llama-server', serverPath], ...models.map((model) => [model.label, model.file])].filter(
  ([, file]) => !existsSync(file)
);
if (missing.length) {
  for (const [label, file] of missing) console.error(`Missing ${label}: ${file}`);
  console.error(`Run: npm run local-mt:setup -- --models ${selected.map((model) => model.key).join(',')}`);
  process.exit(1);
}

function llamaArgs(model) {
  return [
    '-m',
    model.file,
    '-ngl',
    '99',
    '--parallel',
    String(budget.parallel),
    '-c',
    String(budget.ctx),
    '--kv-unified',
    // Load weights straight into VRAM instead of keeping the GGUF memory-mapped in host RAM.
    '--load-mode',
    'none',
    '-fa',
    'on',
    '--host',
    '127.0.0.1',
    '--port',
    String(model.port),
    '--no-webui',
    // No host-RAM prompt cache: segments are short and independent, and the cache grows by GBs over a session.
    '--cache-ram',
    '0',
    ...(model.embedOnGpu && embedDevice !== 'none' ? ['--override-tensor', `token_embd=${embedDevice}`] : []),
    // Use the model's own chat template (needed for chat_template_kwargs such as enable_thinking).
    '--jinja'
  ];
}

const children = [];
let stopping = false;
const stopAll = (code = 0) => {
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
};

console.log(
  `[local-mt] models: ${models.map((model) => `${model.label} (${model.id}, :${model.port})`).join(', ')}; ` +
    `${budget.parallel} slots and ${budget.ctx} KV tokens each`
);
for (const model of models) {
  const modelArgs = llamaArgs(model);
  console.log(`[local-mt] llama-server ${modelArgs.join(' ')}`);
  const child = spawn(serverPath, modelArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`[local-mt] llama-server for ${model.label} exited (${code}).`);
    stopAll(code ?? 1);
  });
  children.push(child);
}

const deadline = Date.now() + 180_000;
for (const model of models) {
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${model.port}/health`)).ok) break;
    } catch {}
    if (Date.now() > deadline) {
      console.error(`[local-mt] llama-server for ${model.label} did not become ready within 180 s.`);
      stopAll(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const bridge = startServer({
  port,
  concurrency: budget.parallel,
  routes: models.map((model) => ({
    id: model.id,
    upstream: `http://127.0.0.1:${model.port}`,
    buildPrompt: model.buildPrompt,
    concurrency: budget.parallel
  }))
});
const stop = () => {
  bridge.close();
  stopAll(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

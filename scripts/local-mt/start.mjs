/**
 * Starts llama-server (GPU, continuous batching) and the LingoFlux bridge in one command.
 *
 * Usage: node scripts/local-mt/start.mjs [--quant Q4_K_M] [--parallel 32] [--ctx 32768]
 *        [--port 37813] [--llama-port 37814] [--llama-server <path>] [--embed-device CUDA0|none]
 * All model layers are offloaded to the GPU (-ngl 99), so weights and KV cache live in VRAM.
 * --ctx is the total KV cache shared by all parallel slots (--kv-unified).
 * llama.cpp keeps input embedding tables in host RAM even with -ngl 99; for Gemma 4 E2B that is about 1.7 GB
 * (token and per-layer embeddings). --embed-device moves them to the GPU; pass "none" for non-CUDA builds.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BRIDGE_PORT, DEFAULT_QUANT, LLAMA_DIR, LLAMA_PORT, modelFile, modelId } from './paths.mjs';
import { startServer } from './server.mjs';

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const quant = arg('--quant', DEFAULT_QUANT);
const parallel = Number(arg('--parallel', 32));
const ctx = Number(arg('--ctx', 32768));
const port = Number(arg('--port', BRIDGE_PORT));
const llamaPort = Number(arg('--llama-port', LLAMA_PORT));
const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const serverPath = arg('--llama-server', path.join(LLAMA_DIR, exe));
const model = modelFile(quant);
const embedDevice = arg('--embed-device', 'CUDA0');

for (const [label, file] of [
  ['llama-server', serverPath],
  ['model', model]
]) {
  if (!existsSync(file)) {
    console.error(`Missing ${label}: ${file}\nRun: npm run local-mt:setup`);
    process.exit(1);
  }
}

const llamaArgs = [
  '-m',
  model,
  '-ngl',
  '99',
  '--parallel',
  String(parallel),
  '-c',
  String(ctx),
  '--kv-unified',
  // Load weights straight into VRAM instead of keeping the GGUF memory-mapped in host RAM.
  '--load-mode',
  'none',
  '-fa',
  'on',
  '--host',
  '127.0.0.1',
  '--port',
  String(llamaPort),
  '--no-webui',
  // No host-RAM prompt cache: segments are short and independent, and the cache grows by GBs over a session.
  '--cache-ram',
  '0',
  ...(embedDevice === 'none' ? [] : ['--override-tensor', `token_embd=${embedDevice}`]),
  // Use the model's own chat template (needed for chat_template_kwargs such as enable_thinking).
  '--jinja'
];
console.log(`[local-mt] llama-server ${llamaArgs.join(' ')}`);
const llama = spawn(serverPath, llamaArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
llama.on('exit', (code) => {
  console.error(`[local-mt] llama-server exited (${code}).`);
  process.exit(code ?? 1);
});

const upstream = `http://127.0.0.1:${llamaPort}`;
const deadline = Date.now() + 120_000;
for (;;) {
  try {
    const response = await fetch(`${upstream}/health`);
    if (response.ok) break;
  } catch {}
  if (Date.now() > deadline) {
    console.error('[local-mt] llama-server did not become ready within 120 s.');
    llama.kill();
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const bridge = startServer({ port, upstream, concurrency: parallel, model: modelId(quant) });
const stop = () => {
  bridge.close();
  llama.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

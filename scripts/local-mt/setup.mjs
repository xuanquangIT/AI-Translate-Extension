/**
 * Downloads the local MT runtime into `.local-mt/` (git-ignored, never committed):
 *   - llama.cpp Windows CUDA build + CUDA runtime DLLs (official ggml-org/llama.cpp GitHub release)
 *   - Gemma 4 E2B instruct GGUF (unsloth/gemma-4-E2B-it-GGUF on Hugging Face, Apache-2.0)
 *
 * Usage: node scripts/local-mt/setup.mjs [--quant Q4_K_M|Q5_K_M|Q6_K|Q8_0] [--cuda 13] [--tag b12631] [--skip-llama]
 * Existing files are kept. Windows x64 + NVIDIA only; on other systems install llama.cpp yourself and
 * pass --skip-llama.
 */

import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { DEFAULT_QUANT, LOCAL_MT_DIR, LLAMA_DIR, MODELS_DIR, MODEL_REPO, modelFile } from './paths.mjs';

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const quant = arg('--quant', DEFAULT_QUANT);
const cudaMajor = arg('--cuda', '13');
const tag = arg('--tag', '');
const skipLlama = args.includes('--skip-llama');

async function download(url, destination) {
  if (existsSync(destination)) {
    console.log(`exists: ${path.relative(process.cwd(), destination)}`);
    return;
  }
  const response = await fetch(url, { headers: { 'User-Agent': 'lingoflux-local-mt-setup' } });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;
  let lastPrint = 0;
  const temp = `${destination}.part`;
  const progress = new TransformStream({
    transform(chunk, controller) {
      received += chunk.length;
      if (Date.now() - lastPrint > 2000) {
        lastPrint = Date.now();
        const pct = total ? ` (${((received / total) * 100).toFixed(0)}%)` : '';
        console.log(`  ${path.basename(destination)}: ${(received / 1e6).toFixed(0)} MB${pct}`);
      }
      controller.enqueue(chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body.pipeThrough(progress)), createWriteStream(temp));
  renameSync(temp, destination);
  console.log(`saved: ${path.relative(process.cwd(), destination)} (${(received / 1e6).toFixed(0)} MB)`);
}

/** Known-good build used when the GitHub API is unavailable (for example, rate limited). */
const FALLBACK_TAG = 'b12631';
const FALLBACK_CUDA = '13.5';

function directRelease(releaseTag, cudaVersion) {
  const base = `https://github.com/ggml-org/llama.cpp/releases/download/${releaseTag}`;
  const bin = `llama-${releaseTag}-bin-win-cuda-${cudaVersion}-x64.zip`;
  const runtime = `cudart-llama-bin-win-cuda-${cudaVersion}-x64.zip`;
  return {
    tag: releaseTag,
    bin: { name: bin, browser_download_url: `${base}/${bin}` },
    runtime: { name: runtime, browser_download_url: `${base}/${runtime}` }
  };
}

async function findRelease() {
  const url = tag
    ? `https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${tag}`
    : 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10';
  const headers = { 'User-Agent': 'lingoflux-local-mt-setup' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const fallbackTag = tag || FALLBACK_TAG;
    console.log(`GitHub API returned ${response.status}; using ${fallbackTag} CUDA ${FALLBACK_CUDA} direct links.`);
    return directRelease(fallbackTag, arg('--cuda-version', FALLBACK_CUDA));
  }
  const data = await response.json();
  const releases = Array.isArray(data) ? data : [data];
  const cudaRe = new RegExp(`win-cuda-${cudaMajor}\\.[0-9.]+-x64\\.zip$`);
  for (const release of releases) {
    const bin = release.assets.find((asset) => /^llama-.*-bin-/.test(asset.name) && cudaRe.test(asset.name));
    const runtime = release.assets.find((asset) => /^cudart-/.test(asset.name) && cudaRe.test(asset.name));
    if (bin && runtime) return { tag: release.tag_name, bin, runtime };
  }
  throw new Error(`No llama.cpp release with Windows CUDA ${cudaMajor} x64 assets found.`);
}

function extract(zip, destination) {
  mkdirSync(destination, { recursive: true });
  // Use Windows' bsdtar (reads .zip); a GNU tar earlier on PATH (Git Bash) cannot.
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-xf', zip, '-C', destination], { stdio: 'inherit' });
}

async function setupLlama() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    console.log(
      'llama.cpp auto-install supports Windows x64 only. Install llama-server yourself and pass --skip-llama.'
    );
    return;
  }
  if (existsSync(path.join(LLAMA_DIR, 'llama-server.exe'))) {
    console.log('exists: .local-mt/llama/llama-server.exe');
    return;
  }
  const release = await findRelease();
  console.log(`llama.cpp ${release.tag}: ${release.bin.name} + ${release.runtime.name}`);
  const downloads = path.join(LOCAL_MT_DIR, 'downloads');
  mkdirSync(downloads, { recursive: true });
  const binZip = path.join(downloads, release.bin.name);
  const runtimeZip = path.join(downloads, release.runtime.name);
  await download(release.bin.browser_download_url, binZip);
  await download(release.runtime.browser_download_url, runtimeZip);

  const staging = path.join(LOCAL_MT_DIR, 'llama-staging');
  rmSync(staging, { recursive: true, force: true });
  extract(binZip, staging);
  extract(runtimeZip, staging);
  // Some archives nest everything in one folder; flatten so llama-server.exe sits next to the DLLs.
  const entries = readdirSync(staging);
  const root = entries.length === 1 && !entries[0].includes('.') ? path.join(staging, entries[0]) : staging;
  rmSync(LLAMA_DIR, { recursive: true, force: true });
  renameSync(root, LLAMA_DIR);
  rmSync(staging, { recursive: true, force: true });
  writeFileSync(path.join(LLAMA_DIR, 'VERSION'), `${release.tag}\n`);
  rmSync(downloads, { recursive: true, force: true });
  console.log(`installed llama.cpp ${release.tag} → .local-mt/llama/`);
}

async function setupModel() {
  mkdirSync(MODELS_DIR, { recursive: true });
  const file = modelFile(quant);
  await download(`https://huggingface.co/${MODEL_REPO}/resolve/main/${path.basename(file)}`, file);
}

mkdirSync(LOCAL_MT_DIR, { recursive: true });
if (!skipLlama) await setupLlama();
await setupModel();
console.log('Done. Start with: npm run local-mt:start');

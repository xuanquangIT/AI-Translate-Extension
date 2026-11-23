import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRIDGE_PORT, LLAMA_PORT, modelFile, modelId } from '../../scripts/local-mt/paths.mjs';
import { buildIcoFromPng } from '../../scripts/local-mt/shortcut.mjs';

const tray = readFileSync(new URL('../../scripts/local-mt/tray.ps1', import.meta.url), 'utf8');

test('tray.ps1 default ports match paths.mjs', () => {
  assert.equal(Number(tray.match(/\[int\]\$BridgePort = (\d+)/)?.[1]), BRIDGE_PORT);
  assert.equal(Number(tray.match(/\[int\]\$LlamaPort = (\d+)/)?.[1]), LLAMA_PORT);
});

test('local MT ports are uncommon and outside the Windows ephemeral range', () => {
  for (const port of [BRIDGE_PORT, LLAMA_PORT]) {
    assert.ok(port > 10_000 && port < 49_152, `${port}`);
  }
  assert.notEqual(BRIDGE_PORT, LLAMA_PORT);
});

test('tray.ps1 stays ASCII so Windows PowerShell 5.1 reads it without a BOM', () => {
  const allowed = (code) => code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
  assert.ok([...tray].every((char) => allowed(char.charCodeAt(0))));
});

test('tray.ps1 only force-stops node or llama-server processes found on its ports', () => {
  assert.match(tray, /@\('node', 'llama-server'\) -contains \$process\.ProcessName/);
});

test('buildIcoFromPng wraps the PNG with a one-image icon header', () => {
  const png = readFileSync(new URL('../../src/assets/icons/icon128.png', import.meta.url));
  const ico = buildIcoFromPng(png);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 1);
  const width = png.readUInt32BE(16);
  assert.equal(ico.readUInt8(6), width >= 256 ? 0 : width); // 0 means 256 or more

  assert.equal(ico.readUInt32LE(14), png.length);
  assert.equal(ico.readUInt32LE(18), 22);
  assert.ok(ico.subarray(22).equals(png));
});

test('buildIcoFromPng rejects non-PNG input', () => {
  assert.throws(() => buildIcoFromPng(Buffer.alloc(32)), /not a PNG/);
});

test('modelFile and modelId follow the quantization', () => {
  assert.match(modelFile('Q8_0'), /gemma-4-E2B-it-Q8_0.gguf$/);
  assert.equal(modelId(), 'gemma-4-e2b-q4_k_m');
  assert.equal(modelId('Q8_0'), 'gemma-4-e2b-q8_0');
});

test('start.mjs keeps model data out of host RAM', () => {
  const start = readFileSync(new URL('../../scripts/local-mt/start.mjs', import.meta.url), 'utf8');
  assert.match(start, /'--load-mode',\s*'none'/);
  assert.match(start, /'--cache-ram',\s*'0'/);
  assert.ok(start.includes("'--override-tensor', `token_embd=${embedDevice}`"));
});

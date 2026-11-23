/**
 * Catalog of the local translation models the bridge can serve, and the saved model selection.
 *
 * Each selected model runs in its own llama-server on `LLAMA_PORT + portOffset`; the bridge on BRIDGE_PORT lists
 * every loaded model in /v1/models and routes each request by its `model` field (unknown names go to the first
 * loaded model, so an existing LingoFlux provider keeps working after the selection changes).
 * Benchmarks behind this list: docs/LOCAL_MT.md, "Choosing a model".
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildMtPrompt, languageName } from './lib.mjs';
import { DEFAULT_QUANT, LOCAL_MT_DIR, MODELS_DIR } from './paths.mjs';

/** Chinese language names for the Index-Translate instruction (its model card asks for a Chinese prompt). */
const ZH_NAMES = Object.freeze({
  en: '英语',
  vi: '越南语',
  ja: '日语',
  ko: '韩语',
  zh: '中文',
  fr: '法语',
  es: '西班牙语',
  de: '德语',
  ru: '俄语',
  pt: '葡萄牙语',
  it: '意大利语',
  ar: '阿拉伯语',
  hi: '印地语',
  th: '泰语',
  id: '印度尼西亚语',
  nl: '荷兰语',
  pl: '波兰语',
  tr: '土耳其语',
  uk: '乌克兰语'
});

/** Index-Translate prompt: target language only, the model detects the source. */
export function buildIndexTranslatePrompt({ text, targetLanguage }) {
  const code = String(targetLanguage || '')
    .trim()
    .toLowerCase();
  const target = ZH_NAMES[code] || languageName(targetLanguage);
  return `请将以下文本翻译为${target}，直接输出翻译结果，不要进行任何解释。\n\n${text}`;
}

export const LOCAL_MODELS = Object.freeze([
  Object.freeze({
    key: 'gemma',
    label: 'Gemma 4 E2B',
    description: 'fast, best forms of address in dialogue',
    repo: 'unsloth/gemma-4-E2B-it-GGUF',
    license: 'Apache-2.0',
    quantizable: true,
    defaultQuant: DEFAULT_QUANT,
    fileFor: (quant) => `gemma-4-E2B-it-${quant}.gguf`,
    idFor: (quant) => `gemma-4-e2b-${quant}`.toLowerCase(),
    portOffset: 0,
    // Gemma 4 keeps ~1.7 GB of token/per-layer embeddings in host RAM unless they are moved to the GPU.
    embedOnGpu: true,
    buildPrompt: buildMtPrompt
  }),
  Object.freeze({
    key: 'index',
    label: 'Index-Translate 2B',
    description: 'translation model, better on documents and HTML',
    repo: 'IndexTeam/Index-Translate-2B-GGUF',
    license: 'Apache-2.0',
    quantizable: false,
    defaultQuant: 'Q8_0',
    fileFor: (quant) => `Index-Translate-2B.${quant}.gguf`,
    idFor: (quant) => `index-translate-2b-${quant}`.toLowerCase(),
    portOffset: 1,
    embedOnGpu: false,
    buildPrompt: buildIndexTranslatePrompt
  })
]);

export const DEFAULT_SELECTION = 'gemma';
export const CONFIG_FILE = path.join(LOCAL_MT_DIR, 'config.json');

/**
 * Resolves a selection ("gemma", "index", "all", or a comma list of keys) to catalog entries in catalog order.
 * Throws on unknown keys so a typo never silently starts the wrong model.
 */
export function parseModelSelection(value = DEFAULT_SELECTION) {
  const text = String(value || DEFAULT_SELECTION)
    .trim()
    .toLowerCase();
  if (text === 'all') return [...LOCAL_MODELS];
  const keys = text
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  for (const key of keys) {
    if (!LOCAL_MODELS.some((model) => model.key === key)) {
      throw new Error(`Unknown model "${key}". Use ${LOCAL_MODELS.map((m) => m.key).join(', ')} or all.`);
    }
  }
  const selected = LOCAL_MODELS.filter((model) => keys.includes(model.key));
  if (selected.length === 0) throw new Error('No model selected.');
  return selected;
}

/** The concrete runtime settings for one selected model. `quant` applies only to quantizable models. */
export function resolveModel(model, { quant, llamaPort, modelsDir = MODELS_DIR } = {}) {
  const chosen = model.quantizable && quant ? quant : model.defaultQuant;
  return {
    key: model.key,
    label: model.label,
    id: model.idFor(chosen),
    file: path.join(modelsDir, model.fileFor(chosen)),
    url: `https://huggingface.co/${model.repo}/resolve/main/${model.fileFor(chosen)}`,
    port: llamaPort + model.portOffset,
    embedOnGpu: model.embedOnGpu,
    buildPrompt: model.buildPrompt
  };
}

/** Saved selection: what the tray picked last, used when --models is not given. */
export function readSelection(file = CONFIG_FILE) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))?.models;
    if (typeof value === 'string' && value.trim()) {
      parseModelSelection(value);
      return value.trim().toLowerCase();
    }
  } catch {}
  return DEFAULT_SELECTION;
}

export function writeSelection(value, file = CONFIG_FILE) {
  parseModelSelection(value);
  if (!existsSync(path.dirname(file))) mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ models: String(value).trim().toLowerCase() }, null, 2) + '\n');
}

/**
 * Splits the shared settings between the models that run at once. Two models share one 8 GB GPU, so each gets
 * half of the KV cache and of the parallel slots; one model keeps the full budget.
 */
export function perModelBudget({ parallel, ctx }, count) {
  if (count <= 1) return { parallel, ctx };
  return {
    parallel: Math.max(1, Math.floor(parallel / count)),
    ctx: Math.max(4096, Math.floor(ctx / count))
  };
}

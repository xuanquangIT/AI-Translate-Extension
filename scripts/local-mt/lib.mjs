/**
 * Pure helpers for the local machine-translation bridge (scripts/local-mt/server.mjs).
 *
 * The extension speaks its translation-only contract: a fixed system policy plus a JSON user envelope
 * (src/translation/prompt.js), answered by exactly one JSON object (src/translation/response.js).
 * A small local model cannot follow that contract reliably, so the bridge reads the envelope, sends each
 * text to the model with a plain instruction prompt, and assembles the exact JSON reply itself.
 * Every segment is an independent request, which lets llama-server batch them on the GPU.
 */

import { LANGUAGES } from '../../src/shared/languages.js';

const NAMES = new Map(LANGUAGES.map(({ code, name }) => [code, name]));

/** Maps a language code (or an already spelled-out name) to an English language name. */
export function languageName(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return NAMES.get(key) || String(value || '').trim();
}

const isAuto = (value) => !value || /^(auto|the detected source language)$/i.test(String(value).trim());

/**
 * Builds the plain instruction prompt sent to the local model for one segment. This exact wording was
 * measured on a 70-item set (docs/LOCAL_MT.md); change it only with a new measurement.
 */
export function buildMtPrompt({ text, sourceLanguage, targetLanguage }) {
  const from = isAuto(sourceLanguage) ? '' : ` from ${languageName(sourceLanguage)}`;
  return (
    `Translate the following text${from} into ${languageName(targetLanguage)}. ` +
    'Output only the translation, with no explanations or notes. ' +
    `Keep names, numbers, code, URLs and formatting unchanged.

${text}`
  );
}

/**
 * Reads the extension's JSON user envelope from an OpenAI chat request body.
 * @returns {{ kind: 'single', sourceLanguage: string, targetLanguage: string, text: string }
 *         | { kind: 'batch', sourceLanguage: string, targetLanguage: string, segments: {id: string, text: string}[] }}
 */
export function parseEnvelope(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = [...messages].reverse().find((message) => message?.role === 'user');
  if (!user || typeof user.content !== 'string') throw new Error('Request has no user message.');
  let envelope;
  try {
    envelope = JSON.parse(user.content);
  } catch {
    throw new Error('User message is not a LingoFlux translation envelope.');
  }
  if (envelope?.operation !== 'translate_only') throw new Error('Unsupported operation.');
  const targetLanguage = String(envelope.target_language || '').trim();
  if (!targetLanguage) throw new Error('Envelope has no target_language.');
  const sourceLanguage = String(envelope.source_language || 'auto');

  if (Array.isArray(envelope.segments)) {
    const segments = envelope.segments.map((segment) => {
      if (typeof segment?.id !== 'string' || typeof segment?.text !== 'string') {
        throw new Error('Every segment needs a string id and text.');
      }
      return { id: segment.id, text: segment.text };
    });
    return { kind: 'batch', sourceLanguage, targetLanguage, segments };
  }
  if (typeof envelope.source_text === 'string') {
    return { kind: 'single', sourceLanguage, targetLanguage, text: envelope.source_text };
  }
  throw new Error('Envelope has neither segments nor source_text.');
}

/** Removes wrappers small models sometimes add around the answer. */
export function cleanModelOutput(text) {
  return String(text || '')
    .replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '')
    .trim();
}

/** Runs `fn` over `items` with at most `limit` calls in flight, keeping input order. */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Han, kana, hangul, and full-width forms: one source character often becomes 2-4 output tokens. */
const WIDE_CHAR = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/u;

export const MAX_SEGMENT_TOKENS = 2048;

/** Output token budget for one segment: generous for scripts that tokenize long, bounded for safety. */
export function segmentMaxTokens(text) {
  let weight = 0;
  for (const char of String(text)) weight += WIDE_CHAR.test(char) ? 4 : 1.5;
  return Math.min(MAX_SEGMENT_TOKENS, Math.max(64, Math.ceil(weight) + 32));
}

/**
 * Translates one envelope with `translateText({ prompt, text, maxTokens })`, which returns
 * `{ text, completionTokens, promptTokens }`. Returns the exact JSON content the extension expects.
 */
export async function translateEnvelope(envelope, translateText, concurrency = 16) {
  const run = async (text) => {
    if (!text.trim()) return { text, completionTokens: 0, promptTokens: 0 };
    const prompt = buildMtPrompt({
      text,
      sourceLanguage: envelope.sourceLanguage,
      targetLanguage: envelope.targetLanguage
    });
    const result = await translateText({ prompt, text, maxTokens: segmentMaxTokens(text) });
    return { ...result, text: cleanModelOutput(result.text) };
  };

  if (envelope.kind === 'single') {
    const result = await run(envelope.text);
    return {
      content: JSON.stringify({ translation: result.text }),
      usage: usageOf([result])
    };
  }

  const results = await mapWithConcurrency(envelope.segments, concurrency, (segment) => run(segment.text));
  return {
    content: JSON.stringify({
      translations: envelope.segments.map((segment, index) => ({ id: segment.id, text: results[index].text }))
    }),
    usage: usageOf(results)
  };
}

function usageOf(results) {
  const prompt_tokens = results.reduce((sum, item) => sum + (item.promptTokens || 0), 0);
  const completion_tokens = results.reduce((sum, item) => sum + (item.completionTokens || 0), 0);
  return { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens };
}

/** Wraps content in an OpenAI chat.completion response. */
export function chatCompletion(model, content, usage) {
  return {
    id: `chatcmpl-local-${Date.now().toString(36)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage
  };
}

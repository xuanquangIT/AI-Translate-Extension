/**
 * Pure helpers for the local MT model benchmark (scripts/local-mt/eval.mjs).
 *
 * Each candidate model is prompted the way its authors recommend (translation-tuned models are sensitive to the
 * prompt shape); general instruction models get the bridge prompt the extension uses today (buildMtPrompt).
 * Quality metrics (chrF++, BLEU, COMET) are computed by scripts/local-mt/eval-score.py with the reference
 * implementations; this module only checks the rubric patterns of the hand-written items and aggregates numbers.
 */

import { buildMtPrompt } from './lib.mjs';

/**
 * Candidate models: only those that fit entirely on an 8 GB laptop GPU (12B models were dropped: partly on the CPU
 * they ran at about 16 tok/s). `file` lives in .local-mt/models/. `style` selects the prompt format. `ngl` 99 offloads
 * every layer. `ctx` overrides the 32K shared KV cache and `kvType` its precision: a 7B+ model with a 32K f16 cache
 * spills past 8 GB into shared GPU memory and slows down sharply. `embedOnGpu` moves Gemma 4's large embedding
 * tables to the GPU.
 */
export const EVAL_MODELS = Object.freeze([
  {
    id: 'gemma4-e2b',
    label: 'Gemma 4 E2B Q4_K_M',
    repo: 'unsloth/gemma-4-E2B-it-GGUF',
    file: 'gemma-4-E2B-it-Q4_K_M.gguf',
    license: 'Apache-2.0',
    style: 'instruct',
    ngl: 99,
    embedOnGpu: true
  },
  {
    id: 'hymt2-1.8b',
    label: 'Hy-MT2 1.8B Q8_0',
    repo: 'tencent/Hy-MT2-1.8B-GGUF',
    file: 'Hy-MT2-1.8B-Q8_0.gguf',
    license: 'Apache-2.0',
    style: 'hymt',
    ngl: 99
  },
  {
    id: 'milmmt-4b',
    label: 'MiLMMT-46 4B Q4_K_M',
    repo: 'mradermacher/MiLMMT-46-4B-v1.0-GGUF',
    file: 'MiLMMT-46-4B-v1.0.Q4_K_M.gguf',
    license: 'Gemma',
    style: 'milmmt',
    ngl: 99
  },
  {
    id: 'gemma4-e4b',
    label: 'Gemma 4 E4B Q4_K_M',
    repo: 'unsloth/gemma-4-E4B-it-GGUF',
    file: 'gemma-4-E4B-it-Q4_K_M.gguf',
    license: 'Apache-2.0',
    style: 'instruct',
    ngl: 99,
    embedOnGpu: true
  },
  {
    id: 'hymt2-7b',
    label: 'Hy-MT2 7B Q4_K_M',
    repo: 'tencent/Hy-MT2-7B-GGUF',
    file: 'Hy-MT2-7B-Q4_K_M.gguf',
    license: 'Apache-2.0',
    style: 'hymt',
    ngl: 99,
    ctx: 16384,
    kvType: 'q8_0'
  },
  {
    id: 'seedx-7b',
    label: 'Seed-X-PPO 7B Q4_K_M',
    repo: 'mradermacher/Seed-X-PPO-7B-GGUF',
    file: 'Seed-X-PPO-7B.Q4_K_M.gguf',
    license: 'OpenMDW',
    style: 'seedx',
    ngl: 99,
    ctx: 16384,
    kvType: 'q8_0'
  },
  {
    id: 'qwen35-9b',
    label: 'Qwen3.5 9B Q4_K_M',
    repo: 'unsloth/Qwen3.5-9B-GGUF',
    file: 'Qwen3.5-9B-Q4_K_M.gguf',
    license: 'Apache-2.0',
    style: 'instruct',
    ngl: 99,
    ctx: 16384,
    kvType: 'q8_0'
  },
  {
    id: 'erax-4b',
    label: 'EraX-Translator 4B Q4_K_M',
    repo: 'erax-ai/EraX-Translator-V1.0-GGUF',
    file: 'EraX-Translator-V1.0-Q4_K_M.gguf',
    license: 'Gemma',
    style: 'erax',
    ngl: 99
  },
  {
    id: 'indextrans-2b',
    label: 'Index-Translate 2B Q8_0',
    repo: 'IndexTeam/Index-Translate-2B-GGUF',
    file: 'Index-Translate-2B.Q8_0.gguf',
    license: 'Apache-2.0',
    style: 'indextrans',
    ngl: 99
  },
  {
    id: 'lmt60-4b',
    label: 'LMT-60 4B Q4_K_M',
    repo: 'mradermacher/LMT-60-4B-GGUF',
    file: 'LMT-60-4B.Q4_K_M.gguf',
    license: 'Apache-2.0',
    style: 'lmt',
    ngl: 99,
    ctx: 16384,
    kvType: 'q8_0'
  },
  {
    id: 'plamo3-2b',
    label: 'PLaMo 3 Translate 2B Q4_K_M',
    repo: 'pfnet/plamo-3-translate-2b-GGUF',
    file: 'plamo-3-translate-2b-Q4_K_M.gguf',
    license: 'PLaMo Community',
    style: 'plamo',
    ngl: 99,
    ctx: 16384,
    kvType: 'q8_0'
  }
]);

export function findModel(id) {
  const model = EVAL_MODELS.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`Unknown model "${id}". Known: ${EVAL_MODELS.map((m) => m.id).join(', ')}`);
  return model;
}

/** English names used by the MiLMMT prompt (its model card asks for these exact names). */
const EN_NAMES = { en: 'English', vi: 'Vietnamese', zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean' };
/** Hy-MT2 wants Chinese language names inside its Chinese prompt. */
const ZH_NAMES = { en: '英语', vi: '越南语', zh: '中文', ja: '日语', ko: '韩语' };
const PLAIN_NAMES = { en: 'English', vi: 'Vietnamese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean' };
/** EraX-Translator's instruction names the target in Vietnamese: "Dịch sang tiếng Việt." */
const VI_NAMES = { en: 'Anh', vi: 'Việt', zh: 'Trung', ja: 'Nhật', ko: 'Hàn' };

/** EraX-Translator model card system prompt, verbatim. */
export const ERAX_SYSTEM_PROMPT =
  'Bạn là Trợ lý AI xuất sắc về dịch thuật nhiều ngôn ngữ, đặc biệt tiếng Anh, tiếng Trung Hoa, tiếng Việt. \n' +
  'Bạn cũng là 1 Hoà thượng Phật giáo uyên thâm về dịch thuật Cổ văn Trung Quốc. Người dùng sẽ giao nhiệm vụ dịch ' +
  'thuật cho bạn từ ngôn ngữ bất kỳ sang một ngôn ngữ được chỉ định.\n' +
  'Nhiệm vụ của bạn là dịch thật sát nghĩa, thể hiện đúng ý của bài gốc và không chế tác hay bịa đặt gì thêm. Đặc ' +
  'biệt lưu ý danh xưng phải giữ nguyên vẹn, dịch đúng tên người, tên địa danh phải tuyệt đối chính xác. Không được ' +
  'bình luận, không được cung cấp lời giới thiệu hay mở bài hay kết luận gì, chỉ dịch thật sát nghĩa và không bỏ ' +
  'qua bất kỳ ý hay từ nào.\n';

const ERAX_STOPS = Object.freeze(['<|im_end|>', '<|im_start|>']);

/** PLaMo 3 Translate stops at its own PFML3 tags. */
const PLAMO_STOPS = Object.freeze(['<|plamo:tag|>', '<|plamo:bos|>']);

function nameOf(table, code) {
  const name = table[code];
  if (!name) throw new Error(`Unsupported language code: ${code}`);
  return name;
}

/** Stops completion-style models from starting another translation exercise after the answer. */
const COMPLETION_STOPS = Object.freeze(['\nTranslate this from', '\nTranslate the following']);

/**
 * Builds the llama-server request for one segment.
 * @returns {{ path: string, body: object }}
 */
export function buildEvalRequest(style, { text, src, tgt }, maxTokens) {
  const common = { max_tokens: maxTokens, n_predict: maxTokens, temperature: 0, cache_prompt: false };
  if (style === 'instruct') {
    return {
      path: '/v1/chat/completions',
      body: {
        messages: [{ role: 'user', content: buildMtPrompt({ text, sourceLanguage: src, targetLanguage: tgt }) }],
        chat_template_kwargs: { enable_thinking: false },
        ...common
      }
    };
  }
  if (style === 'hymt') {
    // Model card: Chinese prompt when Chinese is involved, English prompt otherwise; no system prompt.
    const content =
      src === 'zh' || tgt === 'zh'
        ? `将以下文本翻译为${nameOf(ZH_NAMES, tgt)}，注意只需要输出翻译后的结果，不要额外解释：\n\n${text}`
        : `Translate the following text into ${nameOf(PLAIN_NAMES, tgt)}. Note that you should only output the ` +
          `translated result without any additional explanation:\n\n${text}`;
    return { path: '/v1/chat/completions', body: { messages: [{ role: 'user', content }], ...common } };
  }
  if (style === 'milmmt') {
    const from = nameOf(EN_NAMES, src);
    const to = nameOf(EN_NAMES, tgt);
    return {
      path: '/completion',
      body: {
        prompt: `Translate this from ${from} to ${to}:\n${from}: ${text}\n${to}:`,
        stop: COMPLETION_STOPS,
        ...common
      }
    };
  }
  if (style === 'seedx') {
    // Model card: no chat template; the target language tag at the end of the prompt is required.
    const prompt =
      `Translate the following ${nameOf(PLAIN_NAMES, src)} sentence into ${nameOf(PLAIN_NAMES, tgt)}:\n` +
      `${text} <${tgt}>`;
    return { path: '/completion', body: { prompt, stop: COMPLETION_STOPS, ...common } };
  }
  if (style === 'erax') {
    // Model card: fixed Vietnamese system prompt, then the text followed by "Dịch sang tiếng <target>."
    return {
      path: '/v1/chat/completions',
      body: {
        messages: [
          { role: 'system', content: ERAX_SYSTEM_PROMPT },
          { role: 'user', content: `${text}\nDịch sang tiếng ${nameOf(VI_NAMES, tgt)}.` }
        ],
        // The GGUF never emits <end_of_turn>: it writes a literal ChatML "<|im_end|>" and keeps inventing turns.
        stop: ERAX_STOPS,
        ...common
      }
    };
  }
  if (style === 'indextrans') {
    // Model card: Chinese instruction with a Chinese target-language name, thinking off.
    const content = `请将以下文本翻译为${nameOf(ZH_NAMES, tgt)}，直接输出翻译结果，不要进行任何解释。\n\n${text}`;
    return {
      path: '/v1/chat/completions',
      body: { messages: [{ role: 'user', content }], chat_template_kwargs: { enable_thinking: false }, ...common }
    };
  }
  if (style === 'lmt') {
    // Model card: "Translate the following text from X into Y:\nX: <text>\nY:" inside the chat template.
    const from = nameOf(PLAIN_NAMES, src);
    const to = nameOf(PLAIN_NAMES, tgt);
    const content = `Translate the following text from ${from} into ${to}:\n${from}: ${text}\n${to}:`;
    return {
      path: '/v1/chat/completions',
      body: { messages: [{ role: 'user', content }], chat_template_kwargs: { enable_thinking: false }, ...common }
    };
  }
  if (style === 'plamo') {
    // Model card: the embedded chat template builds the PFML3 prompt from these kwargs.
    nameOf(PLAIN_NAMES, tgt);
    return {
      path: '/v1/chat/completions',
      body: {
        messages: [{ role: 'user', content: text }],
        chat_template_kwargs: { source_lang: src, target_lang: tgt },
        stop: PLAMO_STOPS,
        ...common
      }
    };
  }
  throw new Error(`Unknown prompt style: ${style}`);
}

/**
 * Reads text, token counts, and llama-server timings from either endpoint's reply.
 * @returns {{ text: string, promptTokens: number, completionTokens: number, finish: string, timings: object|null }}
 */
export function readEvalResponse(data) {
  const timings = data?.timings ?? null;
  if (Array.isArray(data?.choices)) {
    const choice = data.choices[0] ?? {};
    return {
      text: stripThinking(choice.message?.content ?? ''),
      promptTokens: data.usage?.prompt_tokens ?? timings?.prompt_n ?? 0,
      completionTokens: data.usage?.completion_tokens ?? timings?.predicted_n ?? 0,
      finish: choice.finish_reason ?? 'unknown',
      timings
    };
  }
  return {
    text: stripThinking(data?.content ?? ''),
    promptTokens: data?.tokens_evaluated ?? timings?.prompt_n ?? 0,
    completionTokens: data?.tokens_predicted ?? timings?.predicted_n ?? 0,
    finish: data?.stop_type === 'limit' || data?.truncated ? 'length' : 'stop',
    timings
  };
}

function stripThinking(text) {
  return String(text)
    .replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '')
    .trim();
}

const LETTER_OR_DIGIT = '[\\p{L}\\p{N}\\p{M}]';

/** Compiles one rubric pattern; a leading `w:` limits it to whole words (Unicode-aware, unlike `\b`). */
export function compileCheck(pattern) {
  const wholeWord = pattern.startsWith('w:');
  const body = wholeWord ? pattern.slice(2) : pattern;
  const source = wholeWord ? `(?<!${LETTER_OR_DIGIT})(?:${body})(?!${LETTER_OR_DIGIT})` : body;
  return new RegExp(source, 'iu');
}

/**
 * Scores a hypothesis against an item's rubric patterns.
 * @returns {{ passed: number, total: number, failures: string[] }}
 */
export function checkRubric(item, hypothesis) {
  const text = String(hypothesis ?? '')
    .normalize('NFC')
    .trim();
  const failures = [];
  for (const pattern of item.require ?? []) {
    if (!compileCheck(pattern).test(text)) failures.push(`missing ${pattern}`);
  }
  for (const pattern of item.forbid ?? []) {
    if (compileCheck(pattern).test(text)) failures.push(`forbidden ${pattern}`);
  }
  const total = (item.require?.length ?? 0) + (item.forbid?.length ?? 0);
  return { passed: total - failures.length, total, failures };
}

/** Script check: did the output end up in the target language's script at all? */
const SCRIPT = {
  vi: /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/iu,
  zh: /\p{Script=Han}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
  ko: /\p{Script=Hangul}/u,
  en: /[a-z]/i
};

/** True when the hypothesis contains characters of the target script (catches untranslated or wrong-language output). */
export function looksLikeTarget(tgt, hypothesis) {
  const pattern = SCRIPT[tgt];
  return pattern ? pattern.test(String(hypothesis ?? '')) : true;
}

/** Nearest-rank percentile of a numeric array. */
export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

/** Groups rows by a key function and averages the selected numeric fields. */
export function groupMeans(rows, keyOf, fields) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const result = {};
  for (const [key, members] of groups) {
    const entry = { n: members.length };
    for (const field of fields) {
      const values = members.map((row) => row[field]).filter(Number.isFinite);
      entry[field] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    }
    result[key] = entry;
  }
  return result;
}

/**
 * Picks `count` evenly spaced indices from `0..length-1` (deterministic sampling of a test file).
 */
export function spreadIndices(length, count) {
  if (count >= length) return Array.from({ length }, (_, index) => index);
  const step = length / count;
  return Array.from({ length: count }, (_, index) => Math.floor(index * step));
}

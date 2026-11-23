/**
 * Strict parsers for provider output. Anything that is not the exact
 * translation-only JSON contract fails closed so the fallback chain can try
 * another model. See docs/CONTRACTS.md#provider-adapter-contract.
 */

/**
 * Leading reasoning blocks some models emit inline before the answer, e.g. Gemma 4 on the Gemini API
 * (`<thought>…</thought>{"translation":…}`) or DeepSeek/Qwen (`<think>…</think>`). Only complete blocks
 * at the very start are removed; the remainder must still be the exact JSON contract. The reasoning
 * often quotes the contract (`{"translation":"translated text"}`), so it must never be searched for JSON.
 */
const LEADING_REASONING = /^\s*<(think|thinking|thought|reasoning)>[\s\S]*?<\/\1>\s*/i;

function stripLeadingReasoning(text) {
  let result = text;
  while (LEADING_REASONING.test(result)) result = result.replace(LEADING_REASONING, '');
  // Unterminated reasoning (for example cut off by the token limit): nothing in it is an answer.
  if (/^\s*<(think|thinking|thought|reasoning)>/i.test(result)) return '';
  return result.trim();
}

function jsonObjectCandidates(text, requiredProperty) {
  const raw = stripLeadingReasoning(String(text || '').trim());
  if (!raw) return [];
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const object = raw.match(new RegExp(`\\{[\\s\\S]*"${requiredProperty}"[\\s\\S]*\\}`, 'i'));
  if (object?.[0]) candidates.push(object[0]);
  return [...new Set(candidates)];
}

function objectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
}

/** Parses `{"translation": "..."}` and returns the translated string. */
export function parseSingleTranslationResponse(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('The provider returned an empty translation.');
  for (const candidate of jsonObjectCandidates(raw, 'translation')) {
    try {
      const parsed = JSON.parse(candidate);
      const keys = objectKeys(parsed);
      if (
        keys.length === 1 &&
        keys[0] === 'translation' &&
        typeof parsed.translation === 'string' &&
        parsed.translation.trim()
      ) {
        return parsed.translation.trim();
      }
    } catch (_) {
      // Try the next candidate.
    }
  }
  throw new Error('The provider did not return the required translation-only JSON.');
}

/** Rejects answer-shaped output: a source question must stay a question. */
export function validateTranslationOnlyResult(sourceText, translatedText) {
  const source = String(sourceText || '');
  const translation = String(translatedText || '');
  if (/[?？؟]/u.test(source) && !/[?？؟]/u.test(translation)) {
    throw new Error('The provider output did not preserve the source question as a question.');
  }
  return translation;
}

function hasExactIds(translations, requiredIds) {
  const returnedIds = translations.map((item) => item.id);
  if (returnedIds.length !== requiredIds.length || new Set(returnedIds).size !== returnedIds.length) return false;
  const returnedSet = new Set(returnedIds);
  return requiredIds.every((id) => returnedSet.has(id));
}

/** Parses `{"detected_source_language"?, "translations": [{id, text}]}` and checks every expected ID once. */
export function parseBatchTranslationResponse(text, expectedIds = []) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('The provider returned an empty page translation.');
  const requiredIds = Array.isArray(expectedIds) ? expectedIds.map((id) => String(id)) : [];
  for (const candidate of jsonObjectCandidates(raw, 'translations')) {
    try {
      const parsed = JSON.parse(candidate);
      const keys = objectKeys(parsed);
      if (!keys.length || keys.some((key) => !['detected_source_language', 'translations'].includes(key))) continue;
      if (!Array.isArray(parsed.translations)) continue;
      const wellFormed = parsed.translations.every(
        (item) => item && typeof item.id === 'string' && typeof item.text === 'string' && item.text.trim()
      );
      if (!wellFormed) continue;
      const translations = parsed.translations.map((item) => ({ id: item.id, text: item.text }));
      if (requiredIds.length && !hasExactIds(translations, requiredIds)) continue;
      return {
        detected_source_language: String(parsed.detected_source_language || ''),
        translations
      };
    } catch (_) {
      // Try the next candidate.
    }
  }
  throw new Error('The provider did not return the required page-translation JSON.');
}

/**
 * Lenient page-batch parser used by whole-page translation. The envelope stays strict (only
 * `detected_source_language` and `translations` keys, `translations` must be an array), but individual
 * entries are judged one by one: malformed, empty, duplicate, unknown-ID, or answer-shaped entries are
 * dropped (fail closed per segment) and reported in `missingIds` instead of failing the whole batch.
 * @returns {{ detected_source_language: string, translations: {id: string, text: string}[], missingIds: string[] }}
 */
export function parsePartialBatchTranslationResponse(text, segments) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('The provider returned an empty page translation.');
  const sourceById = new Map(segments.map((segment) => [String(segment.id), String(segment.text)]));
  for (const candidate of jsonObjectCandidates(raw, 'translations')) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch (_) {
      continue;
    }
    const keys = objectKeys(parsed);
    if (!keys.length || keys.some((key) => !['detected_source_language', 'translations'].includes(key))) continue;
    if (!Array.isArray(parsed.translations)) continue;

    const accepted = new Map();
    const rejected = new Set();
    for (const item of parsed.translations) {
      const id = typeof item?.id === 'string' ? item.id : '';
      if (!sourceById.has(id) || accepted.has(id)) continue;
      if (typeof item.text !== 'string' || !item.text.trim()) continue;
      try {
        accepted.set(id, validateTranslationOnlyResult(sourceById.get(id), item.text.trim()));
      } catch (_) {
        rejected.add(id); // answer-shaped entry: leave this segment untranslated
      }
    }
    return {
      detected_source_language: String(parsed.detected_source_language || ''),
      translations: [...accepted].map(([id, translation]) => ({ id, text: translation })),
      missingIds: [...sourceById.keys()].filter((id) => !accepted.has(id)),
      rejectedIds: [...rejected].filter((id) => !accepted.has(id))
    };
  }
  throw new Error('The provider did not return the required page-translation JSON.');
}

/** Pure formatting helpers shared by the runtime and Node regression tests. */

export function sanitizeIncomingText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeTranslatedText(value, sourceText = '') {
  let text = String(value || '').replace(/\r\n/g, '\n').trim();
  text = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:[\w-]+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^<translation>\s*/i, '')
    .replace(/\s*<\/translation>$/i, '')
    .trim()
    .replace(/^(?:translation|translated text|translated|output|result)\s*[:：-]\s*/i, '')
    .trim();
  const source = sanitizeIncomingText(sourceText);
  if (!source || !text.includes(source)) return text;
  const index = text.lastIndexOf(source);
  const prefix = text.slice(0, index).trim();
  const suffix = text.slice(index + source.length)
    .trim()
    .replace(/^(?:translation|translated text|translated|output|result)\s*[:：-]\s*/i, '')
    .trim();
  return prefix.length >= 40 || /(source text|target language|professional translat|output only)/i.test(prefix) ? (suffix || text) : text;
}

export function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value).length; index += 1) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function jsonObjectCandidates(text, requiredProperty) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const object = raw.match(new RegExp(`\\{[\\s\\S]*"${requiredProperty}"[\\s\\S]*\\}`, 'i'));
  if (object?.[0]) candidates.push(object[0]);
  return [...new Set(candidates)];
}

export function parseSingleTranslationResponse(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('The provider returned an empty translation.');
  for (const candidate of jsonObjectCandidates(raw, 'translation')) {
    try {
      const parsed = JSON.parse(candidate);
      const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [];
      if (keys.length === 1 && keys[0] === 'translation' && typeof parsed.translation === 'string' && parsed.translation.trim()) {
        return parsed.translation.trim();
      }
    } catch (_) {}
  }
  throw new Error('The provider did not return the required translation-only JSON.');
}

export function validateTranslationOnlyResult(sourceText, translatedText) {
  const source = String(sourceText || '');
  const translation = String(translatedText || '');
  if (/[?？؟]/u.test(source) && !/[?？؟]/u.test(translation)) {
    throw new Error('The provider output did not preserve the source question as a question.');
  }
  return translation;
}

export function parseBatchTranslationResponse(text, expectedIds = []) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('The provider returned an empty page translation.');
  const requiredIds = Array.isArray(expectedIds) ? expectedIds.map((id) => String(id)) : [];
  for (const candidate of jsonObjectCandidates(raw, 'translations')) {
    try {
      const parsed = JSON.parse(candidate);
      const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [];
      if (!keys.length || keys.some((key) => !['detected_source_language', 'translations'].includes(key))) continue;
      if (!Array.isArray(parsed.translations)) continue;
      if (!parsed.translations.every((item) => item && typeof item.id === 'string' && typeof item.text === 'string' && item.text.trim())) continue;
      const translations = parsed.translations.map((item) => ({ id: item.id, text: item.text }));
      if (requiredIds.length) {
        const returnedIds = translations.map((item) => item.id);
        if (returnedIds.length !== requiredIds.length || new Set(returnedIds).size !== returnedIds.length) continue;
        const returnedSet = new Set(returnedIds);
        if (requiredIds.some((id) => !returnedSet.has(id))) continue;
      }
      return {
        detected_source_language: String(parsed.detected_source_language || ''),
        translations
      };
    } catch (_) {}
  }
  throw new Error('The provider did not return the required page-translation JSON.');
}

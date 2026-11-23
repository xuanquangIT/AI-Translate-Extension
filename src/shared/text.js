/**
 * Pure text helpers shared by the runtime and Node tests.
 *
 * NOTE: `src/content/content.js` keeps a literal copy of `sanitizeIncomingText`
 * (named `cleanText`) because classic content scripts cannot import modules.
 * `tests/contract/content-script.test.js` checks that the copy stays equivalent.
 */

export function sanitizeIncomingText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const LABEL_PREFIX = /^(?:translation|translated text|translated|output|result)\s*[:：-]\s*/i;

/** Removes model chatter (reasoning tags, fences, labels, echoed source) from a parsed translation. */
export function sanitizeTranslatedText(value, sourceText = '') {
  let text = String(value || '')
    .replace(/\r\n/g, '\n')
    .trim();
  text = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:[\w-]+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^<translation>\s*/i, '')
    .replace(/\s*<\/translation>$/i, '')
    .trim()
    .replace(LABEL_PREFIX, '')
    .trim();

  const source = sanitizeIncomingText(sourceText);
  if (!source || !text.includes(source)) return text;

  const index = text.lastIndexOf(source);
  const prefix = text.slice(0, index).trim();
  const suffix = text
    .slice(index + source.length)
    .trim()
    .replace(LABEL_PREFIX, '')
    .trim();
  const echoedPrompt =
    prefix.length >= 40 || /(source text|target language|professional translat|output only)/i.test(prefix);
  return echoedPrompt ? suffix || text : text;
}

/** FNV-1a 32-bit hash, base36. Used for cache keys; not cryptographic. */
export function stableHash(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

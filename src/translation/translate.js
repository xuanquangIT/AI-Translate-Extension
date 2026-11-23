/**
 * One translation attempt against one provider/model. No storage, cache, or
 * fallback here: orchestration lives in `src/background/translation-service.js`.
 */

import { completeChat } from '../providers/index.js';
import { buildBatchTranslationRequest, buildSingleTranslationRequest, outputTokenLimit } from './prompt.js';
import {
  parseBatchTranslationResponse,
  parsePartialBatchTranslationResponse,
  parseSingleTranslationResponse,
  validateTranslationOnlyResult
} from './response.js';

const SINGLE_TIMEOUT_MS = 35_000;
const BATCH_TIMEOUT_MS = 70_000;

export async function translateWithProvider({
  provider,
  model,
  fromLang,
  toLang,
  systemPrompt,
  styleInstruction,
  text
}) {
  const request = buildSingleTranslationRequest({ fromLang, toLang, systemPrompt, styleInstruction, text });
  const raw = await completeChat({
    provider,
    model,
    ...request,
    maxTokens: outputTokenLimit(text),
    timeoutMs: SINGLE_TIMEOUT_MS,
    label: `${provider.name} translation`
  });
  return validateTranslationOnlyResult(text, parseSingleTranslationResponse(raw));
}

export async function translateBatchWithProvider({
  provider,
  model,
  fromLang,
  toLang,
  systemPrompt,
  styleInstruction,
  segments,
  partial = false
}) {
  const request = buildBatchTranslationRequest({ fromLang, toLang, systemPrompt, styleInstruction, segments });
  const raw = await completeChat({
    provider,
    model,
    ...request,
    maxTokens: outputTokenLimit(request.user, true),
    timeoutMs: BATCH_TIMEOUT_MS,
    label: `${provider.name} page translation`
  });
  if (partial) return parsePartialBatchTranslationResponse(raw, segments);
  const parsed = parseBatchTranslationResponse(
    raw,
    segments.map((segment) => segment.id)
  );
  const sourceById = new Map(segments.map((segment) => [segment.id, segment.text]));
  parsed.translations.forEach((item) => validateTranslationOnlyResult(sourceById.get(item.id), item.text));
  return parsed;
}

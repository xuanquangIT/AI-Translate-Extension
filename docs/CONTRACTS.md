# Runtime Contracts: Messages, Storage, and Providers

This describes the current contract, not a proposal. Update it in the same change that adds a message, storage key, or provider capability. `tests/contract/` fails when a registered message type or a `DEFAULTS` key is missing from this file.

Source of truth in code: message types in `src/shared/messages.js`, handlers in `src/background/router.js`, defaults and limits in `src/shared/config.js`, migrations in `src/storage/migrations.js`.

## Runtime message API

### Messages sent to background

| Type                                                                                   | Main payload                                           | Successful response                                | Callers        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------- | -------------- |
| `GET_SETTINGS`                                                                         | —                                                      | `{ settings }`                                     | popup, options |
| `SAVE_SETTINGS`                                                                        | session patch                                          | —                                                  | popup, options |
| `SAVE_DEFAULT_SETTINGS`                                                                | persistent default patch, including `systemPrompt`     | —                                                  | popup, options |
| `GET_PROVIDERS`                                                                        | —                                                      | `{ providers }`                                    | popup, options |
| `SAVE_PROVIDER`                                                                        | provider profile, optional `enabledModels`             | `{ provider }`                                     | options        |
| `REMOVE_PROVIDER`                                                                      | `{ id }`                                               | —                                                  | options        |
| `GET_AVAILABLE_MODELS`                                                                 | optional force flag                                    | `{ models, errors, providers, favoriteModels }`    | popup, options |
| `REFRESH_PROVIDER_MODELS`                                                              | optional `{ providerId }`                              | refreshed model catalog                            | popup, options |
| `GET_PROVIDER_MODEL_OPTIONS`                                                           | `{ providerId, force? }`                               | `{ models, enabledModels, error? }` (see below)    | options        |
| `TOGGLE_FAVORITE_MODEL`                                                                | model/provider to toggle                               | `{ favoriteModels, isFavorite }`                   | popup, options |
| `ADD_INSTRUCTION` / `UPDATE_INSTRUCTION` / `REMOVE_INSTRUCTION` / `TOGGLE_INSTRUCTION` | instruction data or `id`                               | —                                                  | popup, options |
| `GET_INSTRUCTIONS`                                                                     | —                                                      | `{ instructions }`                                 | popup, options |
| `TRANSLATE_TEXT`                                                                       | text plus optional model/languages/cache flag          | `{ translation }`                                  | popup, content |
| `TRANSLATE_SELECTION_IN_TAB`                                                           | translation options + `tabId`                          | `{ translation }` after page insertion             | popup          |
| `TRANSLATE_PAGE_IN_TAB`                                                                | translation options + `tabId`                          | `{ started, pending }` once the tab session starts | popup          |
| `RESTORE_PAGE_IN_TAB`                                                                  | `{ tabId }`                                            | `{ restored }` (text nodes put back)               | popup          |
| `TRANSLATE_PAGE`                                                                       | `{ segments, fromLang, toLang, model, modelProvider }` | `{ translations, failedIds, retryAfterMs? }`       | content        |
| `GET_HISTORY` / `CLEAR_HISTORY`                                                        | —                                                      | `{ history }` or —                                 | popup          |

**Model selection.** `SAVE_PROVIDER` accepts `enabledModels: string[]`, the discovered model ids the user selected. Omitted on an edit = keep the stored selection; a new provider without it starts with `[]`. Deselecting a model drops its favorite and, if it was the default or session model, re-selects another selectable model. `GET_AVAILABLE_MODELS` returns only selectable models: manual models plus selected discovered models (all discovered models for legacy profiles without `enabledModels`). `GET_PROVIDER_MODEL_OPTIONS` returns, for one provider, `models: { id, name }[]` = every manual and discovered model, unfiltered by selection (manual first), `enabledModels: string[] | null` (`null` = legacy, all shown), and `error` (string) when discovery failed; manual models are still listed then. Unknown provider → `{ ok: false, error: 'Provider not found.' }`. It never returns API keys or base URLs.

Every response is wrapped in top-level `ok`. The service worker owns tab-scoped translation jobs so they can finish after a popup loses focus or closes.

### Messages sent to content script

| Type                     | Payload                        | Response / effect                                        |
| ------------------------ | ------------------------------ | -------------------------------------------------------- |
| `GET_SELECTION`          | —                              | Sanitized `{ text, selectionId }` snapshot               |
| `INSERT_TRANSLATION`     | `{ translation, selectionId }` | Inserts at the snapshot range using current display mode |
| `SET_SELECTION_ENABLED`  | `{ enabled }`                  | Enables/disables floating selection UI                   |
| `SET_DISPLAY_MODE`       | `{ mode: 'badge'               | 'replace' }`                                             | Updates in-memory mode |
| `SHOW_TOAST`             | message/type/persistent        | Displays a notification                                  |
| `TRANSLATE_PAGE_START`   | `{ options }`                  | Starts/rescans the live page session; `{ pending }`      |
| `TRANSLATE_PAGE_RESTORE` | —                              | Stops the session, restores originals; `{ restored }`    |

For a new message, define the caller, receiver, payload schema, success/error response, and behavior when the content script is unavailable. Never send DOM nodes, API keys, or uncloneable values.

## Storage schema

| Key                                                                        | Store   | Type / purpose                                                                                                                                       |
| -------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`, `modelProvider`, `fromLang`, `toLang`                             | local   | Durable defaults.                                                                                                                                    |
| `sessionModel`, `sessionModelProvider`, `sessionFromLang`, `sessionToLang` | session | Temporary popup overrides.                                                                                                                           |
| `favoriteModels`                                                           | local   | Unique `provider::model` keys.                                                                                                                       |
| `providers`                                                                | local   | Named `{ id, name, apiType, baseUrl, apiKey, enabled, manualModels, enabledModels? }[]` profiles; absent `enabledModels` = all discovered models.    |
| `systemPrompt`                                                             | local   | Reusable translation prompt; supports `{{sourceLanguage}}` and `{{targetLanguage}}`.                                                                 |
| `instructions`                                                             | local   | `{ id, name, text, enabled }[]`.                                                                                                                     |
| `translationDisplayMode`                                                   | local   | `badge` or `replace`.                                                                                                                                |
| `enableSelection`                                                          | local   | `false` disables selection UI; missing means enabled.                                                                                                |
| `rememberKey`                                                              | local   | Legacy boolean kept for compatibility; written by `SAVE_SETTINGS`/`SAVE_DEFAULT_SETTINGS`.                                                           |
| `genericProviderMigrationVersion`                                          | local   | Provider-profile migration marker (currently `1`).                                                                                                   |
| `translationHistory`                                                       | local   | Newest first, maximum 50 entries.                                                                                                                    |
| `providerModelCatalog`                                                     | session | Per-provider model list/error cache, 10-minute TTL.                                                                                                  |
| `translation_v3_*`                                                         | session | Translation-only single-result `{ text, at }` cache, 30-minute TTL. The version prevents reuse of results created before the strict output contract. |

When adding a persistent key: add the default to `DEFAULTS` (`src/shared/config.js`), document it here, choose the correct writer (`saveSessionSettings` or the `DEFAULT_SETTINGS_WRITABLE_KEYS` allow-list in `src/storage/settings.js`), and add an idempotent migration in `src/storage/migrations.js` if existing data must change. Do not expose secrets through unnecessary message responses or DOM. Existing Gemini/Custom/Groq/OpenRouter records are migrated best-effort into compatible provider profiles without deleting the original keys.

## Provider adapter contract

### Single translation

Minimum input:

```js
{
  (provider, model, fromLang, toLang, systemPrompt, styleInstruction, text);
}
```

Return a parsed translation `string` only after the response passes the strict JSON contract below. Background sanitizes that parsed value as a final defense.

The provider request uses a fixed translation-only system policy. Source text, custom prompt, and reusable preferences are serialized inside a JSON user-data envelope and must never be interpolated into the provider's system instruction. Questions and commands in those fields are content to translate, not actions to perform.

The provider must return exactly `{ "translation": "translated text" }` as JSON, optionally inside a JSON code fence. Complete reasoning blocks at the very start (`<think>`, `<thinking>`, `<thought>`, `<reasoning>`, as Gemma 4 emits on the Gemini API) are removed before parsing and never searched for JSON; unterminated reasoning fails. Plain text, answer fields, reasoning fields, extra keys, empty translations, and other malformed output fail closed and trigger the normal provider fallback path. If the source contains question punctuation, the parsed translation must also preserve question form; an answer-shaped statement is rejected.

### Batch page translation

Input `segments` is `{ id: string, text: string }[]`. Return:

```js
{
  detected_source_language: 'optional language code',
  translations: [{ id: 't0', text: 'translated text' }]
}
```

Keep segment IDs unchanged. Do not assume provider output is complete or ordered; content script applies by ID and skips items without a matching node.

Batch requests use the same translation-only policy and untrusted JSON-data boundary. The envelope is strict: prose, extra top-level keys, or a non-array `translations` fail closed. Page batches (`TRANSLATE_PAGE`) parse entries leniently (`parsePartialBatchTranslationResponse`): unknown, duplicate, empty, or answer-shaped entries are dropped one by one, and their IDs are reported as missing (answer-shaped ones also in `rejectedIds`). The service re-asks once for skipped IDs (not rejected ones), then returns the rest in `failedIds`; the page keeps that original text. The strict all-or-nothing parser (`parseBatchTranslationResponse`) remains for callers that need it.

Each segment is cached by the same key as single translations (`translation_v3_*`), so repeated text on a page or across pages is sent once.

### Rate limits

Every provider request runs through `src/background/rate-limiter.js`:

- at most `LIMITS.PROVIDER_MAX_CONCURRENCY` requests per provider profile at once;
- a 429 or 503 response blocks that provider for the server's hint (`Retry-After`, `x-ratelimit-reset-*`, or `anthropic-ratelimit-*-reset`) or an exponential backoff, then retries up to `LIMITS.RATE_LIMIT_MAX_RETRIES` times;
- a wait longer than `LIMITS.RATE_LIMIT_MAX_WAIT_MS` (kept under the MV3 worker idle limit) is not slept in the worker: the request fails with a 429 `RateLimitedError` and fallback tries the next model.

If every model is rate limited, `TRANSLATE_PAGE` still answers `ok: true` with the untranslated IDs in `failedIds` and `retryAfterMs`; the content script pauses for that long and retries without counting it as a failed attempt. A wait over 60 s, or more than 5 rate-limited batches in a row, stops the retries and shows a "quota used up" error instead. A text node whose text keeps changing (clock, counter) is sent at most 4 times per session.

### Adding a provider or interface

1. Keep the provider profile contract in `src/storage/normalize.js` and add a migration if its shape changes.
2. Add an adapter in `src/providers/<name>.js` exporting `headers(apiKey)` and `completeChat(input)`, register it in `src/providers/index.js`, and add the API type to `API_TYPES` in `src/shared/config.js`.
3. Readiness, discovery, selection, and fallback already work through `src/background/`; extend only if the interface needs it.
4. Extend Options UI, favorite/model presentation, and error surfaces.
5. Add only the precise host permission required and recheck privacy documentation.

## Error contract

Background catches exceptions and returns an `error` string; UI/content show it through status/toast. Translation-only contract failures are errors, not displayable provider output. Adapter errors should include provider and HTTP status, with at most 300 response-body characters. Never include headers, full request bodies, keys, or prompts containing user text in errors or logs.

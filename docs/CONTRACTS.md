# Runtime Contracts: Messages, Storage, and Providers

This describes the current contract, not a proposal. Update it in the same change that adds a message, storage key, or provider capability.

## Runtime message API

### Messages sent to background

| Type | Main payload | Successful response | Callers |
| --- | --- | --- | --- |
| `GET_SETTINGS` | — | `{ settings }` | popup, options |
| `SAVE_SETTINGS` | session patch | — | popup, options |
| `SAVE_DEFAULT_SETTINGS` | persistent default patch, including `systemPrompt` | — | popup, options |
| `GET_PROVIDERS` | — | `{ providers }` | popup, options |
| `SAVE_PROVIDER` | provider profile | `{ provider }` | options |
| `REMOVE_PROVIDER` | `{ id }` | — | options |
| `GET_AVAILABLE_MODELS` | optional force flag | `{ models, errors, providers, favoriteModels }` | popup, options |
| `REFRESH_PROVIDER_MODELS` | optional `{ providerId }` | refreshed model catalog | popup, options |
| `TOGGLE_FAVORITE_MODEL` | model/provider to toggle | `{ favoriteModels, isFavorite }` | popup, options |
| `ADD_INSTRUCTION` / `UPDATE_INSTRUCTION` / `REMOVE_INSTRUCTION` / `TOGGLE_INSTRUCTION` | instruction data or `id` | — | popup, options |
| `GET_INSTRUCTIONS` | — | `{ instructions }` | popup, options |
| `TRANSLATE_TEXT` | text plus optional model/languages/cache flag | `{ translation }` | popup, content |
| `TRANSLATE_SELECTION_IN_TAB` | translation options + `tabId` | `{ translation }` after page insertion | popup |
| `TRANSLATE_PAGE_IN_TAB` | translation options + `tabId` | `{ translatedCount, segmentCount }` after page apply | popup |
| `TRANSLATE_PAGE` | `{ segments, fromLang, toLang, model, modelProvider }` | batch translation result | internal/advanced callers |
| `GET_HISTORY` / `CLEAR_HISTORY` | — | `{ history }` or — | popup |

Every response is wrapped in top-level `ok`. The service worker owns tab-scoped translation jobs so they can finish after a popup loses focus or closes.

### Messages sent to content script

| Type | Payload | Response / effect |
| --- | --- | --- |
| `GET_SELECTION` | — | Sanitized `{ text }` |
| `INSERT_TRANSLATION` | `{ translation }` | Inserts using current display mode |
| `SET_SELECTION_ENABLED` | `{ enabled }` | Enables/disables floating selection UI |
| `SET_DISPLAY_MODE` | `{ mode: 'badge' | 'replace' }` | Updates in-memory mode |
| `SHOW_TOAST` | message/type/persistent | Displays a notification |
| `TRANSLATE_PAGE_EXTRACT` | — | Returns `{ segments }` and stores tab node map |
| `TRANSLATE_PAGE_APPLY` | `{ translations }` | Applies translations by segment ID |

For a new message, define the caller, receiver, payload schema, success/error response, and behavior when the content script is unavailable. Never send DOM nodes, API keys, or uncloneable values.

## Storage schema

| Key | Store | Type / purpose |
| --- | --- | --- |
| `model`, `modelProvider`, `fromLang`, `toLang` | local | Durable defaults. |
| `sessionModel`, `sessionModelProvider`, `sessionFromLang`, `sessionToLang` | session | Temporary popup overrides. |
| `favoriteModels` | local | Unique `provider::model` keys. |
| `providers` | local | Named `{ id, name, apiType, baseUrl, apiKey, enabled, manualModels }[]` profiles. |
| `systemPrompt` | local | Reusable translation prompt; supports `{{sourceLanguage}}` and `{{targetLanguage}}`. |
| `instructions` | local | `{ id, name, text, enabled }[]`. |
| `translationDisplayMode` | local | `badge` or `replace`. |
| `enableSelection` | local | `false` disables selection UI; missing means enabled. |
| `translationHistory` | local | Newest first, maximum 50 entries. |
| `providerModelCatalog` | session | Per-provider model list/error cache, 10-minute TTL. |
| `translation_v3_*` | session | Translation-only single-result `{ text, at }` cache, 30-minute TTL. The version prevents reuse of results created before the strict output contract. |

When adding a persistent key: add the default to `DEFAULTS`, read it in `loadSettings`, include it in `initializeStorage`, choose the correct writer (`saveSessionSettings` or `saveDefaultSettings`), and add a migration if needed. Do not expose secrets through unnecessary message responses or DOM. Existing Gemini/Custom/Groq/OpenRouter records are migrated best-effort into compatible provider profiles without deleting the original keys.

## Provider adapter contract

### Single translation

Minimum input:

```js
{ provider, model, fromLang, toLang, systemPrompt, styleInstruction, text }
```

Return a parsed translation `string` only after the response passes the strict JSON contract below. Background sanitizes that parsed value as a final defense.

The provider request uses a fixed translation-only system policy. Source text, custom prompt, and reusable preferences are serialized inside a JSON user-data envelope and must never be interpolated into the provider's system instruction. Questions and commands in those fields are content to translate, not actions to perform.

The provider must return exactly `{ "translation": "translated text" }` as JSON, optionally inside a JSON code fence. Plain text, answer fields, reasoning fields, extra keys, empty translations, and other malformed output fail closed and trigger the normal provider fallback path. If the source contains question punctuation, the parsed translation must also preserve question form; an answer-shaped statement is rejected.

### Batch page translation

Input `segments` is `{ id: string, text: string }[]`. Return:

```js
{
  detected_source_language: 'optional language code',
  translations: [{ id: 't0', text: 'translated text' }]
}
```

Keep segment IDs unchanged. Do not assume provider output is complete or ordered; content script applies by ID and skips items without a matching node.

Batch requests use the same translation-only policy and untrusted JSON-data boundary. The adapter rejects extra output keys, malformed entries, duplicate IDs, missing IDs, invented IDs, or loss of question form before any page text is applied.

### Adding a provider or interface

1. Keep the provider profile contract in `storage.js` and add a migration if its shape changes.
2. Add or adjust model listing, single translation, and batch translation functions in `api.js`; normalize to the contracts above.
3. Wire readiness, discovery, selection, timeouts, and fallback in `background.js`.
4. Extend Options UI, favorite/model presentation, and error surfaces.
5. Add only the precise host permission required and recheck privacy documentation.

## Error contract

Background catches exceptions and returns an `error` string; UI/content show it through status/toast. Translation-only contract failures are errors, not displayable provider output. Adapter errors should include provider and HTTP status, with at most 300 response-body characters. Never include headers, full request bodies, keys, or prompts containing user text in errors or logs.

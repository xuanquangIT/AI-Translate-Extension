# LingoFlux Architecture

## Runtime topology

```text
Popup / Options ──chrome.runtime messages──> Background service worker
       │                                             │
       │ chrome.tabs messages                        ├─ chrome.storage.local/session
       ▼                                             ├─ OpenAI-compatible APIs
Content script <─────────────────────────────────────┴─ Anthropic-compatible APIs
       │
       └─ Web-page DOM: selection, badge/replace, page segments
```

The extension uses Manifest V3. The background service worker is an ES module; popup, options, and content script are regular browser JavaScript.

## Lifecycle

1. `onInstalled` calls `initializeStorage()` and creates the context menu.
2. `onStartup` recreates the context menu because an MV3 service worker can stop and restart.
3. The content script runs at `document_idle` on all URLs. `window.__lingoFluxLoaded` makes reinjection from the context-menu path safe.
4. Popup/options call `GET_SETTINGS`; background merges local defaults with session overrides.

## Selected-text translation flow

1. The user selects text, presses `T`, uses the floating button, context menu, or popup button.
2. The content script obtains a sanitized selection without extension UI and sends `TRANSLATE_TEXT`; the context-menu path also requests the selection from content script.
3. Background normalizes text, resolves a model, combines instructions, and checks the versioned session cache.
4. The provider adapter keeps a fixed translation-only system policy and serializes source text plus custom preferences as untrusted JSON data. Questions and commands remain content to translate.
5. The provider must return strict translation JSON. Malformed, conversational, or extra-key output fails closed; if the primary model fails, background tries favorites before remaining models.
6. Background sanitizes the parsed translation, caches it, records a truncated history item, and returns the translation.
7. Content script inserts a badge or replaces the selection. Replace mode stores the original HTML so the close button can restore it.

## Whole-page translation flow

1. Popup asks background to start `TRANSLATE_PAGE_IN_TAB`, then may safely close.
2. Background asks content script to TreeWalk text nodes, excluding tag/input/code/hidden/notranslate and LingoFlux DOM. Content assigns `tN` IDs and stores a node `Map` on `window`.
3. Background sends bounded 20-segment batches with concurrency two through the same translation-only data boundary.
4. The adapter requires one valid translation for every original segment ID and rejects missing, duplicate, invented, malformed, or extra-key output.
5. Background applies the combined result through `TRANSLATE_PAGE_APPLY`; content script replaces text nodes with `.lingoflux-page-translated` spans and keeps source text in `title`/dataset.

The node map belongs to the content-script context. A `Node` cannot cross a message boundary, and the map disappears after a refresh; treat extraction and apply as a transaction for one tab/document.

## Providers

| Provider | Configuration | Model discovery | Single/batch endpoint |
| --- | --- | --- | --- |
| Any named OpenAI-compatible profile | Base URL + Bearer key | `{base}/models` | `{base}/chat/completions` |
| Any named Anthropic-compatible profile | Base URL + `x-api-key` | `{base}/models` | `{base}/messages` |

`api.js` returns either a single translation string or a batch JSON object `{ translations: [{ id, text }] }`; background is independent of provider-specific HTTP details.

## Ownership and dependency direction

```text
config.js  ←  storage.js
      ↑          ↑
      └── api.js │
              ↑  │
       background.js
          ↑           ↑
    popup/options   content.js
```

- `config.js`: API compatibility types, defaults, languages.
- `storage.js`: schema and migration; no network.
- `api.js`: provider HTTP and normalization; no Chrome storage or DOM.
- `background.js`: orchestration and public message API.
- UI: render state, send intent, handle results.

## MV3 constraints

- A service worker is not durable: important state must be stored or reconstructable.
- Asynchronous message handlers must return `true`.
- A content script may not exist on special tabs; callers must catch messaging errors.
- The `scripting` permission injects content script for the context-menu path.

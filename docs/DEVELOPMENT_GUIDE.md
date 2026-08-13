# LingoFlux Development Guide

This is the starting point for contributors implementing LingoFlux features. The goal is to change the correct execution context, avoid exposing API keys, and preserve the existing translation flows.

## Quick start

```powershell
npm install
npm run build
```

Load `src/` through **Load unpacked** in `chrome://extensions` or `edge://extensions`. `dist/` is a generated release output, never the source of truth.

`npm test` is a credential-free core regression suite. `npm run test:live` is the optional Gemini network smoke test; it requires `GEMINI_API_KEY` and authorization to consume that quota.

## Project map

| Area | Ownership | Change guidance |
| --- | --- | --- |
| `src/manifest.json` | MV3 permissions and entry points | Justify every new permission/host and verify extension reload. |
| `src/scripts/background.js` | Service worker, message router, model fallback, cache, history | All translation requests and cross-context storage mutations pass here. |
| `src/scripts/content.js` | Web-page DOM, selection UI, badge/replace, page segments | Do not call providers directly from here. |
| `src/scripts/lib/api.js` | OpenAI/Anthropic-compatible adapters, timeout, parsing, model discovery | Preserve the adapter output contracts. |
| `src/scripts/lib/storage.js` | Storage schema and migrations | Update defaults, loader, initializer, and writer together. |
| `src/pages/popup/` | Fast translation flow, session preferences, history | Keep HTML, JavaScript, and CSS in sync. |
| `src/pages/options/` | Persistent provider/default/instruction configuration | Save through background; do not surface secrets unnecessarily. |
| `src/_locales/` | English manifest/store strings | Update the English catalog for new manifest strings. |
| `scripts/` | Build, syntax-check, and smoke-test helpers | Do not mix extension runtime logic into Node scripts. |

Read [architecture](ARCHITECTURE.md), [contracts](CONTRACTS.md), [the feature playbook](FEATURE_PLAYBOOK.md), and [testing guidance](TESTING.md) before changing the matching area.

## Invariants

1. Popup/options, the service worker, and a page are separate contexts. Use messaging or storage; do not assume shared globals.
2. The content script owns DOM/UI only. Provider calls, secret lookup, fallback, cache, and history belong in `background.js` and `lib`.
3. Every new message needs an explicit payload plus `{ ok: true, ... }` success and `{ ok: false, error }` failure responses. Add both sender and handler.
4. Keep `modelProvider` paired with `model`. Model IDs can overlap; favorite keys are `provider::model`.
5. Do not put API keys in history, cache keys, UI text, consoles, telemetry, or build artifacts. Storage is restricted to trusted contexts during initialization.
6. Make storage migrations idempotent. Do not remove a legacy key before the new value is safely copied.
7. Do not translate script/style/form/code/`notranslate` content, extension DOM, or already translated text. Preserve Replace-mode restoration.
8. Do not widen `host_permissions` if the feature works with existing permission scope.

## Standard feature workflow

1. Read the relevant contract and owner files.
2. Write a short scope: user flow, responsible context, message/storage/API changes, and failure cases.
3. Implement in data-flow order: config/storage, background contract, then UI/content DOM.
4. Run static validation and `npm run build`; reload the extension to check manifest and service-worker errors.
5. Test success, failure, and reload manually. For DOM features, test a regular page, dynamic page, text selection, and no selection.
6. Update the contract docs whenever public behavior, storage, or messaging changes.

## Important boundaries

- Page translation collects at most 200 text nodes, each 3–2000 characters. It replaces nodes with `span` elements and has no whole-page restore feature.
- Single-translation cache uses `chrome.storage.session` with a 30-minute TTL. Local history stores at most 50 entries and truncates each source/translation to 200 characters.
- Model discovery makes live provider requests; no model list is hard-coded. Catalogs are cached for ten minutes and manual model IDs support endpoints without `/models`.
- `npm run build` deletes and recreates `dist/`. Never hand-edit that output.


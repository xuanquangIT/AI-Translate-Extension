# LingoFlux Architecture — Codebase Map

This is the **codebase map**: the one file every human and AI agent reads first. It lists modules, ownership,
entry points, layer rules, and commands. Keep it accurate: a change that adds, moves, or removes a module updates
this file in the same pull request.

Deeper references: [runtime contracts](CONTRACTS.md) (messages, storage, provider I/O), [feature playbook](FEATURE_PLAYBOOK.md),
[testing](TESTING.md), [git workflow](GIT_WORKFLOW.md), [agent workflow](AGENT_WORKFLOW.md), [decisions](adr/).

## Commands

| Command                                           | What it proves                                                      | Needs network/keys                  |
| ------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| `npm ci`                                          | Install dev tooling (Node >= 22)                                    | npm registry                        |
| `npm test`                                        | Unit + contract tests (`node:test`)                                 | No                                  |
| `npm run check:extension`                         | Manifest/HTML references, import graph, layer rules, version parity | No                                  |
| `npm run check:syntax`                            | Every `src/**/*.js` parses in the right mode (module vs classic)    | No                                  |
| `npm run lint` / `npm run format:check`           | ESLint and Prettier                                                 | No                                  |
| `npm run check:agents`                            | `.claude/` mirrors match `.agents/` sources                         | No                                  |
| `npm run verify`                                  | **All of the above + build. The definition of green.**              | No                                  |
| `npm run build` / `build:zip`                     | Copy `src/` to `dist/` / release ZIP                                | No                                  |
| `npm run test:live`                               | Optional real-provider smoke test                                   | **Yes — consumes quota; ask first** |
| `npm run local-mt:setup` / `:start` / `:shortcut` | Optional local GPU translation stack ([LOCAL_MT.md](LOCAL_MT.md))   | Setup downloads about 3.8 GB        |

There is no bundler. `src/` is the shipped extension: load it unpacked in `chrome://extensions` while developing.

## Runtime topology

```text
popup / options (ES modules) ──chrome.runtime──▶ background service worker (ES module)
          │                                         │  router → services → storage / translation → providers
          │ chrome.tabs (broadcast settings)        ├─ chrome.storage.local / session
          ▼                                         └─ OpenAI- / Anthropic-compatible HTTP APIs
content script (classic) ◀──chrome.tabs──────────────┘
          └─ page DOM: selection, floating button, badge/replace, page segments
```

## Source map

| Path                     | Layer       | Owns                                                                                                                                                                                                                                                                                                                     | Must not                                                                 |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `src/manifest.json`      | —           | MV3 entry points, permissions                                                                                                                                                                                                                                                                                            | Widen permissions without updating `PRIVACY.md` + manifest contract test |
| `src/shared/`            | shared      | Pure constants and helpers: `config.js` (API types, defaults, limits), `languages.js`, `messages.js` (message registry), `model-keys.js`, `text.js`                                                                                                                                                                      | Touch `chrome.*`, DOM, or network                                        |
| `src/providers/`         | providers   | HTTP adapters: `http.js` (timeouts, errors), `openai.js`, `anthropic.js`, `index.js` (registry, model discovery)                                                                                                                                                                                                         | Read storage or settings                                                 |
| `src/translation/`       | translation | Translation-only request policy (`prompt.js`), strict output parsing (`response.js`), one attempt per model (`translate.js`)                                                                                                                                                                                             | Cache, fall back, or read storage                                        |
| `src/storage/`           | storage     | Schema access: `settings.js`, `providers.js`, `favorites.js`, `instructions.js`, `history.js`, `migrations.js`, `normalize.js`; public API in `index.js`                                                                                                                                                                 | Make network calls                                                       |
| `src/background/`        | background  | Service worker: `index.js` (event wiring only), `router.js` (message → handler), `translation-service.js` (cache, history, fallback), `rate-limiter.js` (per-provider concurrency, 429 backoff), `model-catalog.js`, `model-resolution.js`, `translation-cache.js`, `tab-jobs.js`, `context-menu.js`, `storage-ready.js` | Touch page DOM                                                           |
| `src/content/content.js` | content     | Page DOM: selection snapshots, floating button, `T` shortcut, badge/replace, page extract/apply                                                                                                                                                                                                                          | Call providers or read credentials; use `import` (classic script)        |
| `src/pages/popup/`       | pages       | Quick translate, session choice, history                                                                                                                                                                                                                                                                                 | Write storage directly; import storage/providers                         |
| `src/pages/options/`     | pages       | Provider profiles and their model checklists (discovered models the user ticks), defaults, system prompt, preferences                                                                                                                                                                                                    | Same as popup                                                            |
| `src/pages/shared/`      | pages       | Page helpers: `runtime.js` (messaging), `dom.js`, `model-picker.js`, `model-checklist.js` (pure checklist filter/selection logic)                                                                                                                                                                                        | —                                                                        |
| `src/_locales/en/`       | —           | Manifest/store strings                                                                                                                                                                                                                                                                                                   | —                                                                        |
| `scripts/`               | tooling     | Build, validation, live smoke test, agent-config sync; `local-mt/` (optional local GPU translation bridge, see `docs/LOCAL_MT.md`)                                                                                                                                                                                       | Contain extension runtime logic                                          |
| `tests/unit/`            | tests       | Behavior of pure and chrome-mocked modules                                                                                                                                                                                                                                                                               | Hit the network                                                          |
| `tests/contract/`        | tests       | Registry ↔ handlers ↔ docs ↔ manifest consistency                                                                                                                                                                                                                                                                        | —                                                                        |
| `tests/helpers/`         | tests       | `chrome-mock.js`, `fetch-mock.js`                                                                                                                                                                                                                                                                                        | —                                                                        |
| `AGENTS.md`, `.agents/`  | agents      | Agent rules, skills (`.agents/skills/`), roles (`.agents/roles/`), Antigravity rule (`.agents/rules/`) — see `docs/AGENT_WORKFLOW.md`                                                                                                                                                                                    | Contain runtime logic                                                    |
| `.claude/`               | agents      | Generated Claude Code mirrors (`skills/`, `agents/`) + shared `settings.json`                                                                                                                                                                                                                                            | Be edited by hand (except `settings.json`)                               |

Layer imports are enforced by `scripts/validate-extension.mjs`:

```text
shared ◀── providers ◀── translation ◀── background ──▶ storage ──▶ shared
pages ──▶ shared (+ pages/shared)        content: no imports (classic script)
```

## Entry points and flows

**Lifecycle.** `background/index.js` registers listeners synchronously. `storage-ready.js` runs `initializeStorage()`
(idempotent migrations) once per worker start; every handler awaits it. `onInstalled`/`onStartup` rebuild the context menu.

**Selected text.** Content (`T` key / floating button) or popup (`TRANSLATE_SELECTION_IN_TAB`) or context menu →
`translation-service.translateSingleText` → session cache (`translation_v3_*`) → `model-resolution.withFallback`
(primary → favorites → remaining models) → `translation/translate.js` → provider adapter → strict JSON parse →
sanitize → cache + history → content `INSERT_TRANSLATION` (badge or replace with restore).

**Whole page.** Popup `TRANSLATE_PAGE_IN_TAB` → `tab-jobs` sends content `TRANSLATE_PAGE_START` and returns at once.
The content script then runs a live session for the tab:

- An `IntersectionObserver` (600 px prefetch margin) queues text only when its element is on or near the screen;
  hidden elements never intersect, so there is no per-node style scan (`display: contents` parents are observed through their nearest boxed ancestor). Skipped: code/forms/`svg`/editable/`notranslate`/
  LingoFlux DOM, text without letters, URLs, and text over 2000 chars.
- The queue is packed into batches of ≤ 2500 chars / 40 unique strings (identical text is sent once), at most 2 in
  flight, each sent to the background as `TRANSLATE_PAGE`.
- Background `translatePage` serves cached segments, sends the misses through `withFallback` and the per-provider
  rate limiter, parses entries leniently, retries skipped IDs once, and returns `{ translations, failedIds }` (plus
  `retryAfterMs` when every model is rate limited; the content script then pauses and retries).
- Translations replace `Text.nodeValue` in place (whitespace kept), so framework-owned nodes stay intact. A
  `MutationObserver` re-applies cached translations when the page re-renders original text and picks up new or changed text
  (SPA navigation, infinite scroll). A source → translation map in the tab avoids repeat requests.
- `RESTORE_PAGE_IN_TAB` → content `TRANSLATE_PAGE_RESTORE` stops the session and puts the original text back.

## Invariants (break one = bug)

1. Contexts share nothing in memory. Communicate through registered messages (`src/shared/messages.js`) or storage.
2. Provider calls, credentials, cache, fallback, and history live in the service worker only.
3. Untrusted text (page text, custom prompt, preferences) goes in the JSON user envelope, never the system policy.
   Provider output that is not the exact contract fails closed.
4. Provider output reaches the DOM only through `textContent`.
5. A model is always `model` + `modelProvider`; favorites/cache use `provider::model`.
6. API keys never appear in logs, errors, cache keys, history, UI text (beyond a masked suffix), or build artifacts.
7. Migrations are idempotent and copy before deleting legacy keys.
8. Every message response is `{ ok: true, ... }` or `{ ok: false, error }`.
9. MV3 workers die at any time: state that matters is in storage or reconstructable.

## Known limits

- Page translation keeps its session in the tab: a reload or navigation to another document ends it.
- Page text inside closed shadow roots and cross-origin iframes is not translated.
- UI strings are hard-coded English; `_locales` covers manifest strings only.
- `host_permissions: <all_urls>` is required for content script and arbitrary provider endpoints.
- `GET_PROVIDERS` returns full profiles (including keys) to extension pages because Options edits them.

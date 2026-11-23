# Changelog

All notable changes to LingoFlux Translator will be documented in this file.

## [Unreleased]

### Added
- Providers can limit which discovered models appear in model pickers, the popup, and fallback (`enabledModels`). New providers start with no discovered models selected (manual models always appear); providers saved before this change keep showing every model until a selection is saved.
- Options: after you save a provider, its available models are checked and shown as a checklist under that provider (search box, "N of M selected" counter, Select all shown / Clear, Save selection). Nothing is ticked for a new provider, and the default-model list shows only ticked models.
- Optional local GPU translation: `npm run local-mt:setup` and `npm run local-mt:start` run Google Gemma 4 E2B on llama.cpp behind an OpenAI-compatible bridge (`http://127.0.0.1:37813/v1`) that translates page segments in parallel. See `docs/LOCAL_MT.md`.
- Local GPU translation can run from the Windows system tray: `npm run local-mt:shortcut` adds a desktop shortcut that starts the server in the background with Start, Stop, Restart, Copy base URL, and Open log in the tray menu.
- Local GPU translation can load Index-Translate 2B next to or instead of Gemma 4 E2B: pick it in the tray's Model menu or with `--models gemma|index|all`; the bridge lists every loaded model and routes each request by its model id.

### Fixed
- Models that write their reasoning inline before the answer (Gemma 4 on the Gemini API `<thought>…</thought>`, `<think>…</think>`) now translate instead of failing the JSON check.
- Translate page no longer freezes: it now translates what is on screen first and returns at once instead of waiting for the whole page.
- Translated page text no longer reverts to the original while scrolling or when the site re-renders; translations are applied in place and re-applied after re-renders.
- One bad or skipped entry in a provider reply no longer fails a whole page batch; only that text stays untranslated.
- Removing the currently selected provider now re-selects an available model and clears the stale session choice; previously the selection was checked after deletion and could be left pointing at the removed provider.

### Changed
- Reorganized the source into layered modules (`shared`, `providers`, `translation`, `storage`, `background`, `content`, `pages`) with import rules enforced by `npm run check:extension`. User-facing behavior is unchanged.
- Popup and Options are now ES modules that share messaging, DOM, and model-picker helpers, and save preferences only through the background service worker.
- The live smoke test (`npm run test:live`) now uses the real provider adapters and any OpenAI- or Anthropic-compatible endpoint configured with `LIVE_*` variables.
- Raised the development baseline to Node.js 22; CI verifies on Node 22 and 24.

### Added
- Translate page covers the whole page as you scroll, including text added later by the site, and a **Show original page** button restores the original text.
- Fewer provider requests for page translation: batches packed by size, identical text sent once, and per-text caching.
- Rate-limit handling for free-tier providers: at most two requests per provider at once, automatic waiting and retry on HTTP 429/503 using the provider's `Retry-After` or reset headers, and a pause-and-resume on the page instead of an error.
- Unit and contract test suites (`node:test`) covering sanitizers, prompt isolation, strict parsers, adapters, storage migrations, the router envelope, cache, fallback, and message/manifest/doc agreement.
- ESLint and Prettier, `npm run verify` as the single definition of green, CodeQL, dependency review, Conventional Commit PR titles, path-based labels, and grouped Dependabot updates.
- AI-agent support: `AGENTS.md`, canonical skills and roles in `.agents/` with generated Claude Code mirrors, and an Orchestrator → Worker workflow (`docs/AGENT_WORKFLOW.md`).
- Git workflow, architecture decision records, and an importable `main` branch ruleset.

## [1.3.0] - 2026-08-13

### Fixed
- Hardened popup, selection, context-menu, keyboard, and page translation against prompt injection by isolating source/preferences as untrusted JSON data under a fixed translation-only policy.
- Reject provider output that does not match the strict single or batch translation schema, and invalidate pre-hardening session cache keys.

### Added
- Added contributor, support, security, conduct, ownership, issue, and pull-request guidance for an open-source workflow.
- Added GitHub Actions for credential-free CI and reproducible tagged release archives with SHA-256 checksums.
- Added a cross-platform syntax-check command for every extension JavaScript entry point.

### Changed
- Reworked the public README around verifiable features, build instructions, browser targets, privacy boundaries, and current store status.
- Replaced absolute privacy claims with a detailed description of local storage, provider transmission, permissions, retention, and user responsibilities.
- Standardized public documentation, metadata, and repository presentation in English.
- Added product screenshots and a direct GitHub Release installation path.
- Updated the ZIP build dependency to `archiver` 8 to remove known high-severity development dependency advisories.

## [1.2.0] - 2026-08-09

### Changed
- Replaced the fixed Gemini/Auto Custom split with unlimited named provider profiles for OpenAI-compatible and Anthropic-compatible APIs.
- Added manual model IDs for providers that do not expose `/models`, model catalog caching, provider-scoped refresh, and favorite-first fallback.
- Rebuilt popup and settings UX around provider management, translation defaults, system prompt, and reusable preferences.
- Moved selection and page translation orchestration to the background worker so jobs survive popup closure, tab focus changes, and incidental clicks.
- Added request timeouts, concurrent bounded page chunks, in-flight request deduplication, and stronger response/format cleanup.

### Testing
- Added safe local core regression checks through `npm test`.
- Moved the credential-consuming Gemini smoke test to `npm run test:live`.

## [1.0.0] - 2024-12-08

### Added
- Initial release
- Full page translation support
- Selection translation with floating button
- Keyboard shortcut (T) for quick translation
- Multi-provider support: Gemini, Groq, OpenRouter
- Smart model fallback on rate limits
- Custom translation instructions
- Per-site instruction memory
- 20+ language support
- Dark mode UI
- Chrome, Edge, and Chromium browser support

### Providers Supported
- **Gemini**: gemini-2.5-flash, gemini-2.5-flash-lite, gemini-1.5-flash, gemini-2.5-pro
- **Groq**: llama-3.1-8b-instant, llama-3.3-70b-versatile, qwen3-32b
- **OpenRouter**: qwen3-235b, gpt-oss-20b, mistral-small-3.1, and premium models

### Technical
- Manifest V3 compliant
- ES Module architecture
- Modular codebase (config, api, storage)
- Localization support (_locales)
- Professional project structure

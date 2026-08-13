# Changelog

All notable changes to LingoFlux Translator will be documented in this file.

## [Unreleased]

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

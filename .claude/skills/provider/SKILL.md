---
name: provider
description: Add or change a LingoFlux provider adapter or API compatibility type (OpenAI-compatible, Anthropic-compatible, or a new interface), including model discovery, headers, request body, and error handling. Use when touching src/providers/ or API_TYPES.
---

<!-- GENERATED from .agents/skills/provider/SKILL.md by scripts/sync-agent-config.mjs. Edit the source, then run npm run sync:agents. -->

# Provider adapter

Follow "Recipe: provider interface" in `docs/FEATURE_PLAYBOOK.md` and the "Provider adapter contract" in
`docs/CONTRACTS.md`.

## Steps

1. New interface: create `src/providers/<name>.js` exporting `headers(apiKey)` and
   `completeChat({ provider, model, system, user, maxTokens, timeoutMs, label })` that returns raw text. Use
   `fetchJson` / `buildEndpoint` from `src/providers/http.js` (timeouts, truncated error bodies, no key leaks).
2. Register it in `ADAPTERS` (`src/providers/index.js`) and `API_TYPES` / `API_TYPE_LABELS`
   (`src/shared/config.js`); add the option to the compatibility `<select>` in `src/pages/options/options.html`.
3. Model discovery: extend `listProviderModels` only if the interface has a models endpoint; otherwise users rely on
   manual model IDs.
4. Do not change prompts or the output contract per provider. `system` = fixed policy, `user` = JSON envelope.
5. Tests in `tests/unit/providers.test.js` / `translate.test.js` with `tests/helpers/fetch-mock.js`: endpoint URL,
   headers, body shape, empty response, HTTP error that does not contain the key, answer-shaped output fails closed.
6. Docs: `docs/CONTRACTS.md` provider section, README provider list, `CHANGELOG.md`.
7. `npm run verify`. Do **not** run `npm run test:live` unless the user explicitly authorizes it.

## Never

- Log or return the API key, or include it in error messages or cache keys.
- Add a new `host_permissions` entry without updating `PRIVACY.md` and the manifest contract test.
- Add an SDK dependency; adapters use `fetch`.

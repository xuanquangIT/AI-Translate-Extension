# Feature Playbook

Recipes for the most common changes. Each recipe lists the files to touch **in data-flow order** and the tests that
prove it. Agent skills in `.agents/skills/` link here instead of repeating it.

## Choose the owner

| Need                               | Start in                                                        | Usually also change                                          |
| ---------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| Add a setting                      | `src/shared/config.js` (`DEFAULTS`), `src/storage/settings.js`  | router handler, popup/options UI, `docs/CONTRACTS.md`        |
| Add a runtime message              | `src/shared/messages.js`, `src/background/router.js`            | sender (page or content), `docs/CONTRACTS.md`                |
| Add a provider API interface       | `src/providers/<name>.js`, `src/providers/index.js`             | `API_TYPES`, options `<select>`, `docs/CONTRACTS.md`, tests  |
| Change prompt / output contract    | `src/translation/prompt.js`, `response.js`                      | bump `TRANSLATION_CACHE_PREFIX`, `tests/unit/prompt.test.js` |
| Change model choice / fallback     | `src/background/model-resolution.js`                            | `model-catalog.js`, favorites UI                             |
| Change cache / history             | `src/background/translation-cache.js`, `src/storage/history.js` | `LIMITS` in `config.js`                                      |
| Change selection / badge / replace | `src/content/content.js`                                        | manual DOM matrix in `docs/TESTING.md`                       |
| Change page translation            | `src/content/content.js` + `src/background/tab-jobs.js`         | `LIMITS`, batch adapter                                      |
| Add a popup action                 | `src/pages/popup/popup.html`, `popup.js`                        | router message, `popup.css`                                  |
| Add a settings UI                  | `src/pages/options/options.html`, `options.js`                  | router/storage, `options.css`                                |
| Change storage shape               | `src/storage/migrations.js`                                     | `normalize.js`, `tests/unit/storage.test.js`                 |
| Icon / store metadata              | `src/manifest.json`, `src/assets/`, `src/_locales/`             | README                                                       |

## Recipe: setting

1. Add the default to `DEFAULTS`. Document the key in `docs/CONTRACTS.md` (the contract test enforces it).
2. Decide session override vs durable default. Durable: add it to `DEFAULT_SETTINGS_WRITABLE_KEYS`.
3. Load/save in the page through `request(BACKGROUND_MESSAGES.SAVE_DEFAULT_SETTINGS, …)`; never `chrome.storage` from a page.
4. If the content script needs it live, broadcast a content message (`src/pages/shared/runtime.js`).
5. Test: `tests/unit/storage.test.js` (empty storage and existing storage).

## Recipe: runtime message

1. Add `NAME: 'NAME'` to `BACKGROUND_MESSAGES` or `CONTENT_MESSAGES`.
2. Background: add a handler in `router.js` returning the success fields (the router builds the envelope).
   Content: add a `case 'NAME':` in `content.js` (literal string; classic script).
3. Add the sender. Document payload, response, and the "content script unavailable" behavior in `docs/CONTRACTS.md`.
4. Never send DOM nodes, API keys, or uncloneable values.
5. `npm test` (contract tests fail until steps 1–3 agree).

## Recipe: provider interface

1. `src/providers/<name>.js`: `headers(apiKey)` and `completeChat({ provider, model, system, user, maxTokens, timeoutMs, label })` returning raw text.
2. Register in `ADAPTERS` and `API_TYPES`; add the option to the Options compatibility `<select>`.
3. Keep `system` as the fixed policy and `user` as the JSON envelope; do not change the output contract per provider.
4. Tests in `tests/unit/translate.test.js`: endpoint, headers, body shape, empty response, HTTP error without key leak.
5. If a new host permission is unavoidable, update `PRIVACY.md`, README, and the manifest contract test.

## Recipe: DOM behavior

1. Define lifecycle: reinjection, SPA navigation, selection change, reload, cleanup.
2. Use `lingoflux-*` classes, a high z-index for overlays, and exclude them from selection/page extraction.
3. Render provider text with `textContent` (contract test enforces it).
4. Preserve Replace-mode restore. Do not touch inputs, `contenteditable`, code/pre, or hidden nodes without dedicated UX.
5. Run the manual DOM matrix in `docs/TESTING.md` and state the result in the PR.

## Definition of done

- [ ] `npm run verify` passes.
- [ ] New behavior has a unit or contract test; a bug fix has a regression test that failed before the fix.
- [ ] `docs/ARCHITECTURE.md` updated if modules moved; `docs/CONTRACTS.md` if messages/storage/provider I/O changed.
- [ ] `CHANGELOG.md` `[Unreleased]` entry for user-visible changes.
- [ ] No secrets or private page text in code, logs, fixtures, screenshots, or PR text.
- [ ] Manual browser checks run for UI/DOM/provider changes, or the PR states they were not run.

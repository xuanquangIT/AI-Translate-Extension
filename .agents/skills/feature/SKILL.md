---
name: feature
description: Add or change user-visible LingoFlux behavior (settings, popup/options UI, translation flow, page/selection DOM) in the correct layer with tests and docs. Use for any new feature or behavior change that is not a pure bug fix.
---

# Feature

## Steps

1. **Locate the owner.** Use the "Choose the owner" table in `docs/FEATURE_PLAYBOOK.md`, then the source map in
   `docs/ARCHITECTURE.md`. Read only those files. Do not grep the whole tree.
2. **Write down the contract change** (if any) before code: new message, storage key, default, permission, or prompt
   shape. If there is one, also follow the `contract-change` skill.
3. **Implement in data-flow order:** `shared` → `storage` / `providers` / `translation` → `background` (router,
   services) → `pages` / `content`. Keep each module inside its layer (`npm run check:extension` enforces imports).
4. **Test.** Add or extend a test in `tests/unit/` (behavior) or `tests/contract/` (cross-file agreement). Mock
   `chrome` with `tests/helpers/chrome-mock.js` and `fetch` with `tests/helpers/fetch-mock.js`. No network.
5. **Docs.** `docs/ARCHITECTURE.md` if modules changed; `docs/CONTRACTS.md` if contracts changed; one line under
   `## [Unreleased]` in `CHANGELOG.md` (`### Added` / `### Changed`).
6. **Verify.** `npm run lint:fix && npm run format`, then `npm run verify`.
7. **Manual check.** UI or DOM changes: list which rows of the manual matrix in `docs/TESTING.md` apply and whether
   you ran them (agents usually cannot load an unpacked extension — say "not run" rather than guessing).

## Pitfalls

- Pages must not call `chrome.storage` directly; go through `request(BACKGROUND_MESSAGES.…)` in
  `src/pages/shared/runtime.js`.
- The content script cannot import; new message strings are literals there and are checked by contract tests.
- Changing prompt or output shape requires bumping `TRANSLATION_CACHE_PREFIX` in `src/shared/config.js`.
- Popup/options UI text is English and set via `textContent`, never `innerHTML` with dynamic data.

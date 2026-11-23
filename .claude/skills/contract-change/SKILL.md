---
name: contract-change
description: Safely add, rename, or remove a LingoFlux runtime message type, storage key or default setting, manifest permission, or storage schema (with migration), keeping registry, router, content script, docs, and contract tests in agreement. Use whenever src/shared/messages.js, DEFAULTS, migrations, or manifest.json change.
---

<!-- GENERATED from .agents/skills/contract-change/SKILL.md by scripts/sync-agent-config.mjs. Edit the source, then run npm run sync:agents. -->

# Contract change

Contracts are enforced by `tests/contract/*.test.js`. Change every side in one commit.

## Message type

1. Add to `BACKGROUND_MESSAGES` or `CONTENT_MESSAGES` in `src/shared/messages.js`.
2. Background: handler in `src/background/router.js` returning success fields (router adds `{ ok: true }` and turns
   throws into `{ ok: false, error }`). Content: `case '<NAME>':` literal in `src/content/content.js`.
3. Sender in pages (`request(...)` from `src/pages/shared/runtime.js`) or background (`chrome.tabs.sendMessage`
   wrapped in try/catch for tabs without the content script).
4. Document payload, response, and failure behavior in `docs/CONTRACTS.md` → "Runtime message API".
5. Removing/renaming: remove every side; the contract test lists leftovers.

## Storage key / default setting

1. Add the default to `DEFAULTS` in `src/shared/config.js` and a row in `docs/CONTRACTS.md` → "Storage schema"
   (contract test enforces it).
2. Durable user-editable default: add to `DEFAULT_SETTINGS_WRITABLE_KEYS` (`src/storage/settings.js`). Session-only:
   add to `SESSION_KEY_MAP`.
3. Shape change of existing data: add an idempotent step in `src/storage/migrations.js` that **copies before it
   deletes**, bump its version constant, and test both fresh install and upgrade in `tests/unit/storage.test.js`.

## Manifest permission

1. Justify it in the PR. Update `PRIVACY.md`, README permissions section, and the exact-permission assertion in
   `tests/contract/manifest.test.js`.
2. Keep `package.json` and `manifest.json` versions equal (`npm run check:extension`).

## Done when

`npm test` passes (contract tests prove agreement), `npm run verify` passes, and `CHANGELOG.md` notes any
user-visible effect.

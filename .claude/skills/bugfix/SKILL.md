---
name: bugfix
description: Fix a LingoFlux defect by reproducing it with a failing test first, fixing at the narrowest responsible layer, and proving the regression test now passes. Use for bug reports, failing behavior, or wrong output.
---

<!-- GENERATED from .agents/skills/bugfix/SKILL.md by scripts/sync-agent-config.mjs. Edit the source, then run npm run sync:agents. -->

# Bug fix

## Steps

1. **Restate the bug** as observed vs expected behavior, in one sentence each.
2. **Localize.** Use the flows and "Failure triage" table in `docs/TESTING.md` and the source map in
   `docs/ARCHITECTURE.md` to pick the suspect module. Read it and its direct callers only.
3. **Reproduce in a test first.** Add a test in `tests/unit/` (or `tests/contract/`) that fails for the reported
   reason. Run just that file: `node --test tests/unit/<file>.test.js`. Confirm it fails for the right reason.
   If it cannot be reproduced offline (pure DOM/browser behavior), say so and describe the manual repro instead.
4. **Fix at the narrowest layer** that owns the wrong behavior. No drive-by refactors; note them under `NEXT`.
5. **Prove it.** The new test passes; `npm run verify` passes.
6. **Record.** One line under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md` describing the user-visible effect.

## Report extras

State the root cause in one line (file:line) and why the old code produced the bug. If the cause is unknown after
reasonable investigation, report `blocked` with your top hypotheses ranked by evidence rather than guessing a fix.

## Common causes in this codebase

- Selection checked after a mutation (read state before writing).
- Session vs local settings confusion (`SESSION_KEY_MAP`, `loadSettingsWithSession`).
- Tab messaging to a page without the content script (`ensureContentScript`, restricted URLs).
- Stale cache after a prompt change (bump `TRANSLATION_CACHE_PREFIX`).
- MV3 worker restart losing in-memory state (must be in storage or reconstructable).

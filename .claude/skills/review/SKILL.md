---
name: review
description: Review a LingoFlux diff, branch, or pull request for correctness and against the project invariants (layers, message envelope, prompt security, secrets, permissions, tests, docs). Use when asked to review changes or before opening a PR.
---

<!-- GENERATED from .agents/skills/review/SKILL.md by scripts/sync-agent-config.mjs. Edit the source, then run npm run sync:agents. -->

# Review

Read-only. Compare the change with `main` (`git diff main...HEAD` or the PR diff) and read only touched files plus
their direct callers.

## Checklist (from `docs/ARCHITECTURE.md` → Invariants)

1. **Correctness** — does the code do what the PR/brief claims? Edge cases: empty text, missing provider, worker
   restart, tab without content script, restricted URLs, concurrent requests.
2. **Layers** — imports respect the layer graph; pages do not touch `chrome.storage`; content script has no imports.
3. **Contracts** — new/changed messages, storage keys, defaults, permissions appear in registry, handler, content
   mirror, `docs/CONTRACTS.md`, and tests.
4. **Envelope** — every handler result goes through the router; no raw throws to pages.
5. **Prompt security** — untrusted text only in the JSON user envelope; strict parsing fails closed; prompt/output
   changes bump `TRANSLATION_CACHE_PREFIX`.
6. **DOM safety** — provider text only through `textContent`; Replace-mode restore still works.
7. **Secrets** — no API keys in logs, errors, cache keys, history, fixtures, or test names; no `.env` content.
8. **Migrations** — idempotent, copy before delete, tested for fresh install and upgrade.
9. **Tests** — behavior change has a test; bug fix has a regression test; no network.
10. **Docs** — `ARCHITECTURE.md` / `CONTRACTS.md` / `CHANGELOG.md` updated where required.

## Output

One line per finding, most severe first:

```text
path:line — <severity: blocker|major|minor> — <problem>. <suggested fix>.
```

End with `VERDICT: approve | request-changes`. No praise, no style nits that Prettier/ESLint already cover.

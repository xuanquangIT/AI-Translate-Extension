# AGENTS.md — LingoFlux

Instructions for every AI coding agent (Codex, Claude Code, Antigravity, and others). Humans: see
[CONTRIBUTING.md](CONTRIBUTING.md). This file is the single source of agent rules; `CLAUDE.md`, `GEMINI.md`, and
`.agents/rules/` only point here.

LingoFlux is a Manifest V3 browser extension (Chrome/Edge) that translates text through user-configured
OpenAI-compatible or Anthropic-compatible providers. Plain JavaScript, **no bundler**: `src/` is the shipped extension.

## 1. Pick your role first

| First message of the session starts with | You are          | Follow                                                                       |
| ---------------------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `TASK <id>`                              | **Worker**       | [`.agents/skills/worker/SKILL.md`](.agents/skills/worker/SKILL.md)           |
| anything else, and the work splits       | **Orchestrator** | [`.agents/skills/orchestrate/SKILL.md`](.agents/skills/orchestrate/SKILL.md) |
| anything else, small single change       | **Solo**         | the matching task skill below; same rules as a Worker, without a brief       |

The full protocol (roles, `.tasks/TASKS.md`, brief and report formats, tiers, integration) is in
[docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md).

## 2. Read before you change anything

1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the **codebase map**: modules, layer rules, flows, invariants.
   Read it instead of exploring the tree. If you add, move, or remove a module, update it in the same change.
2. [docs/CONTRACTS.md](docs/CONTRACTS.md) — only when touching messages, storage keys, provider I/O, or the manifest.
3. The skill for your task (section 4). Then read only the files your task owns.

## 3. Commands

```sh
npm ci                 # once (Node >= 22, see .nvmrc)
npm test               # unit + contract tests, no network
npm run verify         # syntax, extension validation, lint, format, tests, agent-config drift, build
npm run lint:fix && npm run format   # auto-fix style
npm run sync:agents    # regenerate .claude/ mirrors after editing .agents/
```

`npm run verify` passing is the definition of done. CI runs the same command.

## 4. Skills (task recipes)

Canonical sources live in `.agents/skills/<name>/SKILL.md` (read natively by Codex and Antigravity; mirrored to
`.claude/skills/` for Claude Code). Open the one that matches your task:

| Skill                                                      | Use when                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| [orchestrate](.agents/skills/orchestrate/SKILL.md)         | A request needs several tasks / parallel workers                    |
| [worker](.agents/skills/worker/SKILL.md)                   | Executing one `TASK <id>` brief                                     |
| [feature](.agents/skills/feature/SKILL.md)                 | Adding or changing user-visible behavior                            |
| [bugfix](.agents/skills/bugfix/SKILL.md)                   | Fixing a defect (failing test first)                                |
| [provider](.agents/skills/provider/SKILL.md)               | Adding or changing a provider adapter / API type                    |
| [contract-change](.agents/skills/contract-change/SKILL.md) | Adding/renaming a message type, storage key, permission, or default |
| [integrate](.agents/skills/integrate/SKILL.md)             | Merging task branches into an integration branch                    |
| [review](.agents/skills/review/SKILL.md)                   | Reviewing a diff or PR against the invariants                       |
| [release](.agents/skills/release/SKILL.md)                 | Cutting a version (bump, changelog, tag)                            |

Agent roles (investigator, workers by tier, integrator, reviewer) are defined in `.agents/roles/`.

## 5. Hard rules

- **Layers.** `shared ◀ providers ◀ translation ◀ background ▶ storage ▶ shared`; pages import only `shared` and
  `pages/shared`; the content script imports nothing. `npm run check:extension` enforces this.
- **Content script is a classic script.** It cannot `import`. It mirrors message strings and `cleanText`; contract
  tests keep the mirrors in sync — update both sides together.
- **Messages.** New message type = registry (`src/shared/messages.js`) + handler + `docs/CONTRACTS.md` + test.
  Responses are always `{ ok: true, ... }` or `{ ok: false, error }`.
- **Prompt security.** Untrusted text goes in the JSON user envelope, never the system policy. Provider output that is
  not the exact JSON contract fails closed. Provider output reaches the DOM only via `textContent`.
- **Secrets.** Never print, read aloud, log, commit, or put in fixtures: `.env`, API keys, private page text. Never add
  keys to cache keys, errors, or history.
- **Permissions.** Do not widen `manifest.json` permissions without updating `PRIVACY.md` and the manifest contract test.
- **Tests.** Every behavior change or bug fix ships with a test. No network in tests (`tests/helpers/fetch-mock.js`).
- **Docs.** Module changes update `docs/ARCHITECTURE.md`; contract changes update `docs/CONTRACTS.md`; user-visible
  changes add a line under `## [Unreleased]` in `CHANGELOG.md`.

## 6. Ask first (never do on your own)

- `npm run test:live` — spends the user's real provider quota.
- `git push`, opening/merging PRs, tagging, publishing a release, changing GitHub settings.
- Deleting branches, rewriting history, `--force` anything, `npm audit fix --force`.
- Adding a runtime dependency (the extension ships zero dependencies) or a bundler.

## 7. Git

Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `refactor/…`, `test/…`, `chore/…`, `ci/…`; orchestrated work uses
`task/<id>-<slug>` and `integration/<batch>`. Conventional Commits (`feat(storage): …`). One logical change per
commit. PRs are squash-merged into a linear `main`. Details: [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md).

## 8. Reporting

Facts only: what changed (paths), the test command and its result with counts, decisions you made, and anything left
open. No diffs or restated instructions unless asked.

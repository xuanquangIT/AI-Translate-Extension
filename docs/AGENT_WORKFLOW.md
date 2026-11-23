# Agent Workflow: Orchestrator → Workers

How AI agents (Claude Code, Codex, Antigravity, …) work on LingoFlux. Rules every agent follows are in
[AGENTS.md](../AGENTS.md); this document is the full multi-session protocol and the per-tool setup.

## Layout

```text
AGENTS.md                  canonical rules for every agent (role detection, commands, hard rules)
CLAUDE.md, GEMINI.md       pointers to AGENTS.md (+ tool specifics)
.agents/rules/project.md   Antigravity always-on workspace rule → AGENTS.md
.agents/skills/<name>/     canonical skills (Codex and Antigravity read these natively)
.agents/roles/<role>.md    canonical agent roles with tier (investigator, worker, integrator, reviewer)
.claude/skills/, agents/   GENERATED mirrors for Claude Code — `npm run sync:agents`; CI fails on drift
.claude/settings.json      shared Claude Code permissions (live tests and pushes always ask)
.tasks/TASKS.md            local, git-ignored batch state owned by the Orchestrator (format: .tasks/README.md)
docs/ARCHITECTURE.md       the codebase map — the only source file an Orchestrator reads
```

Edit `.agents/` only, then run `npm run sync:agents` and commit both.

## Roles

**Role detection:** if the session's first message starts with `TASK <id>`, the agent is a **Worker**. Otherwise it is
the **Orchestrator** when the request splits into several tasks, or **Solo** for a single small change (Solo = Worker
rules without a brief: one change, tests, `npm run verify`).

| Role         | Does                                                                    | Never                                                                 |
| ------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Orchestrator | Plans, gets approval, dispatches, tracks `.tasks/TASKS.md`, reports     | Writes code, reads source (except the map), reviews diffs, runs tests |
| Investigator | Answers one read-only question with `path:line` facts (cheapest model)  | Edits, proposes fixes                                                 |
| Worker       | Executes one task in its own worktree on `task/<id>-<slug>`, reports    | Touches files outside **May modify**, merges, pushes                  |
| Integrator   | Merges task branches into `integration/<batch>`, runs full verification | Resolves semantic conflicts silently, pushes                          |
| Reviewer     | Read-only review against the invariants                                 | Edits                                                                 |

## Orchestrator protocol

Skill: [.agents/skills/orchestrate/SKILL.md](../.agents/skills/orchestrate/SKILL.md).

1. **Plan.** Read only the request, `docs/ARCHITECTURE.md`, and `.tasks/TASKS.md`. Optionally one investigator.
   Tasks own **disjoint files**, have explicit deps, testable acceptance, fit one PR, and carry a tier.
2. **Checkpoint (mandatory).** Show `id | goal | owns | deps | tier | acceptance`. Spawn nothing until the user approves.
3. **Dispatch.** Write `.tasks/TASKS.md` (`approved: yes`, all `pending`). Spawn ready workers in parallel, each in its
   own worktree on `task/<id>-<slug>` (from `main`, or from the dependency's branch). Briefs are self-contained and
   point to files.
4. **Wait.** No polling, no reading transcripts or diffs. Update `TASKS.md` per report. `blocked` → answer if known,
   else escalate immediately. `failed` → retry once with a better brief (or higher tier), then escalate.
5. **Integrate.** One integrator merges all task branches into `integration/<batch>` and runs `npm run verify`.
6. **Report.** One message: per-task status + branch, integration branch, verify result with counts, open issues.

The Orchestrator persists all state in `.tasks/TASKS.md` and resumes from it after compaction.

### Ownership of shared files

`docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`, `CHANGELOG.md`, `src/shared/messages.js`, `src/shared/config.js`, and
`package.json` are hot spots. In one batch each belongs to at most one task; other tasks list required edits under
`NEXT`, and the Orchestrator folds them into a final light docs task or the integrator's seam fixes.

## Worker brief (template)

```text
TASK <id>: <goal>
Context: <why, 1-3 lines, link docs/ARCHITECTURE.md sections>
Read first: docs/ARCHITECTURE.md, .agents/skills/<skill>/SKILL.md, <files>
May modify: <files/globs>  (anything else → report blocked)
Depends on: <task id + branch | none>
Acceptance:
- <criterion>
- `npm run verify` passes
Out of scope: <list>
```

## Worker report (≤ 15 lines)

```text
STATUS: done | blocked | failed
TASK: <id>
BRANCH: task/<id>-<slug>
CHANGED: <paths>
TESTS: npm run verify → pass|fail (<counts>)
DECISIONS: <trivial choices | none>
BLOCKER/NEXT: <question + recommended answer | follow-up | none>
```

## Tiers and models

| Tier       | Typical work                                                        | Claude Code (generated agent) | Codex / Antigravity                   |
| ---------- | ------------------------------------------------------------------- | ----------------------------- | ------------------------------------- |
| `light`    | Rename, config, docs, small isolated fix, investigator questions    | `worker-light` → `haiku`      | fastest/cheapest model, low reasoning |
| `standard` | Feature or bug fix with known cause in a few files, integration     | `worker-standard` → `sonnet`  | default model, medium reasoning       |
| `heavy`    | Cross-layer change, unknown root cause, migrations, prompt security | `worker-heavy` → `opus`       | strongest model, high reasoning       |

The Claude mapping lives in `TIER_MODELS` in `scripts/sync-agent-config.mjs`.

## Per-tool setup

### Claude Code

- Loads `CLAUDE.md` (imports `AGENTS.md`), skills from `.claude/skills/`, subagents from `.claude/agents/`.
- Orchestrating inside one session: Agent tool with `subagent_type: worker-<tier>`, `isolation: "worktree"`, prompt =
  brief. Send independent workers in one message so they run in parallel; reports arrive automatically.
- Orchestrating across sessions: create a worktree per task (below), open a Claude Code session in it, and paste the
  brief as the first message.

### Codex

- Reads `AGENTS.md` and skills in `.agents/skills/` natively.
- One Codex session (local or cloud task) per worker, each in its own worktree/branch; the first message is the brief,
  so role detection makes it a Worker. Use a lower reasoning effort for `light`, higher for `heavy`.

### Antigravity

- Loads the always-on rule in `.agents/rules/project.md` (→ `AGENTS.md`) and skills in `.agents/skills/`.
- Use the Agent Manager to run one agent per task, each pointed at its own worktree, first message = brief.

### Worktrees by hand (any tool)

```sh
git worktree add ../lingoflux-wt/T1 -b task/T1-lang-shortcut main
# open the agent in ../lingoflux-wt/T1 and send the brief
git worktree remove ../lingoflux-wt/T1      # after the branch is merged
```

Run `npm ci` once in each new worktree before `npm run verify`.

## Single-agent work (Solo)

Most changes do not need orchestration: create `feat/…` or `fix/…`, follow the matching skill (`feature`, `bugfix`,
`provider`, `contract-change`), run `npm run verify`, and open a PR (see [GIT_WORKFLOW.md](GIT_WORKFLOW.md)).

## Safety (all roles)

- Never print or commit `.env`, API keys, or private page text.
- `npm run test:live`, `git push`, PR merges, tags, releases, and GitHub settings require explicit user approval.
- No new runtime dependencies or bundler without an ADR (`docs/adr/`).

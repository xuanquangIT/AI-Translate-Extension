# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Skills in `.claude/skills/` and subagents in `.claude/agents/` are **generated** from `.agents/` by
  `npm run sync:agents`. Edit the sources in `.agents/`, never the mirrors; `npm run check:agents` fails on drift.
- Subagents (see `.agents/roles/`):
  - `investigator` — read-only, cheap; answers one question with `path:line` facts. The only agent an Orchestrator may
    use to look at code.
  - `worker-light` / `worker-standard` / `worker-heavy` — execute one `TASK <id>` brief at that tier.
  - `integrator` — merges approved task branches into `integration/<batch>` and runs `npm run verify`.
  - `reviewer` — read-only review of a diff against the invariants.
- Orchestrating in Claude Code: spawn each worker with the Agent tool, `subagent_type: worker-<tier>`,
  `isolation: "worktree"`, and the brief from `docs/AGENT_WORKFLOW.md` as the prompt. In the desktop app, a long task
  (or one the user wants to watch) may run as a session instead: `start_session` with `initiation: "user_asked"`,
  `context: "fresh"`, `use_worktree: true`, `model` from the tier, `name: <batch>-<id>`. Spawn independent workers in
  one message so they run in parallel. Workers report back automatically; do not poll. Fixes and review findings go
  to the same worker with `SendMessage`.
- Project permissions live in `.claude/settings.json` (shared). Personal overrides go in
  `.claude/settings.local.json` (git-ignored).

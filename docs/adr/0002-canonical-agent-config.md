# ADR 0002: Canonical agent configuration in `.agents/` with generated tool mirrors

- Status: accepted
- Date: 2026-11-22

## Context

Contributors use several coding agents. Codex reads `AGENTS.md` and `.agents/skills/`; Antigravity reads
`.agents/rules/` and `.agents/skills/`; Claude Code reads `CLAUDE.md`, `.claude/skills/`, and `.claude/agents/`.
Maintaining parallel copies by hand drifts quickly.

## Decision

- `AGENTS.md` holds all agent rules. `CLAUDE.md` imports it; `GEMINI.md` and `.agents/rules/project.md` point to it.
- `.agents/skills/` and `.agents/roles/` are the only editable sources for skills and agent roles.
- `scripts/sync-agent-config.mjs` generates `.claude/skills/` and `.claude/agents/` (mapping role tiers to Claude
  models). `npm run check:agents` runs in `npm run verify` and CI and fails on drift.

## Consequences

- One edit updates every tool after `npm run sync:agents`.
- Generated files are committed so agents work right after clone; they are marked `linguist-generated`.
- Tool-specific features that do not map cleanly stay in that tool's pointer file (for example `.claude/settings.json`).

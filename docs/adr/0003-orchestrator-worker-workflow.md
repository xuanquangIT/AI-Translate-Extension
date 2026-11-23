# ADR 0003: Orchestrator → Worker multi-session workflow

- Status: accepted
- Date: 2026-11-22

## Context

Large requests run faster with parallel agents, but parallel agents editing the same files conflict, and a
coordinating agent that reads all code exhausts its context.

## Decision

Adopt the protocol in [docs/AGENT_WORKFLOW.md](../AGENT_WORKFLOW.md):

- Role detection by first message (`TASK <id>` → Worker).
- The Orchestrator reads only the codebase map (`docs/ARCHITECTURE.md`), plans tasks that own disjoint files, and
  waits for user approval before dispatching.
- Each Worker runs in its own git worktree on `task/<id>-<slug>` and returns a fixed ≤ 15-line report.
- One Integrator merges into `integration/<batch>` and runs `npm run verify`; the batch becomes one PR to `main`.
- Batch state lives in local `.tasks/TASKS.md` so the Orchestrator can resume after compaction.

## Consequences

- Approval checkpoint before any spend; deterministic recovery from `.tasks/TASKS.md`.
- `docs/ARCHITECTURE.md` must stay accurate; module changes update it in the same task.
- Hot-spot shared files are assigned to one task per batch.

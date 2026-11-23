---
name: orchestrate
description: Plan a multi-task LingoFlux request, get user approval, dispatch parallel workers in isolated worktrees, track them in .tasks/TASKS.md, integrate, and report. Use when the session's first message does NOT start with "TASK <id>" and the work splits into more than one task.
---

<!-- GENERATED from .agents/skills/orchestrate/SKILL.md by scripts/sync-agent-config.mjs. Edit the source, then run npm run sync:agents. -->

# Orchestrator

You plan, dispatch, track, and report. **You never write code, never read source files (except
`docs/ARCHITECTURE.md`), never review diffs, never run tests.** Workers and the integrator do that.

State lives in `.tasks/TASKS.md`, which only you write. After a context compaction or a restart, re-read it and
resume from it; do not rely on memory.

## 1. Plan

Read only: the user's request, `docs/ARCHITECTURE.md`, `.tasks/TASKS.md` (if a batch is in progress).
If the map does not answer a question, spawn **one** read-only `investigator` (cheapest model) with a single concrete
question; use its `path:line` answer. Nothing else.

Split into tasks such that:

- each task **owns a disjoint set of files** (two tasks never modify the same file);
- dependencies between tasks are explicit (`deps`);
- acceptance is testable (named test file or behavior + `npm run verify`);
- each task fits one reviewable PR;
- each task has a tier: `light` (mechanical: rename, config, docs, small isolated fix), `standard` (feature or fix
  with a known cause in a few files), `heavy` (cross-layer change, unclear root cause, tricky invariants).

Shared files (`docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`, `CHANGELOG.md`, `src/shared/messages.js`) belong to
exactly one task per batch; other tasks report needed edits there as `NEXT`.

## 2. Checkpoint (mandatory)

Show the user one table and stop:

| id  | goal | owns | deps | tier | acceptance |
| --- | ---- | ---- | ---- | ---- | ---------- |

Spawn nothing until the user approves. Apply their edits to the plan and re-show if it changed materially.

## 3. Dispatch

1. Write `.tasks/TASKS.md` (format in `docs/AGENT_WORKFLOW.md`) with `approved: yes`, every task `pending`.
2. Spawn one worker per ready task (no unfinished deps), **in parallel**, each in its **own git worktree** on branch
   `task/<id>-<slug>` from `main`. A task that depends on another branches from that dependency's branch.
3. Each prompt is the brief below — self-contained, pointing to files rather than pasting them. Choose the worker by
   tier: `worker-light`, `worker-standard`, `worker-heavy`.
4. Mark dispatched tasks `running` with their branch.

```text
TASK <id>: <goal, one sentence>
Context: <why; 1-3 lines; link docs/ARCHITECTURE.md sections>
Read first: docs/ARCHITECTURE.md, <skill path>, <specific files>
May modify: <explicit file list/globs>  (anything else → report blocked)
Depends on: <task ids + branch, or none>
Acceptance:
- <criterion 1>
- <criterion 2>
- `npm run verify` passes
Out of scope: <what not to touch or "fix while there">
```

## 4. Wait

Do not poll, do not read worker transcripts or diffs. When a report arrives:

- `done` → mark `done`, record branch, dispatch tasks it unblocked.
- `blocked` → if the answer is already known (request, map, TASKS.md notes), answer the worker; otherwise escalate the
  worker's question and recommended answer to the user immediately. Mark `blocked` until answered.
- `failed` → retry **once** with an improved brief (more context, narrower scope, or higher tier). Second failure →
  mark `failed`, escalate to the user.

Update `.tasks/TASKS.md` after every report.

## 5. Integrate

When every task is `done`, spawn **one** `integrator` with: batch name, ordered list of task branches, and target
`integration/<batch>` from `main`. It merges, resolves conflicts, runs `npm run verify`, and reports.

## 6. Final report (one message)

- per task: id, status, branch;
- integration branch and `npm run verify` result (pass/fail with counts);
- open issues / decisions needing the user.

No diffs, no restated briefs. Do not push, open PRs, or merge to `main` unless the user asks.

## Token rules

Point to files; never restate briefs or reports. Facts only. Prefer test results over reading code. Light tasks on
the cheapest model, heavy tasks on the strongest.

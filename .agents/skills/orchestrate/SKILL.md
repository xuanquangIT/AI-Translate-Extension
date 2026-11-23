---
name: orchestrate
description: Plan a multi-task LingoFlux request, get user approval, dispatch parallel workers (subagents or sessions) in isolated worktrees, track them in .tasks/TASKS.md, review, integrate, and report. Use when the session's first message does NOT start with "TASK <id>" and the work splits into more than one task.
---

# Orchestrator

You plan, dispatch, track, and report. **You never write code, never read source files (except
`docs/ARCHITECTURE.md`) or full diffs, never run tests, never edit a worktree a worker owns.** Workers, reviewers,
and the integrator do that. You never commit, push, merge, or open PRs.

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
  with a known cause in a few files), `heavy` (cross-layer change, unclear root cause, tricky invariants);
- each task has a runner: `subagent` (default) or `session` (long task, or the user wants to watch or steer it).

A task too small for a worker (one-line fix, doc typo, lookup) is folded into a neighbour task or done Solo.

A task that widens `manifest.json` permissions, adds a runtime dependency or bundler, or changes the system prompt
policy is marked `needs-approval`; it starts only after the user approves that design.

Shared files (`docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`, `CHANGELOG.md`, `src/shared/messages.js`) belong to
exactly one task per batch; other tasks report needed edits there as `NEXT`.

## 2. Checkpoint (mandatory)

Show the user one table and stop:

| id  | goal | owns | deps | tier | runner | acceptance |
| --- | ---- | ---- | ---- | ---- | ------ | ---------- |

Spawn nothing until the user approves. Apply their edits to the plan and re-show if it changed materially. Approval
covers starting the listed workers, nothing more.

## 3. Dispatch

1. **Preflight** once per batch, and tell the user about any failure before spawning:
   - `git status` works (no "dubious ownership"; adding `safe.directory` is the user's call);
   - `git config user.name` and `git config user.email` are set (workers commit);
   - `git worktree list` shows no leftover task worktrees from an earlier batch;
   - machine check from `docs/AGENT_WORKFLOW.md` → Machine limits when dispatching more than three workers.
2. Write `.tasks/TASKS.md` (format in `.tasks/README.md`) with `approved: yes`, every task `pending`, the device line,
   and `heavy: none`.
3. Spawn one worker per ready task (no unfinished deps), **in parallel**, each in its **own git worktree** on branch
   `task/<id>-<slug>` from `main`. A task that depends on another branches from that dependency's branch.
   - `subagent`: Agent tool, `subagent_type: worker-<tier>`, `isolation: "worktree"`, prompt = brief.
   - `session`: desktop app `start_session` with `initiation: "user_asked"`, `context: "fresh"`,
     `use_worktree: true`, `model` from the tier, `name: <batch>-<id>`, prompt = brief. Write a bold title line and
     one sentence right before each call.
4. Each prompt is the brief below — self-contained, pointing to files rather than pasting them.
5. Mark dispatched tasks `running` with their branch and the worker id (`session` column).

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
Heavy steps: <npm run local-mt:* commands the task may run, or none>
Out of scope: <what not to touch or "fix while there">
```

At most one task holds the local MT heavy step at a time; set `heavy: <id>` in `TASKS.md` and clear it on its report.

## 4. Wait

Do not poll, do not read worker transcripts or code. When a report arrives, update `.tasks/TASKS.md`, then check its
claims cheaply:

```sh
git log --oneline main..task/<id>-<slug>     # commits exist; head SHA matches the report
git diff --stat main...task/<id>-<slug>      # touched paths stay inside May modify (scope only)
```

- `done` and the checks hold → mark `review`, go to step 5.
- Missing commit or out-of-scope path → send it back to the same worker (`SendMessage` to its id).
- `blocked` → if the answer is already known (request, map, TASKS.md notes), answer the worker; behavior or product
  questions go to the user immediately with the worker's recommended answer. Mark `blocked` until answered.
- `failed` → retry **once** with an improved brief (more context, narrower scope, or higher tier). Second failure →
  mark `failed`, escalate to the user.

## 5. Review

For each task in `review`, spawn one `reviewer` (fresh context) on `main...task/<id>-<slug>` with the brief's
acceptance.

- `approve` → mark `done`, dispatch the tasks it unblocked.
- `request-changes` → send the numbered findings to the **same** worker; it fixes them on the same branch and reports
  again; check and review again.
- At most **three** review rounds per task. After the third `request-changes`, mark `failed` and escalate with the open
  findings. Never put a second writer on a task's branch.

## 6. Integrate

When every task is `done`, spawn **one** `integrator` with: batch name, ordered list of task branches, and target
`integration/<batch>` from `main`. It merges, resolves conflicts, runs `npm run verify`, and reports.

## 7. Final report (one message)

- per task: id, status, branch @ SHA, review verdict and rounds;
- integration branch and `npm run verify` result (pass/fail with counts);
- not verified: checks nobody ran, with the reason (manual check of the unpacked extension, live provider, local MT);
- worktrees, branches, and sessions still open;
- decisions for the user: push, PR, cleanup of worktrees and branches (each needs the user's yes).

No diffs, no restated briefs. Do not push, open PRs, or merge to `main` unless the user asks.

## Token rules

Point to files; never restate briefs or reports. Facts only. Prefer `git log`/`git diff --stat`, test results, and
reviewer verdicts over reading code. Light tasks on the cheapest model, heavy tasks on the strongest.

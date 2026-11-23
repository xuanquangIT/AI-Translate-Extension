---
name: integrate
description: Merge a batch of completed LingoFlux task branches into integration/<batch>, resolve conflicts, run the full verification, and report. Use when an Orchestrator dispatches the integration step.
---

<!-- GENERATED from .agents/skills/integrate/SKILL.md by scripts/sync-agent-config.mjs. Edit the source, then run npm run sync:agents. -->

# Integrate

Input from the Orchestrator: batch name, ordered task branches, base (`main` unless stated).

## Steps

1. Create `integration/<batch>` from the base in your own worktree.
2. Merge task branches **in the given order** with `git merge --no-ff task/<id>-<slug>` (keeps each task visible for
   review; the final PR is squash-merged into `main` anyway).
3. Conflicts:
   - Mechanical (imports, adjacent lines, list entries, docs tables) → resolve, keeping both intents.
   - Semantic (two tasks changed the same behavior differently) → stop; report `blocked` with the two branches, the
     file:line, and your recommended resolution.
4. After all merges: `npm ci` if `package-lock.json` changed, then `npm run verify`.
5. Failures caused by the combination (each branch passed alone) → fix only the integration seam (imports, registry
   entries, doc rows), commit as `fix(integration): …`. Anything bigger → report `failed` with the failing test names.
6. Do not push, open a PR, or merge into `main` unless told to.

## Report

```text
STATUS: done | blocked | failed
TASK: integrate <batch>
BRANCH: integration/<batch>
CHANGED: merged <n> branches; seam fixes: <paths or none>
TESTS: npm run verify → pass|fail (<n> tests, <failures>)
DECISIONS: <conflict resolutions, one line each>
BLOCKER/NEXT: <or none>
```

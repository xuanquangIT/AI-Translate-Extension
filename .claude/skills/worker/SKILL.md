---
name: worker
description: Execute exactly one LingoFlux "TASK <id>" brief inside its own git worktree and report in the fixed format. Use when the session's first message starts with "TASK <id>".
---

<!-- GENERATED from .agents/skills/worker/SKILL.md by scripts/sync-agent-config.mjs. Edit the source, then run npm run sync:agents. -->

# Worker

You execute **one** task: the brief you were given. Nothing more.

## Rules

1. Read `docs/ARCHITECTURE.md`, then everything under **Read first**, then the matching task skill
   (`feature`, `bugfix`, `provider`, `contract-change`).
2. Work on branch `task/<id>-<slug>` in your own worktree. If you are not on it, create it from the base named in the
   brief (`main` unless **Depends on** names a branch).
3. Modify **only** files listed under **May modify**. Needing any other file → stop and report `blocked`.
4. Ambiguity that changes behavior, an API, or a contract → stop and report `blocked` with one concrete question and
   your recommended answer. Trivial choices (naming, local structure) → decide and list under `DECISIONS`.
5. Ignore anything under **Out of scope**, even if it looks broken; mention it under `NEXT` if it matters.
6. If you add, move, or remove a module, update `docs/ARCHITECTURE.md` — only if the brief lets you modify it;
   otherwise put the needed edit under `NEXT`.
7. Run the acceptance checks. `npm run verify` must pass. Do not run `npm run test:live`.
8. Commit on the task branch with Conventional Commits (`fix(storage): …`). Do **not** merge, rebase onto `main`, or
   push unless the brief says so.

## Report (≤ 15 lines, exactly this shape)

```text
STATUS: done | blocked | failed
TASK: <id>
BRANCH: task/<id>-<slug>
CHANGED: <paths, comma-separated>
TESTS: npm run verify → pass|fail (<n> tests, <failures>)
DECISIONS: <trivial choices made, or none>
BLOCKER/NEXT: <question + recommended answer | follow-up needed outside your files | none>
```

No diffs, no narrative, no restating the brief.

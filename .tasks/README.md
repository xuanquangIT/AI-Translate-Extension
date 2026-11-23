# .tasks/

Local, git-ignored batch state for the Orchestrator → Worker workflow ([docs/AGENT_WORKFLOW.md](../docs/AGENT_WORKFLOW.md)).
Only this README is committed. The Orchestrator creates and owns `.tasks/TASKS.md`; workers never edit it.
After a context compaction or restart, the Orchestrator re-reads `.tasks/TASKS.md` and resumes from it.

Format of `.tasks/TASKS.md`:

```markdown
# Batch: <name> approved: yes|no heavy: <task id|none>

Device @<time>: FreeRAM <x> GB, FreeCommit <y> GB, CPU <z>%

| id  | goal                         | owns                              | deps | tier     | runner   | session  | status  | branch @ sha                  |
| --- | ---------------------------- | --------------------------------- | ---- | -------- | -------- | -------- | ------- | ----------------------------- |
| T1  | Add target-language shortcut | src/content/content.js, tests/... | —    | standard | subagent | a1b2c3d4 | review  | task/T1-lang-shortcut@abc1234 |
| T2  | Document shortcut in README  | README.md                         | T1   | light    | session  | local_…  | pending |                               |

## Notes

- T1: <answer given to a blocked question, review round and open findings, retry reason, or escalation>
- Not verified: <checks nobody ran + reason>
```

`session` is the worker's id (subagent id or `local_…` session id); fixes and review findings go back to it.

Status values: `needs-approval` → `pending` → `running` → `review` → `done` | `blocked` | `failed`. Integration adds a
final row `INT | integrate <batch> | — | all | standard | subagent | … | … | integration/<batch>`.

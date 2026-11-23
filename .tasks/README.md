# .tasks/

Local, git-ignored batch state for the Orchestrator → Worker workflow ([docs/AGENT_WORKFLOW.md](../docs/AGENT_WORKFLOW.md)).
Only this README is committed. The Orchestrator creates and owns `.tasks/TASKS.md`; workers never edit it.
After a context compaction or restart, the Orchestrator re-reads `.tasks/TASKS.md` and resumes from it.

Format of `.tasks/TASKS.md`:

```markdown
# Batch: <name> approved: yes|no

| id  | goal                         | owns                              | deps | tier     | status  | branch                |
| --- | ---------------------------- | --------------------------------- | ---- | -------- | ------- | --------------------- |
| T1  | Add target-language shortcut | src/content/content.js, tests/... | —    | standard | running | task/T1-lang-shortcut |
| T2  | Document shortcut in README  | README.md                         | T1   | light    | pending |                       |

## Notes

- T1: <answer given to a blocked question, retry reason, or escalation>
```

Status values: `pending` → `running` → `done` | `blocked` | `failed`. Integration adds a final row
`INT | integrate <batch> | — | all | standard | … | integration/<batch>`.

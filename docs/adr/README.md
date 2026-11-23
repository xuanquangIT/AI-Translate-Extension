# Architecture Decision Records

Short records of decisions that are expensive to reverse. Add one when you introduce a dependency, a build step, a
new runtime context, a storage shape change that needs migration, or a workflow change for agents.

File name: `NNNN-kebab-title.md`. Sections: Context, Decision, Consequences. Status: proposed | accepted | superseded.

| ADR                                               | Decision                                                  |
| ------------------------------------------------- | --------------------------------------------------------- |
| [0001](0001-no-bundler-classic-content-script.md) | No bundler; classic content script with tested mirrors    |
| [0002](0002-canonical-agent-config.md)            | `.agents/` is canonical; `.claude/` mirrors are generated |
| [0003](0003-orchestrator-worker-workflow.md)      | Orchestrator → Worker multi-session workflow              |

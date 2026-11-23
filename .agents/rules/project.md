---
trigger: always_on
---

# LingoFlux workspace rule

Before any change, read `AGENTS.md` at the repository root and follow it: pick your role (Worker if the first message
starts with `TASK <id>`, otherwise Orchestrator or Solo), read `docs/ARCHITECTURE.md` (the codebase map), and use the
matching skill in `.agents/skills/`. `npm run verify` must pass before you report done. Never print `.env` or API keys,
and ask the user before `npm run test:live`, pushing, or changing GitHub settings.

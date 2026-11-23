<!-- Title = squash commit message: Conventional Commit, e.g. `fix(storage): reselect model after provider removal`. -->

## Summary

What user-facing problem this solves and the scope of the change.

## Change surface

Use `None` where a surface is not affected (layers: `docs/ARCHITECTURE.md`).

- Layers/modules touched:
- Messages, storage keys, or defaults (`docs/CONTRACTS.md` updated?):
- Provider/API behavior:
- DOM or UI behavior:
- Permissions, privacy, or security:
- Docs / CHANGELOG:

## Validation

- [ ] `npm run verify` passes locally
- [ ] New behavior has a test; a bug fix has a regression test that failed before the fix
- [ ] Manual browser checks from `docs/TESTING.md` for UI/DOM/provider changes (list rows below), or stated as not run
- [ ] Screenshots for visible UI changes

Commands and observed results:

```text
Paste sanitized output here.
```

Manual browser coverage and anything not tested:

## Safety checklist

- [ ] No API key, authorization header, `.env` content, private page text, or personal data is included.
- [ ] Provider output is rendered as text and no remote executable code was added.
- [ ] Any new permission or host access is minimal and documented in `PRIVACY.md`.
- [ ] `dist/`, release ZIPs, and `.tasks/` state are not committed.

## Agent work (if any)

Batch / task ids and branches, or `None`.

## Related issue

Closes #

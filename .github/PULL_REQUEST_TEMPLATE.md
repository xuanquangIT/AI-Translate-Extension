## Summary

Describe the user-facing problem and the scope of this change.

## Change surface

- Runtime owner/context:
- Messages or storage:
- Provider/API behavior:
- DOM or UI behavior:
- Permissions, privacy, or security:
- Documentation:

Use `None` where a surface is not affected.

## Validation

- [ ] `npm test`
- [ ] `npm run build`
- [ ] Loaded or reloaded the generated `dist` build
- [ ] Checked relevant popup, service-worker, and tab consoles
- [ ] Tested the relevant success path
- [ ] Tested the relevant failure and reload path
- [ ] Added screenshots for visible UI changes

Commands and observed results:

```text
Paste sanitized output here.
```

Manual browser coverage and anything not tested:

## Safety checklist

- [ ] No API key, authorization header, `.env` content, private page text, or personal data is included.
- [ ] Provider output is rendered as text and no remote executable code was added.
- [ ] Any new permission or host access is minimal and documented.
- [ ] Public behavior, storage, privacy, and release documentation is updated where applicable.
- [ ] Generated `dist/` and release ZIP files are not committed.

## Related issue

Closes #


# Security Policy

## Supported versions

Security fixes are applied to the latest source on `main` and, when practical, to the most recent published release. Older unpacked snapshots and third-party repackaged builds are not supported.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting for this repository:

https://github.com/xuanquangIT/AI-Translate-Extension/security/advisories/new

Include:

- The affected version, commit, or release archive.
- Browser and operating system.
- A concise impact assessment and reproduction steps.
- A proof of concept with secrets and personal data removed.
- Whether the issue is already public or has been reported elsewhere.

If private vulnerability reporting is temporarily unavailable, contact the maintainer through a private method listed on [@xuanquangIT's GitHub profile](https://github.com/xuanquangIT). Do not send a live API key.

## Response process

The maintainer will aim to acknowledge a complete report within seven days, validate the impact, coordinate a fix and disclosure date, and credit the reporter when requested. Timelines can vary with complexity and store review delays.

Please allow a reasonable remediation period before public disclosure. The project cannot offer a bug bounty or guarantee compensation.

## Security model

- Provider credentials are stored in extension-local browser storage and restricted to trusted extension contexts when the browser supports that control.
- Browser local storage is not an encrypted password vault. Use scoped, revocable provider credentials.
- Translation text and configured prompts are sent directly to the user-selected provider endpoint.
- Source text and custom preferences are isolated from the fixed provider system policy in an untrusted JSON-data envelope. Questions, commands, and prompt-injection strings are translated as content, never intentionally executed.
- Single and batch provider output must match a strict translation-only JSON schema. Single results also preserve question form when the source contains question punctuation. Nonconforming or answer-shaped output fails closed instead of being displayed, cached, or written into a page.
- Provider responses are treated as data and rendered as text; the extension does not intentionally execute remote code.
- The broad host access is used for webpage translation and user-defined provider endpoints. Any expansion of permissions requires documentation and review.

For data-handling details, see the [privacy policy](PRIVACY.md).

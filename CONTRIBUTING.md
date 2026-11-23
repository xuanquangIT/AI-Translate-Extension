# Contributing to LingoFlux Translator

Thank you for helping improve LingoFlux. The project welcomes focused bug fixes, documentation improvements, tests, accessibility work, provider-compatibility improvements, and well-scoped features.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before opening an issue

1. Search existing issues and the current [changelog](CHANGELOG.md).
2. Do not include API keys, provider authorization headers, confidential page text, or full translation payloads.
3. Use the bug or feature issue form so the report includes browser, version, provider interface, and reproduction details.
4. For a vulnerability, stop and follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

Provider-specific service outages, billing, quotas, and account problems usually belong with that provider. See [SUPPORT.md](SUPPORT.md) for the support boundary.

## Local setup

Prerequisites: Git, Node.js 22 or newer (see `.nvmrc`), npm, and Chrome or Microsoft Edge.

```bash
git clone https://github.com/xuanquangIT/AI-Translate-Extension.git
cd AI-Translate-Extension
npm ci
npm run verify
```

Load `src` as an unpacked extension while developing. Load `dist` for release validation because it matches the packaged output.

## Architecture rules

Read the [architecture map](docs/ARCHITECTURE.md), [runtime contracts](docs/CONTRACTS.md), and [feature playbook](docs/FEATURE_PLAYBOOK.md) before changing runtime behavior. Using an AI coding agent? It should start from [AGENTS.md](AGENTS.md).

The most important boundaries are:

- Layers import in one direction (`shared ◀ providers ◀ translation ◀ background ▶ storage ▶ shared`); `npm run check:extension` enforces it.
- Page DOM and selection behavior belong in `src/content/content.js` (a classic script with no imports).
- Provider HTTP belongs in `src/providers/`; prompt policy and strict response parsing in `src/translation/`.
- Storage defaults, migrations, and writers belong in `src/storage/`; pages never write `chrome.storage` directly.
- Cross-context orchestration and message handling belong in `src/background/` (registry: `src/shared/messages.js`).
- Preserve both `model` and `modelProvider`; model IDs are not globally unique.
- Never log or commit API keys, authorization headers, prompts containing private text, or translation payloads.
- Do not add a permission or remote dependency without documenting why it is required.

## Make a change

1. Create a focused branch from `main` named `feat/…`, `fix/…`, `docs/…`, `refactor/…`, `test/…`, `chore/…`, or `ci/…` (see [Git workflow](docs/GIT_WORKFLOW.md)).
2. Keep unrelated formatting or refactors out of the change.
3. Update tests and public documentation in the same pull request when behavior, messages, storage, permissions, or data handling change. Add a line under `## [Unreleased]` in `CHANGELOG.md` for user-visible changes.
4. Use accessible labels, keyboard behavior, and safe DOM APIs. Provider output must be rendered with `textContent`, not `innerHTML`.
5. Use [Conventional Commits](https://www.conventionalcommits.org/) such as `fix(storage): …`. The pull request title must follow the same format because it becomes the squash commit.
6. Run the credential-free validation suite (the same command CI runs).

```bash
npm run lint:fix && npm run format
npm run verify
```

Do not run `npm run test:live` unless you own and authorize the configured test key and quota. Never place a live key in a test artifact, issue, or pull request.

## Manual browser verification

Static checks do not prove browser behavior. Test the relevant cases from [Testing](docs/TESTING.md), including:

- A fresh install and extension reload.
- Success, provider failure, and missing-content-script behavior.
- Popup, service-worker, and tab consoles separately.
- Selection through the floating action and `T` key.
- Badge and Replace modes, including restore.
- A normal page and a dynamic page for DOM changes.
- Persistence after closing and reopening the popup for settings changes.

State exactly what you tested in the pull request. If a browser or live-provider test was not run, say so.

## Pull requests

A reviewable pull request should:

- Explain the user-facing problem and the chosen scope.
- Link a related issue when one exists.
- Identify message, storage, provider, DOM, permission, privacy, and documentation impact.
- Include screenshots for visible UI changes.
- Include test commands and manual browser results.
- Keep generated `dist/` and release ZIP files out of Git.

Maintainers may ask to split broad changes, add evidence, or revise permissions and privacy claims before merging.

## Releases

Maintainers run the credential-free verification suite, inspect the packaged ZIP, and record manual browser results before publishing a version tag. A merged change is not automatically a release. The full process is in [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md#releases).

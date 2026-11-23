# Git Workflow

Trunk-based development with short-lived branches, squash merges, and a linear `main`.

## Branches

| Branch                                                  | Purpose                                                    | Lifetime          |
| ------------------------------------------------------- | ---------------------------------------------------------- | ----------------- |
| `main`                                                  | Always releasable; protected; only changes through PRs     | Permanent         |
| `feat/<slug>`                                           | New user-visible behavior                                  | Days              |
| `fix/<slug>`                                            | Bug fix                                                    | Hours–days        |
| `docs/`, `refactor/`, `test/`, `chore/`, `ci/` `<slug>` | Non-behavioral work                                        | Hours–days        |
| `task/<id>-<slug>`                                      | One Worker task in an orchestrated batch                   | Until integration |
| `integration/<batch>`                                   | Merge of a batch's task branches; becomes the PR to `main` | Until merged      |
| `chore/release-vX.Y.Z`                                  | Version bump + changelog for a release                     | Until merged      |

Slugs are lowercase kebab-case. Delete branches after merge (enable "Automatically delete head branches").
Do not keep long-lived `backup*` branches on the remote; a tag (`archive/<name>`) preserves history more clearly.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>)!: <summary>`

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`, `revert`.
- Scopes follow the source map: `shared`, `providers`, `translation`, `storage`, `background`, `content`, `popup`,
  `options`, `pages`, `agents`, `deps`, `release`.
- Summary: imperative, lowercase, no trailing period, ≤ 72 characters. `!` or a `BREAKING CHANGE:` footer for
  breaking storage/permission/contract changes.
- One logical change per commit. Never commit `.env`, `dist/`, ZIPs, or generated coverage.

Examples: `fix(storage): reselect a model when the selected provider is removed`,
`feat(content): add Alt+T shortcut for target language`, `chore(agents): add release skill`.

## Pull requests

- PR title = the squash commit message, so it must be a Conventional Commit (CI checks it).
- Fill in the PR template: change surface, validation commands with results, manual browser coverage.
- Required to merge: CI `verify` green on all Node versions, PR title check, dependency review, CodeQL, and
  resolved conversations. Code owner review applies once there is more than one maintainer.
- Merge method: **squash only**. Keep PRs small; split by layer if a diff grows past ~400 changed lines.
- Orchestrated batches open one PR from `integration/<batch>`; the description lists task ids and branches.

## Releases

1. `chore/release-vX.Y.Z`: bump `package.json` + `src/manifest.json`, move `CHANGELOG.md` `[Unreleased]` to the new
   version (skill: `.agents/skills/release`). Merge the PR.
2. Tag the merge commit: `git tag -a vX.Y.Z -m "LingoFlux vX.Y.Z"` and `git push origin vX.Y.Z` (maintainer only).
3. `.github/workflows/release.yml` verifies, builds `lingoflux-vX.Y.Z.zip` + `.sha256`, and publishes the GitHub
   Release with notes grouped by label (`.github/release.yml`).

Versions follow SemVer: breaking storage/permission changes → major, new features → minor, fixes → patch.

## Repository settings (recommended)

Applied by the maintainer in GitHub settings; `.github/rulesets/main.json` is the importable ruleset for `main`:

- Pull request required before merging; squash merge only; linear history; no force pushes or deletion.
- Required status checks: `Verify (Node 22)`, `Verify (Node 24)`, `PR title`, `Dependency review`.
- Disable merge commits and rebase merges; enable auto-delete of head branches.
- Labels from `.github/labels.yml` (area + type) feed the labeler workflow and release notes.

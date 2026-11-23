---
name: release
description: Prepare a LingoFlux release - bump the version in package.json and manifest.json, move CHANGELOG Unreleased entries under the new version, verify, and prepare the vX.Y.Z tag that triggers the GitHub release workflow. Use when the user asks to cut, prepare, or publish a release.
---

# Release

Process reference: `docs/GIT_WORKFLOW.md` → Releases. The tag push publishes a public GitHub Release, so **pushing
the tag always needs explicit user approval.**

## Steps

1. Start from an up-to-date `main` with a clean tree. Create `chore/release-vX.Y.Z`.
2. Choose the version with SemVer from `CHANGELOG.md` `[Unreleased]`: breaking storage/permission change → major,
   `Added` → minor, only `Fixed` → patch. Confirm with the user if unclear.
3. Set the same version in `package.json` (`npm version X.Y.Z --no-git-tag-version`) and `src/manifest.json`.
4. `CHANGELOG.md`: rename `[Unreleased]` content to `## [X.Y.Z] - YYYY-MM-DD`, leave an empty `## [Unreleased]`.
5. `npm run verify` and `npm run build:zip`; check the ZIP name `lingoflux-vX.Y.Z.zip`.
6. Commit `chore(release): vX.Y.Z`, open a PR, and stop. After the PR is merged **and the user approves**:
   `git tag -a vX.Y.Z -m "LingoFlux vX.Y.Z"` on the merge commit and `git push origin vX.Y.Z`.
7. `.github/workflows/release.yml` checks tag = package version, runs `verify`, builds the ZIP + SHA-256, and creates
   the GitHub Release with generated notes (categories from `.github/release.yml`).

## Never

Tag without a merged release PR, reuse or move an existing tag, or upload to a browser store (manual, owner only).

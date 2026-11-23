# ADR 0001: No bundler; classic content script with contract-tested mirrors

- Status: accepted
- Date: 2026-11-22

## Context

LingoFlux ships `src/` as-is. Manifest V3 lets the service worker and extension pages be ES modules, but content
scripts declared in `manifest.json` are classic scripts and cannot use `import`. A bundler would allow sharing code
with the content script but adds a build step between source and the loaded extension, source maps for debugging,
and supply-chain surface in the shipped artifact.

## Decision

- No bundler and zero runtime dependencies. `src/` is loaded unpacked during development and copied to `dist/` for
  release.
- Service worker and pages are ES modules with explicit `.js` imports and a layer graph enforced by
  `scripts/validate-extension.mjs`.
- `src/content/content.js` stays one classic script. It mirrors message strings and `cleanText`; contract tests
  (`tests/contract/`) fail when the mirror drifts from `src/shared/`.

## Consequences

- Debugging maps 1:1 to source; reviewers read shipped code.
- Small, deliberate duplication in the content script, guarded by tests.
- Revisit if the content script grows beyond one maintainable file or needs shared non-trivial logic; that change
  requires a new ADR.

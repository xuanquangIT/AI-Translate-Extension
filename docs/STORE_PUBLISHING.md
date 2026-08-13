# Store Publishing Dossier

This document keeps the repository, package, privacy disclosures, and browser-store forms consistent. It is a preparation checklist, not evidence that a store has approved the extension.

Official references:

- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish/)
- [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies/)
- [Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- [Microsoft Edge Add-ons developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)

Store rules and dashboard fields change. Recheck the official references immediately before submission.

## Release targets

| Store | Package | Repository status | External status |
| --- | --- | --- | --- |
| Chrome Web Store | Manifest V3 ZIP from `npm run build:zip` | Preparation in progress | Developer account and listing not verified in this repository |
| Microsoft Edge Add-ons | Same Manifest V3 ZIP after Edge manual testing | Preparation in progress | Partner Center account and listing not verified in this repository |
| Firefox Add-ons | Not available | No Firefox package or test matrix | Out of current scope |

## Canonical listing facts

| Field | Value |
| --- | --- |
| Product name | LingoFlux Translator |
| Single purpose | See `store-assets/single-purpose.txt` |
| Category | Productivity |
| Pricing | Free extension; configured provider may charge the user independently |
| Account requirement | No LingoFlux account; user supplies a compatible provider endpoint and credential |
| Website/source | `https://github.com/xuanquangIT/AI-Translate-Extension` |
| Support | `https://github.com/xuanquangIT/AI-Translate-Extension/issues` |
| Privacy policy | `https://github.com/xuanquangIT/AI-Translate-Extension/blob/main/docs/PRIVACY.md` |
| Remote executable code | No |
| Primary locale | English |

## Privacy and data declarations

The final dashboard answers must match [Privacy Policy](PRIVACY.md) and the exact submitted commit.

- The extension handles authentication information because it stores and transmits user-provided provider API keys.
- The extension handles website content because it reads selected or requested page text and sends it to the configured provider for translation.
- It stores a bounded local translation history and short-lived translation cache. This is translated content, not browsing-history or click-tracking telemetry.
- It does not send data to the LingoFlux maintainer, sell user data, use data for advertising, or include developer-controlled analytics.
- It sends request data to a user-selected third-party provider solely to provide the translation/model-discovery feature.
- It does not execute remote code.

Do not answer **No data handled** merely because the project has no backend. Browser-store disclosures cover access, local storage, and transmission to user-selected providers.

Copy-ready permission explanations are in [permission-justifications.md](store-assets/permission-justifications.md).

## Repository credibility checklist

- [x] Public source repository and OSI-compatible MIT license.
- [x] Clear README with current store status and no unpublished install badges.
- [x] Reproducible install, test, build, and ZIP commands.
- [x] Architecture, runtime contracts, privacy, security, contribution, support, and conduct documents.
- [x] Structured issue forms and pull-request template.
- [x] Credential-free CI and tagged release automation.
- [x] Dependabot configuration and code ownership.
- [x] Set and verify the GitHub **About** description and website.
- [x] Add and verify repository topics such as `chrome-extension`, `edge-extension`, `manifest-v3`, `translation`, and `openai-compatible`.
- [ ] Enable GitHub private vulnerability reporting so the link in `SECURITY.md` works.
- [ ] Enable branch protection for `main`: require CI, block force pushes, and require review where appropriate.
- [ ] Publish the privacy policy at a stable public URL and verify it while signed out. GitHub Pages is preferred over a branch/blob URL for long-term store use.
- [x] Create the first annotated version tag and verify the release ZIP/checksum workflow.

## Package gate

1. Make the same version change in `package.json` and `src/manifest.json`.
2. Update `CHANGELOG.md` with behavior actually verified.
3. Run:

   ```powershell
   npm ci
   npm run verify
   npm run build:zip
   ```

4. Confirm the ZIP filename matches the version.
5. Inspect the archive and confirm `manifest.json` is at the archive root.
6. Confirm the archive contains no `.env`, source maps, logs, test credentials, screenshots with secrets, or development-only files.
7. Record the commit SHA and SHA-256 of the uploaded ZIP.
8. Load `dist` unpacked in Chrome and Edge and complete the browser matrix in [Testing and Release](TESTING_AND_RELEASE.md).

The GitHub tagged-release workflow repeats credential-free tests, verifies the tag equals `package.json` version, builds the ZIP, and publishes the archive with a SHA-256 file. Store submission remains a manual approval step.

## Listing asset gate

- [x] 16, 32, 48, and 128 pixel package icons.
- [x] English short and long descriptions.
- [x] Single-purpose and permission copy.
- [ ] Recapture final store screenshots from the exact release package; repository preview captures are available in `store-assets/screenshots/`.
- [ ] Optional promotional tiles.
- [ ] Public, stable privacy-policy page.
- [ ] Final support contact shown in publisher account.
- [ ] Final reviewer credential decision and private certification notes.
- [ ] Store listing URLs added to the README only after publication.

Image specifications and capture rules are in [Store Listing Assets](store-assets/README.md).

## Manual acceptance evidence

For each target browser, record:

- Browser name and exact version.
- Operating system.
- Extension version, commit SHA, ZIP SHA-256, and install method.
- Fresh-install result.
- Provider discovery and manual-model result.
- Direct text, selection via `T`, floating action, context menu, Badge, Replace/restore, and whole-page results.
- Provider error and extension reload results.
- Popup, service-worker, and tab console findings.
- Screenshot filenames captured from that build.

Do not call the package store-ready while required browser evidence or listing assets are missing.

## Submission sequence

1. Complete the repository, privacy, package, asset, and manual acceptance gates above.
2. Upload the exact recorded ZIP to the Chrome Web Store developer dashboard.
3. Complete Store Listing, Privacy, Distribution, and Test Instructions with the canonical copy in this dossier.
4. Prefer deferred publishing so an approved release can be checked before it becomes public.
5. Upload the same verified package to Microsoft Partner Center after Edge-specific manual acceptance.
6. Complete Single Purpose, permission justifications, remote-code declaration, data usage, privacy URL, localized listings, and certification notes.
7. After approval, add only the confirmed public listing URLs and version badges to the README.
8. Preserve review emails, submitted SHA-256 values, and acceptance evidence outside the public repository if they contain account or credential information.

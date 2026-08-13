# Store Listing Assets

This directory is the source-of-truth workspace for Chrome Web Store and Microsoft Edge Add-ons listing copy and images. Do not add mock screenshots that imply unverified functionality.

## Text assets

| File | Purpose | Status |
| --- | --- | --- |
| `short-description-en.txt` | English short description | Ready for review |
| `description-en.txt` | English long description | Ready for review |
| `single-purpose.txt` | Store privacy form | Ready for review |
| `permission-justifications.md` | Per-permission disclosure copy | Ready for review |
| `reviewer-notes-en.txt` | Certification test notes | Requires a reviewer testing decision |

## Image assets

The repository includes real preview captures for project presentation. Recapture them from the final packaged build after the browser manual matrix passes before submitting them to a browser store.

| Filename | Subject | Status |
| --- | --- | --- |
| `screenshots/popup.png` | Popup with a configured provider/model | Preview available; final store capture pending |
| `screenshots/selection-translation.png` | Selection translation on public sample content | Preview available; final store capture pending |
| `screenshots/settings.png` | Settings page with credentials masked | Preview available; final store capture pending |
| `tile-small.png` | 440 x 280 promotional tile | Missing, optional |
| `tile-marquee.png` | 1400 x 560 promotional tile | Missing, optional |

Use 1280 x 800 or 640 x 400 PNG/JPEG screenshots for Chrome Web Store. Confirm the current dashboard requirements before upload because store specifications can change.

## Capture rules

- Use only the final `dist` build and a clean browser profile.
- Show real extension behavior, not a composited or generated product UI.
- Use public sample text and a non-sensitive test provider.
- Redact API keys, endpoint secrets, personal bookmarks, profile names, tabs, history, and notifications.
- Keep branding, browser frame treatment, and dimensions consistent.
- Do not claim Firefox support or show an unpublished store badge.
- Record the commit and package SHA-256 used for the screenshots.

See [Store Publishing](../STORE_PUBLISHING.md) for the full submission and verification checklist.

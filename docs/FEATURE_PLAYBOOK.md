# Feature Playbook

## Choose the right owner

| Need | Start in | Usually also change |
| --- | --- | --- |
| Add a setting | `lib/config.js`, `lib/storage.js` | background, popup/options, contract docs |
| Add provider/API interface | `lib/api.js` | config, storage, background, options, manifest/public docs if needed |
| Add a popup action | `pages/popup/popup.html`, `popup.js` | background message, popup.css |
| Add a settings UI | `pages/options/options.html`, `options.js` | background/storage, options.css |
| Change selection/badge/replace | `scripts/content.js` | popup/context-menu flow, manual DOM tests |
| Change page translation | `scripts/content.js` + `background.js` | popup progress/chunking, batch adapter |
| Change model/fallback | `scripts/background.js` | favorite storage contract, options/popup presentation |
| Change prompt/parser/API payload | `scripts/lib/api.js` | single and batch paths, error handling |
| Change icon/public metadata | `manifest.json`, assets, `_locales` | README and technical QA |

## Settings feature pattern

1. Add a default in `DEFAULTS`.
2. Include the key in `loadSettings()` and `initializeStorage()`.
3. Decide whether it is a session override or local default. Do not accidentally persist a temporary popup selection globally.
4. Pass it through the appropriate allow-listed writer, extending that allow-list deliberately.
5. Add UI load/save and notify content script if page UI needs the new state.
6. Reload the extension and check both empty storage and an existing-storage profile.

## Provider feature pattern

1. Check URL composition: `buildEndpoint` appends a path only when the base URL does not already end with it; normalize trailing slashes before storing.
2. Filter non-chat models such as embeddings/audio/moderation and return `{ id, label, provider, apiInterface, tier }`.
3. Keep prompt and output schemas in `api.js`, not scattered through UI.
4. Implement both single and batch paths; page translation cannot reuse single translation without losing ID mapping.
5. When primary fails, verify fallback candidates avoid retrying the same model and prioritize favorites.
6. Test bad endpoint, empty models, non-JSON/fenced JSON response, and a surviving second provider.

## DOM feature pattern

1. Define lifecycle: reinjection, SPA navigation, changing selection, reload, and cleanup.
2. Use an isolated `lingoflux-*` class, high z-index for overlays, and exclude the class from selection/page extraction.
3. Use `textContent` for provider results; do not assign untrusted translations through `innerHTML`.
4. In Replace mode, preserve the original fragment and offer a restore path.
5. Do not touch `INPUT`, `TEXTAREA`, `contenteditable`, code/pre, or hidden nodes without dedicated UX and thorough tests.

## Definition of done

- [ ] Scope identifies owner/context/message/storage/provider changes.
- [ ] Contract docs are updated if the runtime surface changed.
- [ ] No API key or sensitive translated text appears in logs, UI, or artifacts.
- [ ] `npm run build` passes and `dist/` is generated from current `src/`.
- [ ] The extension loads/reloads without manifest or service-worker errors.
- [ ] Browser happy path, failure path, and reload are tested for the scoped feature.
- [ ] For DOM changes: selection, badge/replace, dynamic page, and a tab without content script are tested.
- [ ] For provider changes: discovery, selected model, and fallback are tested.

## Existing risks to avoid extending

- `manifest.json` uses `<all_urls>` for content/page translation. Evaluate privacy and permissions before widening scope.
- Provider profiles contain arbitrary third-party endpoints. Synchronize the privacy policy, README, and release notes whenever data handling or permission scope changes.
- `_locales` mostly serves the manifest today; UI has many hard-coded strings. Full i18n requires UI localization calls, not only more locale entries.
- The build script deletes all of `dist/`; keep release artifacts elsewhere or create them through `npm run build:zip`.

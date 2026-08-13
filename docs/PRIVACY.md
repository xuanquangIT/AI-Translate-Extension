# LingoFlux Translator Privacy Policy

Last updated: August 11, 2026

This policy describes the data handling of the open-source LingoFlux Translator browser extension distributed from [this repository](https://github.com/xuanquangIT/AI-Translate-Extension). A browser-store listing must link to this exact policy or an equivalent published copy.

## Summary

LingoFlux does not operate a translation backend and does not include developer-controlled analytics, telemetry, advertising, or tracking. The extension stores configuration in the user's browser profile and sends data directly to an API provider chosen and configured by the user when the user requests a translation or opens or refreshes a model catalog.

The provider is an independent third party. Its privacy policy, security practices, logging, retention, and legal terms apply to data sent to it.

## Data stored in the browser

LingoFlux uses extension-local storage for:

- Provider profiles, including profile name, API type, base URL, API key, enabled state, and manual model IDs.
- Default source and target languages, selected model and provider, favorite models, display mode, and selection-tool setting.
- The custom system prompt and reusable translation preferences.
- A local translation history of at most 50 entries. Each stored source and translation is truncated to 200 characters.
- Migration metadata used to update older settings safely.

LingoFlux uses browser-session storage for:

- Temporary popup model and language choices.
- Provider model catalogs and provider errors, cached for up to 10 minutes.
- Translation results, cached for up to 30 minutes using a hash-derived key.

`chrome.storage.local` is browser-profile storage, not an encrypted secrets vault. People or software with access to the browser profile or device may be able to access it. Use a restricted provider key, rotate it if exposure is suspected, and do not configure credentials on an untrusted device.

## Data sent to a configured provider

Depending on the requested operation, LingoFlux sends some or all of the following directly to the selected provider endpoint:

- Text pasted by the user, selected by the user, or extracted from a page after the user starts a page translation.
- Source and target language choices.
- The custom system prompt and enabled translation preferences.
- The selected model identifier and the request parameters required by the compatible API.
- The configured API key in an authorization header.
- A model-list request when the user or extension refreshes the provider's model catalog.

LingoFlux does not send this data to a server operated by the LingoFlux maintainers. A configured provider may receive and retain it according to that provider's policies. Users should not translate confidential, regulated, personal, health, financial, or authentication data unless their chosen provider and intended use are appropriate for that data.

Use HTTPS for any remote provider. LingoFlux permits user-defined endpoints, so the user is responsible for verifying the endpoint identity and transport security before saving a profile.

## Page access

The extension runs a content script on webpages so the user can translate selections and requested page text. It reads eligible text only to provide those visible translation features. It does not include code that sends browsing history or page content to the LingoFlux maintainers.

LingoFlux excludes password and form fields, code and preformatted blocks, hidden content, `notranslate` content, and its own injected interface from whole-page extraction. Page or selection text is sent to a configured provider only after a user starts a translation through the popup, keyboard action, floating action, or context menu.

## Browser permissions

| Permission | Why LingoFlux uses it |
| --- | --- |
| `storage` | Save provider profiles, credentials, settings, prompts, history, and short-lived caches in the browser profile. |
| `activeTab` | Act on the tab where the user explicitly starts a popup or context-menu translation. |
| `scripting` | Reinject the packaged content script when needed for a user-requested context-menu action. No remote script is downloaded or executed. |
| `contextMenus` | Add the user-invoked **Translate selection** context-menu command. |
| `<all_urls>` host access | Support selection and page translation on ordinary webpages and connect to user-configured provider API hosts. It is not used on browser-internal pages where extensions cannot run. |

The package contains all executable extension code. Provider responses are treated as data and are not executed as JavaScript.

## Data sharing, sale, and tracking

The LingoFlux maintainers do not receive, sell, rent, or use user data for advertising or profiling. Data is disclosed only to the provider endpoint selected by the user as necessary to perform model discovery or translation.

The extension does not use cookies, fingerprinting, advertising identifiers, or developer-controlled analytics SDKs.

## Retention and deletion

- Remove a provider in Settings to delete that locally stored provider profile and credential.
- Clear translation history from the extension interface when available, or remove the extension's stored data through the browser.
- Session caches are removed by the browser when the extension session ends and may also be cleared through browser extension-data controls.
- Uninstalling the extension normally removes its extension storage according to browser behavior.

The LingoFlux maintainers cannot delete data retained by a configured provider. Contact that provider and follow its privacy policy for provider-side access or deletion requests.

## Children

LingoFlux is a general-purpose productivity tool and is not directed to children. Users are responsible for selecting an appropriate provider and complying with applicable age and consent requirements.

## Changes to this policy

Material changes will be committed to this repository and noted in the project changelog. The **Last updated** date will change when the policy changes.

## Contact

For privacy questions, open a [privacy question](https://github.com/xuanquangIT/AI-Translate-Extension/issues/new) without including page text, API keys, or other sensitive data. Report security vulnerabilities privately using [SECURITY.md](../SECURITY.md).

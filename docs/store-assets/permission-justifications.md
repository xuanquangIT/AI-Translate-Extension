# Store Permission Justifications

Use this copy as a starting point in the Chrome Web Store and Microsoft Edge Add-ons privacy forms. Recheck it against the final manifest before every submission.

## `storage`

Stores user-configured provider profiles and credentials, language and model defaults, display preferences, reusable prompts, a bounded local translation history, and short-lived model/translation caches in extension storage. The extension has no hosted account or settings backend.

## `activeTab`

Allows LingoFlux to identify and act on the current tab when the user explicitly chooses a popup or context-menu translation action. It is used only for the user-facing translation workflow.

## `scripting`

Allows the packaged content script to be reinjected when needed to complete a user-requested context-menu action after a tab or extension lifecycle change. LingoFlux does not download or execute remote code.

## `contextMenus`

Adds the user-invoked **Translate selection** item to the browser context menu.

## `<all_urls>` host access

Allows the packaged content script to read selected or user-requested page text and insert translations on ordinary webpages. It also allows direct HTTPS requests to API hosts entered by the user because LingoFlux supports arbitrary OpenAI-compatible and Anthropic-compatible provider endpoints. The extension does not use this access for advertising, browsing-history collection, or background translation without a user action.

## Remote code declaration

**No.** All executable extension code is packaged in the submitted archive. Network responses from configured providers are parsed as data and are not executed as JavaScript or WebAssembly.

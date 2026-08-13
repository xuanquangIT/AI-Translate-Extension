# Support

LingoFlux is a community-maintained open-source project. Support is best effort and no response-time guarantee is provided.

## Where to ask

- Reproducible extension bug: use the [bug report form](https://github.com/xuanquangIT/AI-Translate-Extension/issues/new?template=bug_report.yml).
- Focused enhancement proposal: use the [feature request form](https://github.com/xuanquangIT/AI-Translate-Extension/issues/new?template=feature_request.yml).
- Usage or privacy question: open a regular [GitHub issue](https://github.com/xuanquangIT/AI-Translate-Extension/issues/new) with no sensitive data.
- Security vulnerability: follow [SECURITY.md](SECURITY.md), never a public issue.

## Before requesting help

1. Confirm the browser and extension version.
2. Reload the extension and refresh the affected webpage.
3. Check the popup, service-worker, and tab DevTools consoles separately.
4. Verify the provider base URL, compatibility type, model ID, key scope, quota, and service status.
5. Reproduce with the smallest non-sensitive sample text possible.
6. Run `npm test` and `npm run build` when reporting a source checkout problem.

## Support boundary

The project can investigate LingoFlux source, packaging, settings, provider-adapter compatibility, and browser behavior. Provider accounts, billing, rate limits, model availability, content policy, uptime, and provider-side data retention must be handled by that provider.

Never post API keys, authorization headers, `.env` contents, private page text, or unredacted provider responses.

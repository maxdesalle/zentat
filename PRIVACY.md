# Privacy Policy

**Last updated:** August 25, 2026

## Overview

Zentat is a browser extension that converts fiat currency prices to Zcash (ZEC). This policy explains how the extension handles data.

## Data Collection

Zentat does **not** collect, store, or transmit any personal data. Specifically:

- No account or sign-up required
- No analytics or telemetry
- No browsing history tracking
- No personal information collected
- No data sold or shared with third parties

## Local Storage

Zentat stores the following data locally in your browser, in the browser's **local** (non-synced) storage area:

- **User preferences**: Enabled currencies, precision and display settings, site block/allow lists, Nym toggle
- **Cached exchange rates**: Temporarily cached to reduce network requests

This data never leaves your device — it is deliberately kept out of the browser's sync storage so it is never uploaded to Google or Mozilla sync servers — and can be cleared by uninstalling the extension.

## Network Requests

Zentat makes network requests solely to fetch ZEC exchange rates:

- **CoinGecko** (`api.coingecko.com`) is the primary rate source.
- **Kraken** (`api.kraken.com`) is contacted only as an automatic fallback when CoinGecko is unavailable, and only provides USD/EUR rates.

These requests always ask for the same fixed currency list regardless of your settings, are sent without cookies or a referrer, and contain no personal or identifying information. A small random delay is added to the refresh schedule so the request cadence is not a precise fingerprint.

When the optional Nym integration is enabled, rate requests are routed through the **Nym mixnet**, which hides your IP address from the exchange rate API. Note that enabling Nym means the extension connects to Nym directory servers and gateways (`*.nymtech.net`); a network observer (such as your ISP) can see that you use Nym, though not what is sent through it. When Nym is enabled and unreachable, Zentat keeps its cached rates rather than falling back to a direct request — your IP is never sent to the rate APIs while Nym is on.

No page content, visited URLs, or any other browsing data ever appears in any network request.

## Permissions

- **Content script on all sites**: Required to detect and convert prices on webpages. No data from pages is collected or transmitted. The extension deliberately does **not** request blanket host permissions — its network access is limited to the hosts below.
- **Host permissions** — `api.coingecko.com`, `api.kraken.com`, `wss://*.nymtech.net`: The exchange rate APIs and the Nym mixnet gateways.
- **Storage**: Required to save your preferences locally.
- **Alarms**: Required to refresh exchange rates periodically.
- **activeTab**: Lets the popup's "disable on this site" button read the current tab's hostname, only when you open the popup.
- **Offscreen** (Chrome only): Required to run the Nym client.

## Contact

Questions about this policy? [Open an issue](https://github.com/maxdesalle/zentat/issues) or [reach out on Signal](https://signal.me/#eu/TST_2FkJznjly3Xkn2NnsNRDw32eoOTHwO0L9REt2N1A2fOQ_vdKEYb-C-KsvEW6).

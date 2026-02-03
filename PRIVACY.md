# Privacy Policy

**Last updated:** February 2, 2026

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

Zentat stores the following data locally in your browser (never transmitted):

- **User preferences**: Enabled currencies, precision setting, Nym toggle
- **Cached exchange rates**: Temporarily cached to reduce network requests

This data never leaves your device and can be cleared by uninstalling the extension.

## Network Requests

Zentat makes network requests solely to fetch ZEC exchange rates from CoinGecko. These requests contain no personal or identifying information.

When the optional Nym integration is enabled, requests are routed through the Nym mixnet, which hides your IP address from the exchange rate API.

## Permissions

- **Host permissions (all URLs)**: Required to detect and convert prices on webpages. No data from pages is collected or transmitted.
- **Storage**: Required to save your preferences locally.
- **Alarms**: Required to refresh exchange rates periodically.
- **Offscreen**: Required to run the Nym client (Chrome only).

## Contact

Questions about this policy? [Open an issue](https://github.com/maxdesalle/zentat/issues) or [reach out on Signal](https://signal.me/#eu/TST_2FkJznjly3Xkn2NnsNRDw32eoOTHwO0L9REt2N1A2fOQ_vdKEYb-C-KsvEW6).

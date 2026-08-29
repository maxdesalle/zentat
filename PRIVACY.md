# Privacy Policy

**Last updated:** August 25, 2026

## Overview

Zentat is a browser extension that converts fiat currency prices to Zcash (ZEC). This policy explains how the extension handles data.

## Data Collection

Zentat does **not** collect, store, or transmit any personal data. Specifically:

- No account or sign-up required
- No analytics or telemetry
- No browsing history: no URL, hostname, page title, or visit time is ever
  recorded by any feature, including practice
- No personal information collected
- No data sold or shared with third parties

## Local Storage

Zentat stores the following data locally in your browser, in the browser's **local** (non-synced) storage area:

- **User preferences**: Enabled currencies, precision and display settings, site block/allow lists, Nym toggle
- **Cached exchange rates**: Temporarily cached to reduce network requests
- **Things you entered yourself**: price anchors, and the obligations (rent, salary, subscriptions) you add in Options
- **Practice progress**: how many questions you have answered and how accurately, so the extension can show you your own improvement

This data never leaves your device — it is deliberately kept out of the browser's sync storage so it is never uploaded to Google or Mozilla sync servers — and can be cleared by uninstalling the extension.

### Practice material (off by default)

Practice normally draws on a built-in catalogue of everyday items and never
looks at the pages you visit.

You can instead let practice use prices you have actually seen converted, so it
asks about things that mean something to you. **This is off unless you turn it
on in Options.** While it is on, the extension keeps locally, for each price:

- a short label, the amount, and the currency code

and nothing else. It does **not** keep the site, the URL, the page title, or
when you saw it. The list is capped at 200 entries, with the oldest dropped
first.

One thing to be exact about, because it is the closest this comes to a trace:
a capped list has to have an order to know what to drop, so entries do sit in
the order they were first met. That order carries no times and no sites, and
meeting a price again does not move it up the list. It is the difference
between "these two were seen in this order" and a browsing history, and it is
the only ordering information that exists.

What the labels are worth saying plainly: they are product names taken from
the page next to the price, because a practice question about "47 euros, once"
teaches nothing. So while the list cannot say which sites you visited or when,
it does say something about **what you shop for**. That is the reason it is off
unless you turn it on, capped, and clearable — not a detail buried in the
implementation.

A price with no name beside it is not kept at all, and the name is looked for
only in the immediate surroundings of the price. It is never taken from the
page's own heading, which would be a record of what you were reading.

You can clear it at any time in Options, and turning the setting off clears it.

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

## Nym on Firefox

The Firefox build ships without the Nym mixnet. The `-full-fat` Nym package is a
single 22.9 MB JavaScript file, larger than Mozilla's add-on review will parse,
so carrying it meant no Firefox listing at all — and therefore no Firefox for
Android. Rate lookups on Firefox use the direct path described above.

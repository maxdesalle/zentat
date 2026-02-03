<h1 align="center">
<sub>
<img src="assets/logo-final.png" height="38" width="38">
</sub>
Zentat
</h1>
<p align="center">
<b>A privacy-focused browser extension that converts fiat prices to ZEC in real-time.</b>
</p>

<p align="center">
<a href="https://addons.mozilla.org/firefox/addon/zentat/"><img src="https://img.shields.io/badge/Firefox-Add--ons-orange?logo=firefox" alt="Firefox Add-ons"></a>
<a href="https://chromewebstore.google.com/detail/zentat/"><img src="https://img.shields.io/badge/Chrome-Web%20Store-blue?logo=googlechrome" alt="Chrome Web Store"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
</p>

---

## What is Zentat?

Zentat automatically detects and converts fiat currency prices on any webpage to [Zcash (ZEC)](https://z.cash). Browse Amazon, eBay, news sites, or any website and see prices in ZEC instead of USD, EUR, GBP, and 10+ other currencies.

**Features:**
- Real-time price conversion on any website
- Supports 13 fiat currencies (USD, EUR, GBP, JPY, CAD, AUD, CHF, CNY, KRW, INR, BRL, MXN, and more)
- Privacy-preserving exchange rate fetching via [Nym mixnet](https://nymtech.net)
- Configurable precision (auto, whole numbers, or 2 decimal places)
- Hover over converted prices to see the original amount
- Works with complex price formats (thousand separators, European notation, etc.)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER EXTENSION                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────────┐     ┌─────────────────────────┐   │
│  │   Popup     │     │   Options Page  │     │     Content Script      │   │
│  │             │     │                 │     │                         │   │
│  │ • Toggle    │     │ • Currency      │     │ • Detect prices in DOM  │   │
│  │ • Status    │     │   selection     │     │ • Parse number formats  │   │
│  │             │     │ • Precision     │     │ • Replace with ZEC      │   │
│  └──────┬──────┘     └────────┬────────┘     │ • MutationObserver for  │   │
│         │                     │              │   dynamic content       │   │
│         │                     │              └────────────┬────────────┘   │
│         │                     │                           │                │
│         └──────────┬──────────┴───────────────────────────┘                │
│                    │                                                        │
│                    ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Background Service Worker                       │   │
│  │                                                                      │   │
│  │  • Manages extension state and settings                             │   │
│  │  • Coordinates rate fetching                                        │   │
│  │  • Caches exchange rates (1-hour refresh)                           │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                           │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Offscreen Document                            │   │
│  │                                                                      │   │
│  │  • Runs Nym mixnet client (requires DOM APIs)                       │   │
│  │  • Fetches rates through mix network                                │   │
│  │  • Falls back to direct fetch if Nym unavailable                    │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                           │
└─────────────────────────────────┼───────────────────────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │        Nym Mixnet           │
                    │                             │
                    │  • 3-hop routing            │
                    │  • Sphinx packet encryption │
                    │  • Traffic mixing           │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │    CoinGecko API            │
                    │                             │
                    │  • ZEC/fiat exchange rates  │
                    └─────────────────────────────┘
```

---

## Privacy

Zentat is designed with privacy as a core principle:

### Network Privacy via Nym

Exchange rate requests are routed through the [Nym mixnet](https://nymtech.net), a decentralized privacy network that provides:

- **Unlinkability**: Your IP address is never exposed to the exchange rate API
- **Traffic analysis resistance**: Requests are mixed with other network traffic
- **Metadata protection**: Timing and packet size information is obscured

### Local-Only Data

- **No accounts**: Zentat requires no sign-up or authentication
- **No tracking**: No analytics, telemetry, or user tracking of any kind
- **No external requests** (except rate fetching): All price detection and conversion happens locally in your browser
- **Settings stored locally**: Your preferences never leave your device

### Minimal Permissions

Zentat only requests the permissions it needs:
- `activeTab`: To detect and convert prices on the current page
- `storage`: To save your preferences locally
- `offscreen`: To run the Nym client (Chrome only)

---

## Nym Integration

Zentat uses the [Nym mixnet](https://nymtech.net) to fetch exchange rates privately. The Nym network is a decentralized, incentivized mixnet that provides network-level privacy for any application.

### How it works

1. When Zentat needs fresh exchange rates, it creates a request through the Nym SDK
2. The request is encrypted in layers (like Tor's onion routing, but with mixing)
3. The request passes through 3 mix nodes, each removing one layer of encryption
4. The final mix node forwards the request to a Nym exit gateway
5. The gateway fetches the rates from CoinGecko and returns them through the mixnet

### Fallback Behavior

If the Nym network is unavailable (gateway congestion, network issues, etc.), Zentat will:
1. Attempt to connect to multiple Nym gateways
2. If all fail, fall back to direct HTTPS requests to CoinGecko
3. Display connection status in the popup

---

## Support

### Found a bug or have a feature request?

Please [open an issue](https://github.com/maxdesalle/zentat/issues) on GitHub.

### Need help or want to chat?

Reach out on Signal: **maxdesalle.01**

---

## License

Zentat is open source software licensed under the [MIT License](LICENSE).

```
MIT License

Copyright (c) 2026 Maxime Desalle

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

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

<p align="center">
<img src="assets/demo.gif" alt="Zentat demo - Before and After comparison" width="800">
</p>

**Features:**
- Real-time price conversion on any website
- Supports 13 fiat currencies (USD, EUR, GBP, JPY, CAD, AUD, CHF, CNY, KRW, INR, BRL, MXN, and more)
- Optional privacy-preserving exchange rate fetching via [Nym mixnet](https://nymtech.net)
- Configurable precision (auto, whole numbers, or 2 decimal places)
- Hover over converted prices to see the original amount
- Works with complex price formats (thousand separators, European notation, etc.)

---

## Privacy

Zentat is designed with privacy as a core principle:

- **No accounts**: Zentat requires no sign-up or authentication
- **No tracking**: No analytics, telemetry, or user tracking of any kind
- **No external requests** (except rate fetching): All price detection and conversion happens locally in your browser
- **Settings stored locally**: Your preferences never leave your device
- **Optional Nym integration**: Exchange rate requests can be routed through the [Nym mixnet](https://nymtech.net) for network-level privacy, hiding your IP address from the exchange rate API

---

## Support

Found a bug? [Open an issue](https://github.com/maxdesalle/zentat/issues) or [reach out on Signal](https://signal.me/#eu/TST_2FkJznjly3Xkn2NnsNRDw32eoOTHwO0L9REt2N1A2fOQ_vdKEYb-C-KsvEW6).

---

## License

Zentat is open source software licensed under the [MIT License](LICENSE).

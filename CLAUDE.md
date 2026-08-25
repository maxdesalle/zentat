# Zentat

## Mission

**Make it as easy as possible to use ZEC as a unit of account.**

Every decision in this codebase serves that. A unit of account is not the same as a
medium of exchange or a store of value: it means people _think, quote, compare, and
remember_ in ZEC. The product succeeds when a user knows what 1 ZEC buys without
converting in their head.

Two consequences that should settle most arguments:

- **Trust beats coverage.** A wrong price is worse than no price. Someone is about to
  spend money based on what we render. Silent failure is preferable to confident error.
- **Privacy is not a feature here, it's the audience.** Zcash users have a real threat
  model. Any claim in PRIVACY.md must be literally true of the code.

## What this is

A [WXT](https://wxt.dev) browser extension (Chrome MV3 + Firefox) that detects fiat
prices on any webpage and rewrites them inline as ZEC. No accounts, no telemetry, no
wallet, no addresses.

## Architecture

Data flows in one direction: **background fetches rates → storage → content script
converts the DOM.** The content script never touches the network.

```
src/
  entrypoints/
    background/     Rate refresh loop (alarms), keyboard command, message router
    content/        Runs on <all_urls>. index → detector → converter → observer
    popup/          Toolbar UI: rate, master toggle, per-site control
    options/        Full settings surface
    offscreen.chrome/  Chrome-only host for the Nym WASM client (needs `window`)
  lib/
    detection/      patterns (regexes) → parser (text → ParsedPrice) → walker (DOM → candidates)
    conversion/     convert (apply rate) → format (ZEC display grammar)
    rates/          provider (fallback chain) → coingecko | kraken
    storage/        settings + rates, via wxt storage
    fetch/          Fetcher abstraction: direct | nym
    nym/            Mixnet client, shared by Firefox background and Chrome offscreen
```

Rates are stored as **ZEC-per-fiat** (the reciprocal of the quoted price) so conversion
is a multiply, not a divide.

## Commands

`just` recipes wrap the package scripts. Deps are installed with **bun**.

```
just install        bun install
just dev            wxt dev (Chrome)
just dev-firefox    wxt dev -b firefox
just test           vitest
just test-e2e       playwright
just build          production build
```

## Conventions

- **TypeScript, no framework.** Plain DOM in the popup/options. Keep it that way; the
  bundle ships to every page the user visits.
- **The content script is a guest on someone else's page.** It must be cheap, must not
  break the host page, and must revert cleanly. No `innerHTML` round-trips on page
  content, no blocking paint, no polling loops.
- **Every detection change needs a regression test.** `tests/unit/parser.test.ts` is the
  record of every magnitude bug we've shipped. Add the failing case before the fix.
- **Never convert prices inside actionable controls** (buttons, checkout CTAs). The user
  pays in fiat; showing ZEC there invites a mistake.
- **No new permissions without a hard justification.** The manifest is a privacy claim.

## Gotchas

- **Ambiguous symbols.** `$` is USD/CAD/AUD/MXN and `¥` is JPY/CNY. Resolution uses TLD
  and page language (`lib/detection/locale.ts`). Getting this wrong is a 100× error.
- **Self-mutation.** The converter writes into the DOM the observer is watching. Guard
  every conversion pass or the extension feeds on its own output — converted text like
  "1.2 million ZEC" can re-match the spelled-out-multiplier pattern.
- **MV3 service workers die.** Anything assuming a long-lived background context is a
  bug. Alarms ≥1 min are the only reliable timer.
- **Nym is heavy.** The WASM bundle is large enough that Firefox AMO won't host it, which
  is why Firefox is manual-install. Weigh that cost before extending the Nym path.
- **Kraken only quotes ZEC/USD and ZEC/EUR.** Fetched rates must _merge over_ the cache,
  never replace it, or a fallback silently drops ten currencies.

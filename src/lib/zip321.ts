/**
 * ZIP-321 payment request URIs.
 *
 * NOTE ON RATES: everything here must be built from the SPOT rate, never the
 * held display rate. A held rate is a reference number for browsing; an
 * `amount=` in a payment URI is what a wallet actually sends. Off by up to the
 * band means the user overpays or the merchant is underpaid, by real money.
 *
 * The one rule that governs this whole file: the wire grammar and the display
 * grammar are different things. `formatZecWithSymbol` emits locale separators,
 * grouping, a unit suffix and sometimes zats — all four are invalid in an
 * `amount=` value, and "amount=50,000.00" is an explicit invalid example in the
 * spec. Nothing here may go near the display formatter.
 */

export const ZATS_PER_ZEC = 100_000_000;
const MAX_ZEC = 21_000_000;
const MAX_MEMO_BYTES = 512;

/** Addresses that can carry a memo. A memo on a transparent address makes the
 * ENTIRE URI invalid per the spec — not merely ignored. */
const SHIELDED_PREFIXES = ['u1', 'zs', 'utest1', 'ztestsapling'];

export function isShieldedAddress(address: string): boolean {
  return SHIELDED_PREFIXES.some((prefix) => address.startsWith(prefix));
}

export function isZcashAddress(address: string): boolean {
  return /^(u1[0-9a-z]{40,}|zs1[0-9a-z]{60,}|t[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(address)
    || /^(utest1[0-9a-z]{40,}|ztestsapling1[0-9a-z]{60,}|t[m2][1-9A-HJ-NP-Za-km-z]{25,34})$/
      .test(address);
}

/**
 * Serialise ZEC for the wire: locale-independent, no grouping, at most eight
 * fraction digits, both an integer and a fraction part present.
 */
export function serializeAmount(zec: number): string | null {
  if (!Number.isFinite(zec) || zec > MAX_ZEC) return null;
  const zats = Math.round(zec * ZATS_PER_ZEC);
  // Everything non-positive rounds to nothing here, as does anything under a
  // single zatoshi, and none of those is an amount a wallet could pay.
  if (zats <= 0) return null;
  const whole = Math.floor(zats / ZATS_PER_ZEC);
  const fraction = String(zats % ZATS_PER_ZEC).padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * Percent-encode a qchar value. Deliberately encodeURIComponent and not
 * URLSearchParams: the latter serialises a space as "+", which a conformant
 * parser reads as a literal plus sign, silently corrupting every message.
 */
function encodeValue(value: string): string {
  return encodeURIComponent(value);
}

/** base64url, unpadded — "+", "/" and "=" must all be rejected by parsers. */
export function encodeMemo(memo: string): string | null {
  const bytes = new TextEncoder().encode(memo);
  if (bytes.length > MAX_MEMO_BYTES) return null;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
  // Stryker disable next-line Regex: btoa pads only at the end; the anchor cannot change that.
  return base64url.replace(/=+$/, '');
}

export interface PaymentRequest {
  address: string;
  zecAmount: number;
  /** Human-readable note. Percent-encoded; safe on any address type. */
  message?: string;
  /** Private note carried on-chain. Shielded addresses only. */
  memo?: string;
  label?: string;
}

/**
 * Build a `zcash:` URI, or null if the request cannot be expressed validly.
 * Returning null rather than a best-effort string is deliberate: a malformed
 * payment URI is worse than no button.
 */
export function buildPaymentUri(request: PaymentRequest): string | null {
  const { address, zecAmount, message, memo, label } = request;
  if (!isZcashAddress(address)) return null;

  const amount = serializeAmount(zecAmount);
  if (amount === null) return null;

  // Not "ignore the memo" — the spec says the whole URI is invalid.
  if (memo && !isShieldedAddress(address)) return null;

  const params = [`amount=${amount}`];
  if (memo) {
    const encoded = encodeMemo(memo);
    if (encoded === null) return null;
    params.push(`memo=${encoded}`);
  }
  if (label) params.push(`label=${encodeValue(label)}`);
  if (message) params.push(`message=${encodeValue(message)}`);

  // The address goes in the hier-part unencoded: percent-encoding is illegal
  // outside label/message/otherparam, so the URI must never be run through
  // encodeURI as a whole.
  return `zcash:${address}?${params.join('&')}`;
}

/** Addresses visible in a page, so a request can be built without the user
 * pasting anything and without Zentat ever storing an address. */
export function findAddressesIn(text: string): string[] {
  const found = new Set<string>();
  const candidates = text.match(
    /\b(?:u1[0-9a-z]{40,}|zs1[0-9a-z]{60,}|t[13][1-9A-HJ-NP-Za-km-z]{25,34})\b/g,
  );
  // Every alternative in that pattern is also an alternative of isZcashAddress,
  // so a match is already well formed; buildPaymentUri checks again before the
  // address reaches a URI. Loosening the scan loosens what comes out of here.
  for (const candidate of candidates ?? []) found.add(candidate);
  return [...found];
}

import { textOf } from '../../lib/detection/dom';
import { qrSvg } from '../../lib/qr';
import type { RatesData } from '../../lib/storage/rates';
import { buildPaymentUri, findAddressesIn } from '../../lib/zip321';

/**
 * Turn a converted price into a payment request — but only where the page has
 * already published an address.
 *
 * This is the one mode that requires no address handling from Zentat at all:
 * no key material, no storage, no per-domain record of who the user pays. The
 * page supplies the recipient; we supply the amount and a QR. If the page has
 * no address, there is no offer.
 *
 * The amount is always computed from SPOT, never the held rate. A held rate is
 * a reference number for browsing; an `amount=` is what a wallet actually
 * sends, so being off by the band means the user overpays or the merchant is
 * underpaid, in real money.
 */

let panel: HTMLElement | null = null;

/** The first Zcash address published anywhere in the page, or null. */
export function pageAddress(): string | null {
  const text = textOf(document.body);
  // Bounded: this runs on arbitrary pages and the scan is a regex over text.
  return findAddressesIn(text.slice(0, 200_000))[0] ?? null;
}

export function closePaymentPanel(): void {
  panel?.remove();
  panel = null;
}

/**
 * Show a payment request for `zecAmount` to the address the page published.
 *
 * Returns false when there is nothing to offer, so the caller can stay quiet
 * rather than showing an empty affordance.
 */
export function showPaymentRequest(
  zecAmount: number,
  originalPrice: string,
  spot: RatesData,
): boolean {
  const address = pageAddress();
  if (!address) return false;

  const uri = buildPaymentUri({
    address,
    zecAmount,
    message: `${originalPrice} at ${new Date(spot.updatedAt).toISOString().slice(0, 16)}Z`,
  });
  if (!uri) return false;

  const svg = qrSvg(uri, { size: 200 });
  if (!svg) return false;

  closePaymentPanel();
  panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Payment request');
  panel.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'inset-block-end:24px',
    'inset-inline-end:24px',
    'padding:16px',
    'border-radius:14px',
    'background:#ffffff',
    'color:#17171a',
    'box-shadow:0 8px 32px rgba(0,0,0,0.32)',
    'font:13px/1.5 system-ui,sans-serif',
    'text-align:center',
  ].join(';');

  // Parsed rather than assigned to innerHTML. The SVG is our own generator's
  // output, so this is not a security fix — it is that an innerHTML assignment
  // in an extension is an automatic review flag, and there is no reason to
  // carry one for markup we can parse explicitly.
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const qrNode = parsed.documentElement;
  // Unreachable in practice — qrSvg either returns an <svg> or null, and null
  // was handled above. Kept because the alternative to checking is importing
  // whatever the parser produced into the page, and a parse guard that is only
  // correct as long as its input never changes is not a guard at all.
  /* v8 ignore next */
  if (qrNode.nodeName.toLowerCase() !== 'svg') return false;
  panel.appendChild(document.importNode(qrNode, true));

  const amountLine = document.createElement('div');
  amountLine.textContent = `${zecAmount.toFixed(8)} ZEC`;
  amountLine.style.cssText = 'margin-block-start:10px;font-weight:600';
  panel.appendChild(amountLine);

  // The rate is named because the user is about to move money on it.
  const rateLine = document.createElement('div');
  rateLine.textContent = `${originalPrice} at the market rate`;
  rateLine.style.cssText = 'color:#5c5c66;font-size:12px';
  panel.appendChild(rateLine);

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.style.cssText = 'margin-block-start:12px;padding:6px 14px;border:0;border-radius:8px;'
    + 'background:#f2f1ee;color:#17171a;font:inherit;cursor:pointer';
  close.addEventListener('click', closePaymentPanel);
  panel.appendChild(close);

  document.body.appendChild(panel);
  close.focus();
  return true;
}

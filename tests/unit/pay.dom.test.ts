// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => null,
      setValue: async () => {},
      watch: () => () => {},
    }),
  },
}));

// Standing in for the QR generator is the only way to reach the panel's check
// on what came back from it. The real generator returns an <svg> or nothing, so
// the day it returns anything else is the day something upstream changed.
let qrOverride: ((text: string) => string | null) | null = null;

vi.mock('../../src/lib/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/qr')>();
  return {
    ...actual,
    qrSvg: (text: string, options?: QrOptions) =>
      qrOverride ? qrOverride(text) : actual.qrSvg(text, options),
  };
});

import {
  closePaymentPanel,
  pageAddress,
  showPaymentRequest,
} from '../../src/entrypoints/content/pay';
import type { QrOptions } from '../../src/lib/qr';
import type { RatesData } from '../../src/lib/storage/rates';

const UA = 'u1' + 'a'.repeat(60);
const spot: RatesData = { rates: { USD: 0.00125 }, updatedAt: 1_700_000_000_000, source: 'test' };

/** The panel, opened over a page that publishes an address. */
function openPanel(price = '$19.99'): HTMLElement {
  document.body.innerHTML = `<p>${UA}</p>`;
  expect(showPaymentRequest(0.025, price, spot)).toBe(true);
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
}

beforeEach(() => {
  document.body.innerHTML = '';
  qrOverride = null;
  closePaymentPanel();
});

describe('payment requests come from the page, not from us', () => {
  describe('given the page published an address', () => {
    it('finds an address the page published', () => {
      document.body.innerHTML = `<p>Tip me: ${UA}</p>`;
      expect(pageAddress()).toBe(UA);
    });

    it('renders a QR and names the rate when it can', () => {
      document.body.innerHTML = `<p>Donate ${UA}</p>`;
      expect(showPaymentRequest(0.025, '$19.99', spot)).toBe(true);

      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.querySelector('svg')).not.toBeNull();
      expect(dialog.textContent).toContain('0.02500000 ZEC');
      // The user is about to move money, so the rate is stated.
      expect(dialog.textContent).toContain('market rate');
    });

    it('names itself so a screen reader can announce it', () => {
      // Money is moving. An unnamed box is not something anyone should be asked
      // to act on without being told what it is.
      expect(openPanel().getAttribute('aria-label')).toBe('Payment request');
    });

    it('draws the whole QR at the size the panel gives it', () => {
      const svg = openPanel().querySelector('svg')!;
      // An empty frame, or one wider than the panel that holds it, looks
      // exactly like a working QR and scans like nothing at all.
      expect(svg.getAttribute('width')).toBe('200');
      expect(svg.getAttribute('height')).toBe('200');
      expect(svg.querySelector('path')?.getAttribute('d')).toBeTruthy();
    });

    it('floats above the page in a corner of the viewport', () => {
      const style = openPanel().style;
      // The panel is a guest on a page whose stacking and scrolling it cannot
      // predict. Pinned to the viewport, above everything, is the only place a
      // payment request cannot end up behind the page or scrolled out of sight.
      expect(style.position).toBe('fixed');
      expect(style.zIndex).toBe('2147483647');
      expect(style.insetBlockEnd).toBe('24px');
      expect(style.insetInlineEnd).toBe('24px');
    });

    it('brings its own colours and type rather than inheriting them', () => {
      const style = openPanel().style;
      // Host pages set global styles we have no say in. Everything the amount
      // needs to be readable — a surface to sit on, a colour that contrasts
      // with it, a text size — the panel states for itself, or a page with
      // white text and a display font gets to decide how money reads.
      expect(style.background).toBe('#ffffff');
      expect(style.color).toBe('#17171a');
      expect(style.fontSize).toBe('13px');
      expect(style.fontFamily).toBe('system-ui, sans-serif');
      expect(style.padding).toBe('16px');
      expect(style.textAlign).toBe('center');
      // Rounding and a shadow are what separate the panel from the page behind
      // it; without them its edge is wherever the page's own white ends.
      expect(style.borderRadius).toBe('14px');
      expect(style.boxShadow).toBe('0 8px 32px rgba(0,0,0,0.32)');
    });

    it('sets the amount apart from the rate line beneath it', () => {
      const [amount, rate] = openPanel().querySelectorAll<HTMLElement>('div');
      // Two numbers sit in this panel and only one of them is being paid. If
      // they render alike, the user has to work out which is which.
      expect(amount.style.fontWeight).toBe('600');
      expect(amount.style.marginBlockStart).toBe('10px');
      expect(rate.style.color).toBe('#5c5c66');
      expect(rate.style.fontSize).toBe('12px');
    });

    it('offers a close button that cannot submit a form on the page', () => {
      const close = openPanel().querySelector('button')!;
      // A button defaults to submit. This one is inserted into pages we do not
      // control, and a stray submit navigates the user away mid-payment.
      expect(close.type).toBe('button');
      expect(close.textContent).toBe('Close');
      // It has to read as a control on a page whose button styling it never
      // sees, so it carries its own.
      expect(close.style.padding).toBe('6px 14px');
      expect(close.style.borderRadius).toBe('8px');
      expect(close.style.background).toBe('#f2f1ee');
      expect(close.style.cursor).toBe('pointer');
      expect(close.style.font).toBe('inherit');
    });

    it('gives the close button keyboard focus', () => {
      const close = openPanel().querySelector('button')!;
      // Someone on a keyboard or a screen reader is otherwise left wherever
      // they were on the page, with a payment dialog they cannot reach.
      expect(document.activeElement).toBe(close);
    });
  });

  describe('given the page has no address', () => {
    it('offers nothing', () => {
      document.body.innerHTML = '<p>$19.99</p>';
      expect(pageAddress()).toBeNull();
      // No address means no offer — we never ask the user to supply one, and we
      // never store one.
      expect(showPaymentRequest(0.025, '$19.99', spot)).toBe(false);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
  });

  describe('when the page is longer than the address scan', () => {
    it('ignores an address past the end of the scan', () => {
      // The scan is a regex over the text of an arbitrary page, so it is
      // bounded. An address beyond the bound is one we do not see, which is the
      // price of never letting a hostile page stall the content script.
      document.body.textContent = `${'x'.repeat(200_000)} ${UA}`;
      expect(pageAddress()).toBeNull();
    });
  });

  describe('given the amount cannot be expressed as a payment request', () => {
    it('offers nothing', () => {
      // ZIP-321 cannot express zero, and a URI a wallet rejects is worse than
      // no button at all.
      document.body.innerHTML = `<p>${UA}</p>`;
      expect(showPaymentRequest(0, '$0.00', spot)).toBe(false);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
  });

  describe('given the amount is too large to fit a QR', () => {
    it('offers nothing', () => {
      // No QR is recoverable; a truncated one is not.
      document.body.innerHTML = `<p>${UA}</p>`;
      const huge = 'x'.repeat(4000);
      expect(showPaymentRequest(0.025, huge, spot)).toBe(false);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
  });

  describe('when the request only just fits a QR', () => {
    it('still offers the payment request', () => {
      // The price label is whatever the page said, so it can be long, and the
      // largest QR there is has a last usable character. The timestamp in the
      // message is carried to the minute for that reason: seconds and
      // milliseconds are precision we do not have, and here they would cost the
      // request the room it needs to be shown at all.
      expect(openPanel('x'.repeat(2214)).querySelector('svg')).not.toBeNull();
    });
  });

  describe('given the QR generator returns markup that is not an SVG', () => {
    it('offers nothing', () => {
      // Whatever came back is not going into the page. A payment panel built
      // around markup we did not recognise is one we cannot vouch for.
      qrOverride = () => '<div>not a qr</div>';
      document.body.innerHTML = `<p>${UA}</p>`;
      expect(showPaymentRequest(0.025, '$19.99', spot)).toBe(false);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
  });

  describe('given a panel is already open', () => {
    it('replaces a previous panel rather than stacking them', () => {
      document.body.innerHTML = `<p>${UA}</p>`;
      showPaymentRequest(0.025, '$19.99', spot);
      showPaymentRequest(0.05, '$39.99', spot);
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    });
  });

  describe('when the panel is dismissed', () => {
    it('closes cleanly', () => {
      document.body.innerHTML = `<p>${UA}</p>`;
      showPaymentRequest(0.025, '$19.99', spot);
      closePaymentPanel();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('closes when its own button is pressed', () => {
      const close = openPanel().querySelector('button')!;
      close.click();
      // The panel covers part of the page it sits on. Its own control is the
      // only way out a user has.
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
  });
});

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

import {
  closePaymentPanel,
  pageAddress,
  showPaymentRequest,
} from '../../src/entrypoints/content/pay';
import type { RatesData } from '../../src/lib/storage/rates';

const UA = 'u1' + 'a'.repeat(60);
const spot: RatesData = { rates: { USD: 0.00125 }, updatedAt: 1_700_000_000_000, source: 'test' };

beforeEach(() => {
  document.body.innerHTML = '';
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
  });
});

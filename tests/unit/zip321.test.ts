import { describe, expect, it } from 'vitest';
import {
  buildPaymentUri,
  encodeMemo,
  findAddressesIn,
  isShieldedAddress,
  serializeAmount,
} from '../../src/lib/zip321';

// Spec: tests/trees/zip321.tree

const UA = 'u1' + 'a'.repeat(60);
const SAPLING = 'zs1' + 'b'.repeat(70);
const TRANSPARENT = 't1Jz2y8kCkfnFhVN3Xu5RcVhrGbMoNTvhcE';

describe('serializeAmount', () => {
  it('never emits grouping separators', () => {
    // "amount=50,000.00" is an explicit invalid example in the spec.
    expect(serializeAmount(50_000)).toBe('50000');
    expect(buildPaymentUri({ address: UA, zecAmount: 50_000 })).toContain('amount=50000');
  });

  it('emits at most eight fraction digits and trims trailing zeros', () => {
    expect(serializeAmount(0.05732841)).toBe('0.05732841');
    expect(serializeAmount(1.5)).toBe('1.5');
    expect(serializeAmount(2)).toBe('2');
  });

  describe('given an amount outside what the protocol can express', () => {
    it('refuses a non-positive amount', () => {
      expect(serializeAmount(0)).toBeNull();
      expect(serializeAmount(-1)).toBeNull();
    });

    it('refuses more than the supply', () => {
      expect(serializeAmount(21_000_001)).toBeNull();
    });

    it('refuses something that is not a number', () => {
      expect(serializeAmount(Number.NaN)).toBeNull();
    });

    it('refuses less than one zatoshi', () => {
      // Below one zatoshi there is nothing to request.
      expect(serializeAmount(1e-9)).toBeNull();
    });
  });
});

describe('isShieldedAddress', () => {
  it('knows which addresses can carry a memo', () => {
    expect(isShieldedAddress(UA)).toBe(true);
    expect(isShieldedAddress(SAPLING)).toBe(true);
    expect(isShieldedAddress(TRANSPARENT)).toBe(false);
  });
});

describe('encodeMemo', () => {
  it('uses unpadded base64url for memos', () => {
    const encoded = encodeMemo('invoice #42')!;
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('refuses a memo over 512 bytes, counting bytes not characters', () => {
    expect(encodeMemo('a'.repeat(513))).toBeNull();
    // Four bytes per emoji, so 129 of them is over budget at 129 characters.
    expect(encodeMemo('😀'.repeat(129))).toBeNull();
  });
});

describe('buildPaymentUri', () => {
  it('encodes a space as %20, never as +', () => {
    // URLSearchParams would write "+", which a conformant parser reads as a
    // literal plus sign — silent corruption of every message.
    const uri = buildPaymentUri({ address: UA, zecAmount: 1, message: 'Order 12 USD' })!;
    expect(uri).toContain('message=Order%2012%20USD');
    expect(uri).not.toContain('+');
  });

  it('leaves the address unencoded', () => {
    // Percent-encoding is illegal outside label/message/otherparam, so the
    // hier-part must never be run through an encoder.
    expect(buildPaymentUri({ address: UA, zecAmount: 1 })!).toContain(`zcash:${UA}?`);
  });

  it('never invents a req- parameter', () => {
    // An unrecognised req-* makes conformant parsers reject the whole URI.
    const uri = buildPaymentUri({ address: UA, zecAmount: 1, message: 'x' })!;
    expect(uri).not.toContain('req-');
  });

  describe('when a label is given', () => {
    it('includes the label', () => {
      const uri = buildPaymentUri({ address: UA, zecAmount: 1, label: 'Coffee Shop' })!;
      expect(uri).toContain('label=Coffee%20Shop');
    });
  });

  describe('given a memo', () => {
    describe('given the address can carry one', () => {
      it('includes the memo', () => {
        expect(buildPaymentUri({ address: SAPLING, zecAmount: 1, memo: 'hi' })).toContain('memo=');
      });
    });

    describe('given the address cannot carry one', () => {
      it('invalidates the whole request rather than dropping a memo', () => {
        // The spec is explicit: a memo against an address that cannot carry
        // one makes the ENTIRE URI invalid. Dropping it silently would send a
        // payment stripped of the thing that identifies it.
        expect(buildPaymentUri({ address: TRANSPARENT, zecAmount: 1, memo: 'hi' })).toBeNull();
      });
    });

    describe('given the memo is too long', () => {
      it('refuses the whole request', () => {
        expect(buildPaymentUri({ address: UA, zecAmount: 1, memo: 'a'.repeat(513) })).toBeNull();
      });
    });
  });

  describe('given an address that is not a Zcash address', () => {
    it('refuses', () => {
      expect(buildPaymentUri({ address: 'bc1qsomethingelse', zecAmount: 1 })).toBeNull();
      expect(buildPaymentUri({ address: '', zecAmount: 1 })).toBeNull();
    });
  });

  describe('given an amount the protocol cannot express', () => {
    it('refuses', () => {
      expect(buildPaymentUri({ address: UA, zecAmount: 0 })).toBeNull();
    });
  });
});

describe('findAddressesIn', () => {
  it('finds addresses already published on the page', () => {
    const text = `Donate to ${UA} or ${TRANSPARENT}. Not an address: hello.`;
    expect(findAddressesIn(text)).toEqual([UA, TRANSPARENT]);
  });

  describe('given no address in the text', () => {
    it('finds nothing', () => {
      expect(findAddressesIn('Just some ordinary page copy.')).toEqual([]);
    });
  });
});

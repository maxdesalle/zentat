import { describe, expect, it } from 'vitest';
import {
  buildPaymentUri,
  encodeMemo,
  findAddressesIn,
  isShieldedAddress,
  isZcashAddress,
  serializeAmount,
} from '../../src/lib/zip321';

// Spec: tests/trees/zip321.tree

const UA = 'u1' + 'a'.repeat(60);
const SAPLING = 'zs1' + 'b'.repeat(70);
const TRANSPARENT = 't1Jz2y8kCkfnFhVN3Xu5RcVhrGbMoNTvhcE';

const UA_TESTNET = 'utest1' + 'c'.repeat(60);
const SAPLING_TESTNET = 'ztestsapling1' + 'd'.repeat(70);
const TRANSPARENT_TESTNET = 'tmEZhbWHTFhPTh1Qw72Zgmt1fKzMktFHXe6';

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

  it('accepts the entire supply', () => {
    // The cap is inclusive. 21,000,000 ZEC is a legal amount, and the line
    // between legal and refused has to sit exactly where the protocol puts it.
    expect(serializeAmount(21_000_000)).toBe('21000000');
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

describe('isZcashAddress', () => {
  it('accepts every mainnet address type', () => {
    // Transparent addresses are the ones a merchant is most likely to publish
    // in plain text, so refusing them is refusing most of the pages we help on.
    expect(isZcashAddress(UA)).toBe(true);
    expect(isZcashAddress(SAPLING)).toBe(true);
    expect(isZcashAddress(TRANSPARENT)).toBe(true);
  });

  it('accepts testnet addresses', () => {
    // Testnet is where anyone auditing this extension points it first, and a
    // testnet address rejected here means no payment request at all there.
    expect(isZcashAddress(UA_TESTNET)).toBe(true);
    expect(isZcashAddress(SAPLING_TESTNET)).toBe(true);
    expect(isZcashAddress(TRANSPARENT_TESTNET)).toBe(true);
  });

  it('refuses a string that merely contains an address', () => {
    // Paying the wrong recipient is unrecoverable, so a string with anything
    // stuck to either end of an address must not pass as one.
    expect(isZcashAddress(`x${UA}`)).toBe(false);
    expect(isZcashAddress(`${UA}!`)).toBe(false);
    expect(isZcashAddress(`x${UA_TESTNET}`)).toBe(false);
    expect(isZcashAddress(`${UA_TESTNET}!`)).toBe(false);
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

  it('accepts a memo of exactly 512 bytes', () => {
    // The budget is inclusive. Refusing the last byte would quietly shorten
    // the only place in a payment where the user gets to say anything.
    expect(encodeMemo('a'.repeat(512))).not.toBeNull();
  });

  it('rewrites the two characters plain base64 would leak into the URI', () => {
    // High bytes are what reach the last two base64 characters. A "+" left in
    // is read back as a space, so the note written on-chain is not the note
    // that was typed, and a "/" ends the value early for some parsers.
    expect(encodeMemo('🎁 für ÿ')).toBe('8J-OgSBmw7xyIMO_');
  });

  it('drops every padding character, not just the last', () => {
    // Seven bytes pad twice. One "=" left behind is a value a conformant
    // wallet rejects outright, which loses the whole payment request.
    expect(encodeMemo('invoice')).toBe('aW52b2ljZQ');
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

  it('carries only the parameters the request named', () => {
    // An absent field has to be absent, not the word "undefined": a memo is
    // written on-chain permanently, and a label is what the user reads back
    // before approving the payment.
    expect(buildPaymentUri({ address: UA, zecAmount: 1 })).toBe(`zcash:${UA}?amount=1`);
  });

  it('separates the parameters it does carry', () => {
    // Run together, the amount swallows everything after it and the wallet
    // sees one unparseable value where four were meant.
    const uri = buildPaymentUri({
      address: SAPLING,
      zecAmount: 1.5,
      memo: 'hi',
      label: 'Coffee Shop',
      message: 'Order 12 USD',
    });
    expect(uri).toBe(
      `zcash:${SAPLING}?amount=1.5&memo=aGk&label=Coffee%20Shop&message=Order%2012%20USD`,
    );
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
    const text = `Donate to ${UA}, ${SAPLING} or ${TRANSPARENT}. Not an address: hello.`;
    expect(findAddressesIn(text)).toEqual([UA, SAPLING, TRANSPARENT]);
  });

  describe('given no address in the text', () => {
    it('finds nothing', () => {
      expect(findAddressesIn('Just some ordinary page copy.')).toEqual([]);
    });
  });
});

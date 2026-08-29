import { describe, expect, it } from 'vitest';
import {
  clearSeen,
  MAX_SEEN,
  remember,
  seenItems,
  type SeenPrice,
} from '../../src/lib/practice/seen';

// Spec: tests/trees/practice.seen.tree

const price = (label: string, amount = 5, currency = 'USD'): SeenPrice => ({
  label,
  amount,
  currency,
});

/** A store sitting exactly on the cap, each label naming its own position. */
const fullStore = (): SeenPrice[] =>
  Array.from({ length: MAX_SEEN }, (_, index) => price(`item ${index}`));

describe('remember', () => {
  it('keeps a price the user actually saw', () => {
    expect(remember([], price('flat white', 3.4, 'EUR'))).toEqual([
      { label: 'flat white', amount: 3.4, currency: 'EUR' },
    ]);
  });

  it('stores nothing beyond a label, an amount and a currency', () => {
    // The whole privacy claim in one assertion: a caller that hands us where
    // and when must not have that survive into the store.
    const stored = remember([], {
      label: 'mug',
      amount: 9,
      currency: 'USD',
      hostname: 'shop.example.com',
      url: 'https://shop.example.com/mug',
      seenAt: 1_756_000_000_000,
    } as SeenPrice);
    expect(Object.keys(stored[0])).toEqual(['label', 'amount', 'currency']);
    expect(JSON.stringify(stored)).not.toContain('shop.example');
    expect(JSON.stringify(stored)).not.toContain('1756000000000');
  });

  it('normalises the currency to an upper-case code', () => {
    expect(remember([], price('tea', 2, 'eur'))[0].currency).toBe('EUR');
  });

  it('collapses untidy whitespace in a label', () => {
    // Text lifted off a page arrives wrapped and indented; storing that raw
    // would make the same coffee dedupe as two different entries.
    expect(remember([], price('  flat\n\twhite  '))[0].label).toBe('flat white');
  });

  it('refuses a label that is empty once tidied', () => {
    const store = [price('mug')];
    expect(remember(store, price('   \n  '))).toBe(store);
  });

  it('refuses a label that is not text', () => {
    // Corrupt storage, not a name. Coercion would store "undefined" as a
    // perfectly ordinary-looking product.
    const store = [price('mug')];
    expect(remember(store, price(42 as unknown as string))).toBe(store);
    expect(remember(store, price(undefined as unknown as string))).toBe(store);
  });

  it('leaves the store it was given untouched', () => {
    const store = [price('mug')];
    remember(store, price('kettle'));
    expect(store).toEqual([price('mug')]);
  });

  describe('given the same price again', () => {
    it('does not store it twice', () => {
      const store = remember([], price('mug', 9, 'USD'));
      expect(remember(store, price('mug', 9, 'usd'))).toHaveLength(1);
      // Near misses are different prices, not duplicates: only all three
      // fields matching makes an entry the same entry.
      expect(remember(store, price('mug', 12, 'USD'))).toHaveLength(2);
      expect(remember(store, price('mug', 9, 'EUR'))).toHaveLength(2);
      expect(remember(store, price('kettle', 9, 'USD'))).toHaveLength(2);
    });

    it('leaves the earlier entry where it was', () => {
      // Re-appending would make position track recency, which is the ordering
      // signal this store is built to not carry.
      const store = [price('mug'), price('kettle')];
      expect(remember(store, price('mug'))).toBe(store);
    });
  });

  describe('given a label longer than a product name', () => {
    it('truncates a merely long one', () => {
      expect(remember([], price('x'.repeat(41)))[0].label).toBe('x'.repeat(40));
      expect(remember([], price('x'.repeat(40)))[0].label).toBe('x'.repeat(40));
    });

    it('refuses one no product name could be', () => {
      // Truncating a page-length string would silently keep the first forty
      // characters of a sentence about the user.
      const store = [price('mug')];
      expect(remember(store, price('x'.repeat(121)))).toBe(store);
      expect(remember(store, price('x'.repeat(120)))).toHaveLength(2);
    });
  });

  describe('given a label that carries more than a name', () => {
    it('refuses a hostname', () => {
      const store = [price('mug')];
      expect(remember(store, price('shoes at nike.com'))).toBe(store);
    });

    it('refuses a URL', () => {
      // A dotless host still has a scheme, which is why that rule is separate.
      const store = [price('mug')];
      expect(remember(store, price('http://localhost/cart'))).toBe(store);
    });

    it('refuses an address or a handle', () => {
      const store = [price('mug')];
      expect(remember(store, price('gift for me@example'))).toBe(store);
    });

    it('refuses a long run of digits', () => {
      const store = [price('mug')];
      expect(remember(store, price('order 100238471'))).toBe(store);
      // Model names run to four digits and must survive.
      expect(remember(store, price('Sony WH-1000XM5'))).toHaveLength(2);
    });

    it('reads the whole label, not the part it would keep', () => {
      // Checking after truncation would let a locator past character forty
      // through, and the cut would then hide it rather than stop it.
      const store = [price('mug')];
      expect(remember(store, price(`${'x'.repeat(45)} nike.com`))).toBe(store);
    });
  });

  describe('given an amount that cannot be a price', () => {
    it('refuses a non-finite amount', () => {
      const store = [price('mug')];
      expect(remember(store, price('mug', Number.NaN))).toBe(store);
      expect(remember(store, price('mug', Number.POSITIVE_INFINITY))).toBe(store);
    });

    it('refuses zero', () => {
      const store = [price('mug')];
      expect(remember(store, price('mug', 0))).toBe(store);
    });

    it('refuses a negative amount', () => {
      const store = [price('mug')];
      expect(remember(store, price('mug', -5))).toBe(store);
    });

    it('refuses something that is not a number', () => {
      // '5' > 0 is true, so the finiteness check is what stops a string here.
      const store = [price('mug')];
      expect(remember(store, price('mug', '5' as unknown as number))).toBe(store);
    });
  });

  describe('given a currency that is not a three-letter code', () => {
    it('refuses a two-letter code', () => {
      const store = [price('mug')];
      expect(remember(store, price('mug', 5, 'US'))).toBe(store);
    });

    it('refuses a word', () => {
      // Otherwise the currency field becomes a second place to put text.
      const store = [price('mug')];
      expect(remember(store, price('mug', 5, 'dollars'))).toBe(store);
    });
  });

  describe('given the store is full', () => {
    it('evicts the oldest entry', () => {
      const next = remember(fullStore(), price('new one'));
      expect(next[0].label).toBe('item 1');
      expect(next.at(-1)?.label).toBe('new one');
    });

    it('never grows past the cap', () => {
      expect(remember(fullStore(), price('new one'))).toHaveLength(MAX_SEEN);
    });

    it('trims a store that arrived over the cap', () => {
      // What a store written before MAX_SEEN was lowered looks like.
      const over = [...fullStore(), price('spill one'), price('spill two')];
      const next = remember(over, price('new one'));
      expect(next).toHaveLength(MAX_SEEN);
      expect(next[0].label).toBe('item 3');
    });
  });
});

describe('seenItems', () => {
  it('marks every item as seen', () => {
    const [item] = seenItems([price('mug', 9)]);
    // Source is how a caller knows the category is a placeholder rather than
    // a claim about what the thing is.
    expect(item.source).toBe('seen');
    expect(item.category).toBe('services');
    expect(item.emoji).toBe('🏷️');
  });

  it('carries the label, amount and currency through', () => {
    expect(seenItems([price('flat white', 3.4, 'EUR')])[0]).toMatchObject({
      label: 'flat white',
      amount: 3.4,
      currency: 'EUR',
    });
  });

  it('gives each item an id derived from its content', () => {
    const ids = seenItems(fullStore()).map((item) => item.id);
    expect(new Set(ids).size).toBe(MAX_SEEN);
    expect(seenItems([price('mug')])[0].id).toBe(seenItems([price('mug')])[0].id);
  });

  it('gives an entry the same id wherever it sits', () => {
    // An index-based id would re-point a recorded answer at a different price
    // the first time the cap bit.
    const before = seenItems([price('kettle'), price('mug')]);
    const after = seenItems([price('mug')]);
    expect(after[0].id).toBe(before[1].id);
  });

  it('drops an entry the store should never have held', () => {
    // Storage written by an older build, or edited by hand, gets the same
    // scrutiny as a fresh call: a price we cannot vouch for teaches a wrong
    // number, and a locator would be shown back to the user as a product.
    const items = seenItems([
      price('mug'),
      price('receipt', Number.NaN),
      price('https://shop.example.com/mug'),
    ]);
    expect(items.map((item) => item.label)).toEqual(['mug']);
  });

  it('asks about nothing when the store is empty', () => {
    expect(seenItems([])).toEqual([]);
  });
});

describe('clearSeen', () => {
  it('empties the store', () => {
    expect(clearSeen()).toEqual([]);
  });

  it('hands back a fresh array each time', () => {
    // A shared empty, once mutated by one caller, repopulates everybody
    // else's cleared store.
    expect(clearSeen()).not.toBe(clearSeen());
  });
});

import { describe, expect, it } from 'vitest';
import { MODES } from '../../src/lib/practice/modes';

// Spec: tests/trees/practice.modes.tree

describe('MODES', () => {
  describe('given the registry', () => {
    it('offers every mode exactly once', () => {
      const ids = MODES.map((mode) => mode.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(['to-zec', 'from-zec', 'comparison', 'budget', 'judgement', 'rate']);
    });

    it('gives every mode something to show the user', () => {
      // The picker renders these directly, so an empty one is a blank button.
      for (const mode of MODES) {
        expect(mode.title.length).toBeGreaterThan(0);
        expect(mode.blurb.length).toBeGreaterThan(0);
      }
    });
  });

  describe('given a context nothing can be asked from', () => {
    it('lets every mode decline rather than invent a question', () => {
      // The one property the session flow depends on: a mode that cannot ask
      // honestly must answer null, so the caller can fall through to the next.
      // A mode that threw, or returned a question built on no rate, would put a
      // wrong number in front of someone about to spend money.
      const empty = {
        items: [],
        rates: { rates: {}, updatedAt: 0, source: 'test' },
        currency: 'USD',
        held: null,
        liabilities: [],
        pick: () => 0,
      };
      for (const mode of MODES) {
        expect(mode.ask(empty)).toBeNull();
      }
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Spec: tests/trees/practice.storage.tree

const store = new Map<string, unknown>();

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: (key: string, opts: { fallback: unknown }) => ({
      getValue: async () => (store.has(key) ? store.get(key) : opts.fallback),
      setValue: async (value: unknown) => {
        store.set(key, value);
      },
      watch: () => () => {},
    }),
  },
}));

const { clearSeenPrices, getSeenPrices, setSeenPrices } = await import(
  '../../src/lib/storage/practice'
);

beforeEach(() => {
  store.clear();
});

describe('practice material storage', () => {
  describe('given nothing has been stored', () => {
    it('reads as empty', async () => {
      expect(await getSeenPrices()).toEqual([]);
    });
  });

  describe('given prices have been stored', () => {
    it('reads them back', async () => {
      await setSeenPrices([{ label: 'laptop', amount: 1200, currency: 'EUR' }]);
      expect(await getSeenPrices()).toEqual([{ label: 'laptop', amount: 1200, currency: 'EUR' }]);
    });

    it('empties on clear', async () => {
      // PRIVACY.md promises that turning the setting off clears this, and a
      // promise in that file has to be literally true of the code.
      await setSeenPrices([{ label: 'laptop', amount: 1200, currency: 'EUR' }]);
      await clearSeenPrices();
      expect(await getSeenPrices()).toEqual([]);
    });
  });

  describe('given the local area is used', () => {
    it('never writes to sync storage', async () => {
      // A list of prices someone looked at must not be uploaded to Google or
      // Mozilla on their behalf.
      await setSeenPrices([{ label: 'laptop', amount: 1200, currency: 'EUR' }]);
      expect([...store.keys()].every((key) => key.startsWith('local:'))).toBe(true);
    });
  });
});

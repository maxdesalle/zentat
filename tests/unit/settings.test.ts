import { beforeEach, describe, expect, it, vi } from 'vitest';

// Spec: tests/trees/settings.tree
//
// A fake storage backend rather than a mock: the migration's whole risk is in
// the interaction between two stores, and assertions about which one holds
// what are only meaningful against something that actually behaves like a
// store.

const store = new Map<string, unknown>();
const watchers = new Map<string, ((value: unknown) => void)[]>();
let syncThrows = false;

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: (key: string, opts: { fallback: unknown }) => ({
      getValue: async () => (store.has(key) ? store.get(key) : opts.fallback),
      setValue: async (value: unknown) => {
        store.set(key, value);
        for (const fn of [...(watchers.get(key) ?? [])]) fn(value);
      },
      watch: (fn: (value: unknown) => void) => {
        const list = watchers.get(key) ?? [];
        list.push(fn);
        watchers.set(key, list);
        return () => void list.splice(list.indexOf(fn), 1);
      },
    }),
    getItem: async (key: string) => {
      if (syncThrows && key.startsWith('sync:')) throw new Error('sync unavailable');
      return store.has(key) ? store.get(key) : null;
    },
    setItem: async (key: string, value: unknown) => void store.set(key, value),
    removeItem: async (key: string) => void store.delete(key),
  },
}));

const LOCAL = 'local:settings';
const SYNC = 'sync:settings';

/** Fresh module per test: the migration guard is module-level, by design. */
async function freshModule() {
  vi.resetModules();
  return import('../../src/lib/storage/settings');
}

beforeEach(() => {
  store.clear();
  watchers.clear();
  syncThrows = false;
});

describe('DEFAULT_SETTINGS', () => {
  it('converts on every site until the user blocks one', async () => {
    // Shipping the allowlist mode by default would convert nothing anywhere,
    // and a non-empty starting block list would silently skip real sites.
    const { DEFAULT_SETTINGS } = await freshModule();
    expect(DEFAULT_SETTINGS.siteMode).toBe('blocklist');
    expect(DEFAULT_SETTINGS.blockedSites).toEqual([]);
    expect(DEFAULT_SETTINGS.allowedSites).toEqual([]);
  });

  it('reads prices as US dollars and replaces them in place', async () => {
    // displayCurrency decides how a bare '$' is read; the wrong guess here is
    // a wrong price, not a cosmetic one.
    const { DEFAULT_SETTINGS } = await freshModule();
    expect(DEFAULT_SETTINGS.displayCurrency).toBe('USD');
    expect(DEFAULT_SETTINGS.displayMode).toBe('replace');
    expect(DEFAULT_SETTINGS.displayUnit).toBe('auto');
  });

  it('picks the rate provider on its own', async () => {
    // Pinning one provider by default removes the fallback chain, so a single
    // provider outage leaves the user with no rate at all.
    const { DEFAULT_SETTINGS } = await freshModule();
    expect(DEFAULT_SETTINGS.rateSource).toBe('auto');
  });

  it('shows the held rate rather than spot', async () => {
    const { DEFAULT_SETTINGS } = await freshModule();
    expect(DEFAULT_SETTINGS.rateMode).toBe('held');
    expect(DEFAULT_SETTINGS.heldBand).toBe(0.1);
  });

  it('starts with no anchors and no liabilities', async () => {
    const { DEFAULT_SETTINGS } = await freshModule();
    expect(DEFAULT_SETTINGS.anchors).toEqual([]);
    expect(DEFAULT_SETTINGS.liabilities).toEqual([]);
  });

  it('leaves the fiat price visible and weaning switched off', async () => {
    // Hiding fiat is a commitment the user makes, never one made for them.
    const { DEFAULT_SETTINGS } = await freshModule();
    expect(DEFAULT_SETTINGS.hideFiat).toBe(false);
    expect(DEFAULT_SETTINGS.weanFromFiat).toBe(false);
    expect(DEFAULT_SETTINGS.weanStartedAt).toBe(0);
  });
});

describe('getSettings', () => {
  describe('given nothing has ever been stored', () => {
    it('returns the defaults', async () => {
      const { getSettings, DEFAULT_SETTINGS } = await freshModule();
      expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe('given a partial record from an older version', () => {
    it('fills in missing fields from the defaults', async () => {
      store.set(LOCAL, { enabled: false });
      const { getSettings, DEFAULT_SETTINGS } = await freshModule();
      const settings = await getSettings();
      expect(settings.rateMode).toBe(DEFAULT_SETTINGS.rateMode);
      expect(settings.currencies).toEqual(DEFAULT_SETTINGS.currencies);
    });

    it('keeps the stored values', async () => {
      store.set(LOCAL, { enabled: false, displayCurrency: 'JPY' });
      const { getSettings } = await freshModule();
      const settings = await getSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.displayCurrency).toBe('JPY');
    });
  });

  describe('given a corrupted record', () => {
    describe('given currencies is not an array', () => {
      it('restores the default list', async () => {
        store.set(LOCAL, { currencies: 'USD' });
        const { getSettings, DEFAULT_SETTINGS } = await freshModule();
        expect((await getSettings()).currencies).toEqual(DEFAULT_SETTINGS.currencies);
      });
    });

    describe('given the site lists are not arrays', () => {
      it('restores empty lists', async () => {
        store.set(LOCAL, { blockedSites: null, allowedSites: 'x' });
        const { getSettings } = await freshModule();
        const settings = await getSettings();
        expect(settings.blockedSites).toEqual([]);
        expect(settings.allowedSites).toEqual([]);
      });
    });

    describe('given precision is missing', () => {
      it('restores the default precision', async () => {
        store.set(LOCAL, { precision: null });
        const { getSettings, DEFAULT_SETTINGS } = await freshModule();
        expect((await getSettings()).precision).toBe(DEFAULT_SETTINGS.precision);
      });
    });

    describe('given precision was written as undefined', () => {
      it('restores the default precision', async () => {
        // A form field that never got a value writes undefined rather than
        // null, and an undefined precision reaches the formatter as NaN digits.
        store.set(LOCAL, { precision: undefined });
        const { getSettings, DEFAULT_SETTINGS } = await freshModule();
        expect((await getSettings()).precision).toBe(DEFAULT_SETTINGS.precision);
      });
    });
  });

  describe('given the user deliberately enabled no currencies', () => {
    it('respects the empty list', async () => {
      // An empty array means "convert nothing" and is a real choice in the
      // options page; treating it as corruption overrides the user.
      store.set(LOCAL, { currencies: [] });
      const { getSettings } = await freshModule();
      expect((await getSettings()).currencies).toEqual([]);
    });
  });

  describe('given the user has filled in the site lists', () => {
    it('keeps both lists as written', async () => {
      // Emptying these would re-enable conversion on a site the user chose to
      // keep the extension away from.
      store.set(LOCAL, { blockedSites: ['bank.example'], allowedSites: ['shop.example'] });
      const { getSettings } = await freshModule();
      const settings = await getSettings();
      expect(settings.blockedSites).toEqual(['bank.example']);
      expect(settings.allowedSites).toEqual(['shop.example']);
    });
  });

  describe('given the user chose a precision other than the default', () => {
    it('keeps that precision', async () => {
      store.set(LOCAL, { precision: 'coarse' });
      const { getSettings } = await freshModule();
      expect((await getSettings()).precision).toBe('coarse');
    });
  });
});

describe('watchSettings', () => {
  describe('when the stored value changes', () => {
    it('reports the change filled in with defaults', async () => {
      // Watchers receive the raw stored record, which for a partial write from
      // an older version is missing fields the popup renders directly.
      const { watchSettings, setSettings, DEFAULT_SETTINGS } = await freshModule();
      const seen = vi.fn();
      const stop = watchSettings(seen);
      await setSettings({ displayCurrency: 'EUR' });
      expect(seen).toHaveBeenCalledOnce();
      expect(seen.mock.calls[0][0].displayCurrency).toBe('EUR');
      expect(seen.mock.calls[0][0].rateMode).toBe(DEFAULT_SETTINGS.rateMode);
      stop();
    });
  });

  describe('when the caller unsubscribes', () => {
    it('stops reporting', async () => {
      const { watchSettings, setSettings } = await freshModule();
      const seen = vi.fn();
      watchSettings(seen)();
      await setSettings({ displayCurrency: 'EUR' });
      expect(seen).not.toHaveBeenCalled();
    });
  });
});

describe('setSettings', () => {
  it('merges over what is already stored', async () => {
    const { setSettings, getSettings } = await freshModule();
    await setSettings({ displayCurrency: 'EUR' });
    expect((await getSettings()).displayCurrency).toBe('EUR');
  });

  it('leaves untouched fields alone', async () => {
    const { setSettings, getSettings } = await freshModule();
    await setSettings({ displayCurrency: 'EUR' });
    await setSettings({ enabled: false });
    const settings = await getSettings();
    expect(settings.displayCurrency).toBe('EUR');
    expect(settings.enabled).toBe(false);
  });
});

describe('migration from sync storage', () => {
  describe('given there is nothing in sync storage', () => {
    it('does nothing', async () => {
      const { getSettings } = await freshModule();
      await getSettings();
      expect(store.has(LOCAL)).toBe(false);
    });
  });

  describe('given sync storage holds settings', () => {
    describe('given local storage is empty', () => {
      it('copies them to local', async () => {
        store.set(SYNC, { displayCurrency: 'BRL', enabled: false });
        const { getSettings } = await freshModule();
        const settings = await getSettings();
        expect(settings.displayCurrency).toBe('BRL');
        expect(settings.enabled).toBe(false);
      });

      it('removes the sync copy', async () => {
        // Site block lists reveal browsing interests; leaving them on a sync
        // server is the thing this migration exists to undo.
        store.set(SYNC, { displayCurrency: 'BRL' });
        const { getSettings } = await freshModule();
        await getSettings();
        expect(store.has(SYNC)).toBe(false);
      });
    });

    describe('given local storage already holds settings', () => {
      it('keeps the local values', async () => {
        store.set(SYNC, { displayCurrency: 'BRL' });
        store.set(LOCAL, { displayCurrency: 'JPY' });
        const { getSettings } = await freshModule();
        expect((await getSettings()).displayCurrency).toBe('JPY');
      });

      it('removes the sync copy', async () => {
        store.set(SYNC, { displayCurrency: 'BRL' });
        store.set(LOCAL, { displayCurrency: 'JPY' });
        const { getSettings } = await freshModule();
        await getSettings();
        expect(store.has(SYNC)).toBe(false);
      });
    });
  });

  describe('given sync storage is unavailable', () => {
    it('falls through to local without failing', async () => {
      syncThrows = true;
      store.set(LOCAL, { displayCurrency: 'GBP' });
      const { getSettings } = await freshModule();
      expect((await getSettings()).displayCurrency).toBe('GBP');
    });
  });

  describe('given two callers migrate at once', () => {
    it('migrates exactly once', async () => {
      // The popup and the background both call getSettings on startup. If the
      // guard is set after the first await, both see it unset, both migrate,
      // and the second can write defaults over what the first just restored.
      store.set(SYNC, { displayCurrency: 'BRL' });
      const { getSettings } = await freshModule();

      const [a, b] = await Promise.all([getSettings(), getSettings()]);
      expect(a.displayCurrency).toBe('BRL');
      expect(b.displayCurrency).toBe('BRL');
    });
  });
});

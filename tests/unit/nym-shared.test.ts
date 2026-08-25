import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearNymDatabases, isAllowedNymUrl } from '../../src/lib/nym/shared';

// Spec: tests/trees/nym-shared.tree

describe('isAllowedNymUrl', () => {
  describe('when the url is not parseable', () => {
    it('is rejected', () => {
      expect(isAllowedNymUrl('not a url')).toBe(false);
      expect(isAllowedNymUrl('')).toBe(false);
    });
  });

  describe('when the url is parseable', () => {
    describe('given the protocol is not https', () => {
      it('is rejected', () => {
        // Plaintext defeats the point of routing through a mixnet at all.
        expect(isAllowedNymUrl('http://api.coingecko.com/x')).toBe(false);
        expect(isAllowedNymUrl('ftp://api.coingecko.com/x')).toBe(false);
        expect(isAllowedNymUrl('data:text/plain,hi')).toBe(false);
      });
    });

    describe('given the protocol is https', () => {
      describe('given the host is not on the allowlist', () => {
        it('is rejected', () => {
          // The offscreen document must never be usable as a generic proxy.
          expect(isAllowedNymUrl('https://evil.test/x')).toBe(false);
          expect(isAllowedNymUrl('https://google.com/')).toBe(false);
        });
      });

      describe('given the host is on the allowlist', () => {
        it('is allowed', () => {
          expect(isAllowedNymUrl('https://api.coingecko.com/api/v3/simple/price')).toBe(true);
          expect(isAllowedNymUrl('https://api.kraken.com/0/public/Ticker')).toBe(true);
        });
      });
    });
  });

  describe('when the url is crafted to look allowed', () => {
    describe('given credentials embed an allowed host', () => {
      it('is rejected', () => {
        // Parses with hostname 'evil.test' — the allowed name is only userinfo.
        expect(isAllowedNymUrl('https://api.coingecko.com@evil.test/x')).toBe(false);
      });
    });

    describe('given an allowed host is a subdomain of another', () => {
      it('is rejected', () => {
        expect(isAllowedNymUrl('https://api.coingecko.com.evil.test/x')).toBe(false);
        expect(isAllowedNymUrl('https://notapi.coingecko.com/x')).toBe(false);
      });
    });

    describe('given the host differs only by case', () => {
      it('is allowed', () => {
        // URL lowercases the hostname, so this is the same host.
        expect(isAllowedNymUrl('https://API.CoinGecko.com/x')).toBe(true);
      });
    });

    describe('given the host has a trailing dot', () => {
      it('is rejected', () => {
        // Resolves the same in DNS but is a different string; rejecting is the
        // safe direction for an allowlist.
        expect(isAllowedNymUrl('https://api.coingecko.com./x')).toBe(false);
      });
    });
  });
});

describe('clearNymDatabases', () => {
  const original = globalThis.indexedDB;

  afterEach(() => {
    if (original === undefined) {
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
    } else {
      (globalThis as { indexedDB?: unknown }).indexedDB = original;
    }
  });

  describe('given indexedDB is unavailable', () => {
    it('does nothing', async () => {
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
      await expect(clearNymDatabases()).resolves.toBeUndefined();
    });
  });

  describe('given enumerating databases throws', () => {
    it('swallows the error', async () => {
      (globalThis as { indexedDB?: unknown }).indexedDB = {
        databases: () => Promise.reject(new Error('denied')),
        deleteDatabase: () => {},
      };
      await expect(clearNymDatabases()).resolves.toBeUndefined();
    });
  });

  describe('given databases exist', () => {
    const setup = () => {
      const deleted: string[] = [];
      (globalThis as { indexedDB?: unknown }).indexedDB = {
        databases: async () => [
          { name: 'wasm-client-storage-zentat' },
          { name: 'nym-something' },
          { name: 'unrelated-app-data' },
          { name: undefined },
        ],
        deleteDatabase: (name: string) => deleted.push(name),
      };
      return deleted;
    };

    it('deletes those belonging to nym', async () => {
      const deleted = setup();
      await clearNymDatabases();
      expect(deleted).toContain('wasm-client-storage-zentat');
      expect(deleted).toContain('nym-something');
    });

    it('leaves unrelated databases alone', async () => {
      const deleted = setup();
      await clearNymDatabases();
      expect(deleted).not.toContain('unrelated-app-data');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDirectFetcher } from '../../src/lib/fetch/direct';

// Spec: tests/trees/direct-fetcher.tree

const realFetch = globalThis.fetch;
let lastInit: RequestInit | undefined;

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<unknown>) {
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    lastInit = init;
    return impl(url, init);
  }) as typeof fetch;
}

beforeEach(() => {
  lastInit = undefined;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe('given the request succeeds', () => {
  beforeEach(() => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ zec: 1 }) }));
  });

  it('reports the status', async () => {
    expect((await createDirectFetcher().fetch('https://x.test')).status).toBe(200);
  });

  it('reports ok', async () => {
    expect((await createDirectFetcher().fetch('https://x.test')).ok).toBe(true);
  });

  it('exposes the parsed body', async () => {
    const response = await createDirectFetcher().fetch('https://x.test');
    expect(await response.json()).toEqual({ zec: 1 });
  });
});

describe('given the request fails with an http error', () => {
  it('reports not ok without throwing', async () => {
    // An HTTP error is an answer, not a transport fault — the provider layer
    // decides what to do with it.
    stubFetch(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    const response = await createDirectFetcher().fetch('https://x.test');
    expect(response.ok).toBe(false);
    expect(response.status).toBe(429);
  });
});

describe('given the request rejects', () => {
  it('propagates the rejection', async () => {
    stubFetch(() => Promise.reject(new Error('offline')));
    await expect(createDirectFetcher().fetch('https://x.test')).rejects.toThrow('offline');
  });
});

describe('given the request outlives the timeout', () => {
  it('aborts the request', async () => {
    let aborted = false;
    stubFetch((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      })
    );

    // A hung connection must not hold a background job open forever.
    await expect(createDirectFetcher(5).fetch('https://x.test')).rejects.toThrow();
    expect(aborted).toBe(true);
  });
});

describe('hardened defaults', () => {
  beforeEach(() => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  });

  describe('when the caller passes no init', () => {
    it('omits credentials', async () => {
      await createDirectFetcher().fetch('https://x.test');
      expect(lastInit?.credentials).toBe('omit');
    });

    it('sends no referrer', async () => {
      await createDirectFetcher().fetch('https://x.test');
      expect(lastInit?.referrerPolicy).toBe('no-referrer');
    });

    it('bypasses the http cache', async () => {
      await createDirectFetcher().fetch('https://x.test');
      expect(lastInit?.cache).toBe('no-store');
    });
  });

  describe('when the caller tries to weaken them', () => {
    it('overrides the caller', async () => {
      // The defaults sit after the init spread precisely so this cannot happen.
      await createDirectFetcher().fetch('https://x.test', {
        credentials: 'include',
        referrerPolicy: 'unsafe-url',
        cache: 'force-cache',
      });
      expect(lastInit?.credentials).toBe('omit');
      expect(lastInit?.referrerPolicy).toBe('no-referrer');
      expect(lastInit?.cache).toBe('no-store');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Spec: tests/trees/nym-fetcher.tree
//
// The module picks its transport from a BUILD flag, so the two halves are
// mutually exclusive in any one bundle. Each test reloads the module with the
// flag stubbed, which is also the only honest way to test Firefox behaviour
// from a Chrome-shaped test run.

const store = new Map<string, unknown>();
const storeWatchers: ((value: unknown) => void)[] = [];

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: (key: string, opts: { fallback: unknown }) => ({
      getValue: async () => (store.has(key) ? store.get(key) : opts.fallback),
      setValue: async (value: unknown) => {
        store.set(key, value);
        for (const fn of storeWatchers) fn(value);
      },
      watch: (fn: (value: unknown) => void) => {
        storeWatchers.push(fn);
        return () => void storeWatchers.splice(storeWatchers.indexOf(fn), 1);
      },
    }),
  },
}));

const clearNymDatabases = vi.fn(async () => {});
vi.mock('../../src/lib/nym/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/nym/shared')>()),
  clearNymDatabases: () => clearNymDatabases(),
}));

// The Firefox half reaches the client through a dynamic import.
const nymFetch = vi.fn();
const destroyNymClient = vi.fn(async () => {});
const resetNymClient = vi.fn();
vi.mock('../../src/lib/nym/client', () => ({ nymFetch, destroyNymClient, resetNymClient }));

const RATE_URL = 'https://api.coingecko.com/api/v3/simple/price';

/** Chrome's offscreen + messaging surface, only as much as the module touches. */
function installChrome(over: Partial<Record<string, unknown>> = {}) {
  const createDocument = vi.fn(async () => {});
  const closeDocument = vi.fn(async () => {});
  const getContexts = vi.fn(async () => [] as unknown[]);
  const sendMessage = vi.fn(async () => ({ success: true, status: 200, data: { ok: 1 } }));
  const api = {
    runtime: {
      getContexts,
      sendMessage,
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
    },
    offscreen: { createDocument, closeDocument, Reason: { WORKERS: 'WORKERS' } },
    ...over,
  };
  vi.stubGlobal('chrome', api);
  return { createDocument, closeDocument, getContexts, sendMessage };
}

async function load(firefox: boolean) {
  vi.stubEnv('FIREFOX', firefox ? 'true' : '');
  vi.resetModules();
  return import('../../src/lib/fetch/nym');
}

beforeEach(() => {
  store.clear();
  storeWatchers.length = 0;
  vi.clearAllMocks();
  nymFetch.mockResolvedValue({ success: true, status: 200, data: { ok: 1 } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createNymFetcher', () => {
  describe('given a URL that is not a rate API', () => {
    it('refuses to route it', async () => {
      const { createNymFetcher } = await load(false);
      installChrome();
      await expect(createNymFetcher().fetch('https://evil.test/collect'))
        .rejects.toThrow(/Refusing to route/);
    });

    it('never reaches the transport', async () => {
      // The offscreen document is a general-purpose proxy sitting inside the
      // extension. The allowlist is the only thing stopping it being used as
      // one, so the check has to happen before any message is sent.
      const { createNymFetcher } = await load(false);
      const { sendMessage } = installChrome();
      await createNymFetcher().fetch('https://evil.test/collect').catch(() => {});
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('given a rate API URL', () => {
    it('reaches the transport', async () => {
      const { createNymFetcher } = await load(false);
      const { sendMessage } = installChrome();
      await createNymFetcher().fetch(RATE_URL);
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'nymFetch', url: RATE_URL }),
      );
    });
  });
});

describe('status', () => {
  describe('given nothing has happened yet', () => {
    it('reports disconnected', async () => {
      const { getNymStatus, getStoredNymStatus } = await load(false);
      expect(getNymStatus()).toBe('disconnected');
      expect(await getStoredNymStatus()).toBe('disconnected');
    });
  });

  describe('when a watcher subscribes', () => {
    it('is called immediately with the current status', async () => {
      const { watchNymStatus } = await load(false);
      const seen = vi.fn();
      watchNymStatus(seen);
      expect(seen).toHaveBeenCalledWith('disconnected');
    });

    it('is called again on every change', async () => {
      const { watchNymStatus, createNymFetcher } = await load(false);
      installChrome();
      const seen = vi.fn();
      watchNymStatus(seen);
      await createNymFetcher().fetch(RATE_URL);
      expect(seen.mock.calls.map(([s]) => s)).toEqual([
        'disconnected',
        'connecting',
        'connecting',
        'connected',
      ]);
    });
  });

  describe('when a watcher unsubscribes', () => {
    it('stops being called', async () => {
      const { watchNymStatus, resetNymConnection } = await load(false);
      installChrome();
      const seen = vi.fn();
      watchNymStatus(seen)();
      seen.mockClear();
      resetNymConnection();
      expect(seen).not.toHaveBeenCalled();
    });
  });

  describe('when the status changes', () => {
    it('is mirrored to storage for the popup', async () => {
      // The popup runs in its own context with no access to the background's
      // memory; without the mirror it can only guess from the settings toggle.
      const { createNymFetcher, getStoredNymStatus } = await load(false);
      installChrome();
      const seen: unknown[] = [];
      storeWatchers.push((v) => seen.push(v));
      await createNymFetcher().fetch(RATE_URL);
      expect(await getStoredNymStatus()).toBe('connected');
      expect(seen).toContain('connecting');
    });
  });

  describe('when another context watches the stored status', () => {
    it('is called on every change', async () => {
      const { createNymFetcher, watchStoredNymStatus } = await load(false);
      installChrome();
      const seen = vi.fn();
      const stop = watchStoredNymStatus(seen);
      await createNymFetcher().fetch(RATE_URL);
      expect(seen).toHaveBeenCalledWith('connected');
      stop();
      seen.mockClear();
      await createNymFetcher().fetch(RATE_URL);
      expect(seen).not.toHaveBeenCalled();
    });
  });
});

describe('on Chrome', () => {
  describe('given no offscreen document exists', () => {
    it('creates one', async () => {
      const { createNymFetcher } = await load(false);
      const { createDocument } = installChrome();
      await createNymFetcher().fetch(RATE_URL);
      expect(createDocument).toHaveBeenCalledOnce();
    });

    it('reports connecting rather than connected', async () => {
      // Creating a document is a local operation; nothing has crossed the
      // mixnet yet. Reporting 'connected' here would make the popup claim
      // privacy the user does not have.
      const { createNymFetcher, watchNymStatus } = await load(false);
      const seen: string[] = [];
      const { createDocument } = installChrome();
      createDocument.mockImplementation(async () => void seen.push('created'));
      watchNymStatus((s) => seen.push(s));
      const pending = createNymFetcher().fetch(RATE_URL);
      await pending;
      expect(seen.indexOf('connecting')).toBeLessThan(seen.indexOf('created'));
      expect(seen.indexOf('connected')).toBeGreaterThan(seen.indexOf('created'));
    });
  });

  describe('given an offscreen document already exists', () => {
    it('does not create a second one', async () => {
      const { createNymFetcher } = await load(false);
      const { createDocument, getContexts } = installChrome();
      getContexts.mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);
      await createNymFetcher().fetch(RATE_URL);
      expect(createDocument).not.toHaveBeenCalled();
    });
  });

  describe('given this context already created the document', () => {
    it('reuses it without asking the platform again', async () => {
      const { createNymFetcher } = await load(false);
      const { createDocument, getContexts } = installChrome();
      const fetcher = createNymFetcher();
      await fetcher.fetch(RATE_URL);
      await fetcher.fetch(RATE_URL);
      expect(createDocument).toHaveBeenCalledOnce();
      expect(getContexts).toHaveBeenCalledOnce();
    });
  });

  describe('given the platform cannot report existing contexts', () => {
    it('tries to create one anyway', async () => {
      // getContexts is not available on every Chrome the manifest allows.
      // Failing closed here would disable Nym entirely on those.
      const { createNymFetcher, getNymStatus } = await load(false);
      const { createDocument, getContexts } = installChrome();
      getContexts.mockRejectedValue(new Error('not supported'));
      await createNymFetcher().fetch(RATE_URL);
      expect(createDocument).toHaveBeenCalledOnce();
      expect(getNymStatus()).toBe('connected');
    });
  });

  describe('given two fetches race the first creation', () => {
    it('creates exactly one document', async () => {
      // Chrome throws on a second createDocument, so a race here is not a
      // wasted call but a failed fetch.
      const { createNymFetcher } = await load(false);
      const { createDocument } = installChrome();
      let release: () => void = () => {};
      createDocument.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const fetcher = createNymFetcher();
      const both = Promise.all([fetcher.fetch(RATE_URL), fetcher.fetch(RATE_URL)]);
      await vi.waitFor(() => expect(createDocument).toHaveBeenCalled());
      release();
      await both;
      expect(createDocument).toHaveBeenCalledOnce();
    });
  });

  describe('given the platform reports a document already exists', () => {
    it('treats the creation as successful', async () => {
      const { createNymFetcher, getNymStatus } = await load(false);
      const { createDocument } = installChrome();
      createDocument.mockRejectedValueOnce(
        new Error('Only a single offscreen document may be created'),
      );
      await createNymFetcher().fetch(RATE_URL);
      expect(getNymStatus()).toBe('connected');
    });
  });

  describe('given creating the document fails', () => {
    it('reports an error status', async () => {
      const { createNymFetcher, getNymStatus } = await load(false);
      const { createDocument } = installChrome();
      createDocument.mockRejectedValue(new Error('no can do'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await createNymFetcher().fetch(RATE_URL).catch(() => {});
      expect(getNymStatus()).toBe('error');
    });

    it('rethrows', async () => {
      const { createNymFetcher } = await load(false);
      const { createDocument } = installChrome();
      createDocument.mockRejectedValue('no can do');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(createNymFetcher().fetch(RATE_URL)).rejects.toBeTruthy();
    });
  });

  describe('given the fetch succeeds', () => {
    it('reports connected', async () => {
      const { createNymFetcher, getNymStatus } = await load(false);
      installChrome();
      await createNymFetcher().fetch(RATE_URL);
      expect(getNymStatus()).toBe('connected');
    });

    it('returns the payload', async () => {
      const { createNymFetcher } = await load(false);
      installChrome();
      const response = await createNymFetcher().fetch(RATE_URL);
      expect(response.ok).toBe(true);
      expect(await response.json()).toEqual({ ok: 1 });
    });

    it('defaults a missing status to 200', async () => {
      const { createNymFetcher } = await load(false);
      const { sendMessage } = installChrome();
      sendMessage.mockResolvedValue({ success: true, data: {} } as never);
      expect((await createNymFetcher().fetch(RATE_URL)).status).toBe(200);
    });
  });

  describe('given the message channel closes mid-flight', () => {
    it('forgets the document so the next fetch recreates it', async () => {
      // Tearing the document down under an in-flight message REJECTS rather
      // than resolving undefined, so the falsy-response branch never ran and
      // the next fetch messaged into a dead context.
      const { createNymFetcher } = await load(false);
      const { sendMessage, createDocument } = installChrome();
      sendMessage.mockRejectedValueOnce(new Error('message channel closed'));
      const fetcher = createNymFetcher();
      await fetcher.fetch(RATE_URL).catch(() => {});
      await fetcher.fetch(RATE_URL);
      expect(createDocument).toHaveBeenCalledTimes(2);
    });

    it('rethrows as an Error', async () => {
      const { createNymFetcher } = await load(false);
      const { sendMessage } = installChrome();
      sendMessage.mockRejectedValueOnce('channel gone');
      await expect(createNymFetcher().fetch(RATE_URL)).rejects.toThrow('channel gone');
    });
  });

  describe('given no response comes back', () => {
    it('forgets the document so the next fetch recreates it', async () => {
      const { createNymFetcher } = await load(false);
      const { sendMessage, createDocument } = installChrome();
      sendMessage.mockResolvedValueOnce(undefined as never);
      const fetcher = createNymFetcher();
      await expect(fetcher.fetch(RATE_URL)).rejects.toThrow(/stale/);
      await fetcher.fetch(RATE_URL);
      expect(createDocument).toHaveBeenCalledTimes(2);
    });
  });

  describe('given the fetch fails but the transport is fine', () => {
    it('throws the reported error', async () => {
      const { createNymFetcher } = await load(false);
      const { sendMessage } = installChrome();
      sendMessage.mockResolvedValue(
        { success: false, error: 'HTTP 429', transportOk: true } as never,
      );
      await expect(createNymFetcher().fetch(RATE_URL)).rejects.toThrow('HTTP 429');
    });

    it('keeps the document', async () => {
      // A 429 from the price API is the API's answer, not a broken tunnel.
      // Churning the document on one would burn a gateway registration.
      const { createNymFetcher } = await load(false);
      const { sendMessage, closeDocument } = installChrome();
      sendMessage.mockResolvedValue(
        { success: false, error: 'HTTP 429', transportOk: true } as never,
      );
      await createNymFetcher().fetch(RATE_URL).catch(() => {});
      expect(closeDocument).not.toHaveBeenCalled();
    });
  });

  describe('given the fetch fails fatally', () => {
    it('tears the document down', async () => {
      const { createNymFetcher } = await load(false);
      const { sendMessage, closeDocument } = installChrome();
      sendMessage.mockResolvedValue({ success: false, fatal: true } as never);
      await createNymFetcher().fetch(RATE_URL).catch(() => {});
      expect(closeDocument).toHaveBeenCalledOnce();
    });

    it('reports an error status', async () => {
      const { createNymFetcher, getNymStatus } = await load(false);
      const { sendMessage, closeDocument } = installChrome();
      sendMessage.mockResolvedValue({ success: false, fatal: true } as never);
      closeDocument.mockRejectedValue(new Error('already gone'));
      await expect(createNymFetcher().fetch(RATE_URL)).rejects.toThrow('Nym fetch failed');
      expect(getNymStatus()).toBe('error');
    });
  });

  describe('destroyNymConnection', () => {
    it('closes the document', async () => {
      const { destroyNymConnection } = await load(false);
      const { closeDocument } = installChrome();
      await destroyNymConnection();
      expect(closeDocument).toHaveBeenCalledOnce();
    });

    it('reports disconnected', async () => {
      const { createNymFetcher, destroyNymConnection, getNymStatus } = await load(false);
      installChrome();
      await createNymFetcher().fetch(RATE_URL);
      await destroyNymConnection();
      expect(getNymStatus()).toBe('disconnected');
    });
  });

  describe('resetNymConnection', () => {
    it('forgets the document without closing it', async () => {
      const { createNymFetcher, resetNymConnection, getNymStatus } = await load(false);
      const { createDocument, closeDocument } = installChrome();
      const fetcher = createNymFetcher();
      await fetcher.fetch(RATE_URL);
      resetNymConnection();
      expect(getNymStatus()).toBe('disconnected');
      expect(closeDocument).not.toHaveBeenCalled();
      await fetcher.fetch(RATE_URL);
      expect(createDocument).toHaveBeenCalledTimes(2);
    });
  });

  describe('resetNymIdentity', () => {
    it('closes the document', async () => {
      const { resetNymIdentity } = await load(false);
      const { closeDocument } = installChrome();
      await resetNymIdentity();
      expect(closeDocument).toHaveBeenCalledOnce();
    });

    it('clears the stored identity', async () => {
      // The one place that may wipe IndexedDB: doing it on every failure
      // re-registers with a brand new gateway each time and walks the network
      // until there are no gateways left to register with.
      const { resetNymIdentity } = await load(false);
      installChrome();
      await resetNymIdentity();
      expect(clearNymDatabases).toHaveBeenCalledOnce();
    });
  });
});

describe('on Firefox', () => {
  describe('given the fetch succeeds', () => {
    it('reports connected', async () => {
      const { createNymFetcher, getNymStatus } = await load(true);
      await createNymFetcher().fetch(RATE_URL);
      expect(getNymStatus()).toBe('connected');
    });

    it('returns the payload', async () => {
      const { createNymFetcher } = await load(true);
      nymFetch.mockResolvedValue({ success: true, data: { ok: 2 } });
      const response = await createNymFetcher().fetch(RATE_URL);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: 2 });
    });
  });

  describe('given the fetch fails but the transport is fine', () => {
    it('throws the reported error', async () => {
      const { createNymFetcher } = await load(true);
      nymFetch.mockResolvedValue({ success: false, error: 'HTTP 429', transportOk: true });
      await expect(createNymFetcher().fetch(RATE_URL)).rejects.toThrow('HTTP 429');
    });

    it('keeps the client', async () => {
      const { createNymFetcher } = await load(true);
      nymFetch.mockResolvedValue({ success: false, error: 'HTTP 429', transportOk: true });
      await createNymFetcher().fetch(RATE_URL).catch(() => {});
      expect(destroyNymClient).not.toHaveBeenCalled();
    });
  });

  describe('given the fetch fails fatally', () => {
    it('destroys the client', async () => {
      const { createNymFetcher } = await load(true);
      nymFetch.mockResolvedValue({ success: false, error: 'exit code 2', fatal: true });
      await createNymFetcher().fetch(RATE_URL).catch(() => {});
      expect(destroyNymClient).toHaveBeenCalledOnce();
    });

    it('reports an error status', async () => {
      const { createNymFetcher, getNymStatus } = await load(true);
      nymFetch.mockResolvedValue({ success: false, error: 'exit code 2', fatal: true });
      await createNymFetcher().fetch(RATE_URL).catch(() => {});
      expect(getNymStatus()).toBe('error');
    });
  });

  describe('given the build flag disagrees with the selected transport', () => {
    it('refuses to load the direct client', async () => {
      // Belt and braces around a dynamic import. If it ever survives into the
      // Chrome service worker, every cold start parses the whole Nym bundle
      // to reach code that context never runs.
      const { createNymFetcher } = await load(true);
      const fetcher = createNymFetcher();
      vi.stubEnv('FIREFOX', '');
      await expect(fetcher.fetch(RATE_URL)).rejects.toThrow('Firefox-only');
    });
  });

  describe('given the error carries no message', () => {
    it('throws a generic failure', async () => {
      const { createNymFetcher } = await load(true);
      nymFetch.mockResolvedValue({ success: false });
      await expect(createNymFetcher().fetch(RATE_URL)).rejects.toThrow('Nym fetch failed');
    });
  });

  describe('destroyNymConnection', () => {
    it('reports disconnected', async () => {
      const { createNymFetcher, destroyNymConnection, getNymStatus } = await load(true);
      await createNymFetcher().fetch(RATE_URL);
      await destroyNymConnection();
      expect(getNymStatus()).toBe('disconnected');
    });

    it('destroys the client', async () => {
      const { createNymFetcher, destroyNymConnection } = await load(true);
      // Only after the client module has actually been loaded — before that
      // there is nothing to destroy and reaching for it would import the
      // whole Nym bundle just to tear it down.
      await destroyNymConnection();
      expect(destroyNymClient).not.toHaveBeenCalled();
      await createNymFetcher().fetch(RATE_URL);
      await destroyNymConnection();
      expect(destroyNymClient).toHaveBeenCalledOnce();
    });
  });

  describe('resetNymConnection', () => {
    it('reports disconnected', async () => {
      const { resetNymConnection, getNymStatus } = await load(true);
      resetNymConnection();
      expect(getNymStatus()).toBe('disconnected');
    });

    it('resets the client', async () => {
      const { createNymFetcher, resetNymConnection } = await load(true);
      resetNymConnection();
      expect(resetNymClient).not.toHaveBeenCalled();
      await createNymFetcher().fetch(RATE_URL);
      resetNymConnection();
      expect(resetNymClient).toHaveBeenCalledOnce();
    });
  });
});

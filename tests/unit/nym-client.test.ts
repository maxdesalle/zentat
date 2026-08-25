import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Spec: tests/trees/nym-client.tree
//
// The SDK is stubbed at the module boundary. No mixnet is reachable from CI,
// but almost none of what this module does is mixnet-specific: it is option
// construction, error classification, deadline arithmetic and lifecycle. All
// of that is pure logic that was previously untested, in the file where the
// review found three mechanisms that never worked at all.

const mixFetch = vi.fn();
/** Options the client passed to the SDK on its most recent setup. */
let lastSetupOptions: Record<string, unknown> | undefined;
const createMixFetch = vi.fn(async (opts?: Record<string, unknown>) => {
  lastSetupOptions = opts;
  return { mixFetch };
});
const disconnectMixFetch = vi.fn(async () => {});

vi.mock('@nymproject/mix-fetch', () => ({
  createMixFetch: (opts?: Record<string, unknown>) => createMixFetch(opts),
  disconnectMixFetch: () => disconnectMixFetch(),
}));

const client = await import('../../src/lib/nym/client');

const ok = (body: unknown = { zec: 1 }) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

beforeEach(() => {
  vi.clearAllMocks();
  lastSetupOptions = undefined;
  createMixFetch.mockImplementation(async (opts?: Record<string, unknown>) => {
    lastSetupOptions = opts;
    return { mixFetch };
  });
  mixFetch.mockResolvedValue(ok());
});

afterEach(async () => {
  client.resetNymClient();
});

describe('setup', () => {
  describe('given no client exists yet', () => {
    it('creates one', async () => {
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(createMixFetch).toHaveBeenCalledTimes(1);
    });

    it('forces tls', async () => {
      // The SDK default is false, which means a plaintext hop to the gateway.
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(lastSetupOptions).toMatchObject({ forceTls: true });
    });

    it('sets a real per-request timeout', async () => {
      // The SDK default is five seconds, which cannot fit a TLS handshake over
      // three mixnet hops.
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      const opts = lastSetupOptions as { mixFetchOverride?: { requestTimeoutMs?: number } };
      expect(opts.mixFetchOverride?.requestTimeoutMs).toBeGreaterThan(30_000);
    });

    it('pins the client id', async () => {
      // Without a pinned id the client re-registers with a new gateway every
      // session, walking through the network until it is exhausted.
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(lastSetupOptions).toMatchObject({ clientId: 'zentat' });
    });

    it('disables the poisson stream', async () => {
      // ~1 Mbps of cover traffic, continuously, to carry six small fetches an
      // hour. This is Nym's own keepalive shape.
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      const opts = lastSetupOptions as {
        clientOverride?: { traffic?: { disableMainPoissonPacketDistribution?: boolean } };
      };
      expect(opts.clientOverride?.traffic?.disableMainPoissonPacketDistribution).toBe(true);
    });
  });

  describe('given a client already exists', () => {
    it('reuses it', async () => {
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      await client.nymFetch('https://api.coingecko.com/y', 1000);
      expect(createMixFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('given setup is already in flight', () => {
    it('joins the in-flight attempt', async () => {
      let release: (value: { mixFetch: typeof mixFetch }) => void = () => {};
      createMixFetch.mockImplementationOnce(
        () => new Promise((resolve) => (release = resolve)),
      );

      const first = client.nymFetch('https://api.coingecko.com/x', 1000);
      const second = client.nymFetch('https://api.coingecko.com/y', 1000);
      release({ mixFetch });
      await Promise.all([first, second]);

      // Two concurrent callers must not build two mixnet clients.
      expect(createMixFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('given setup itself fails', () => {
    it('reports the failure', async () => {
      createMixFetch.mockRejectedValueOnce(new Error('no gateways on network'));
      const result = await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(result.success).toBe(false);
      expect(result.fatal).toBe(true);
    });

    it('lets the next call try again', async () => {
      // The in-flight promise must be cleared on failure, or one bad startup
      // wedges every later fetch against a rejected promise.
      createMixFetch.mockRejectedValueOnce(new Error('transient'));
      await client.nymFetch('https://api.coingecko.com/x', 1000);

      mixFetch.mockResolvedValue(ok());
      expect((await client.nymFetch('https://api.coingecko.com/x', 1000)).success).toBe(true);
      expect(createMixFetch).toHaveBeenCalledTimes(2);
    });
  });
});

describe('fetching', () => {
  describe('given the request succeeds', () => {
    it('returns the parsed body', async () => {
      mixFetch.mockResolvedValue(ok({ zcash: { usd: 800 } }));
      const result = await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ zcash: { usd: 800 } });
    });

    it('reports the status', async () => {
      expect((await client.nymFetch('https://api.coingecko.com/x', 1000)).status).toBe(200);
    });
  });

  describe('given the origin answers with an http error', () => {
    beforeEach(() => {
      mixFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    });

    it('reports transport success', async () => {
      // A resolved response means the mixnet worked, whatever the status.
      const result = await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(result.transportOk).toBe(true);
      expect(result.status).toBe(429);
    });

    it('does not treat the tunnel as broken', async () => {
      // Three 429s used to burn three gateway registrations for a healthy
      // tunnel and a merely rate-limited API.
      const result = await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(result.fatal).toBeFalsy();
    });
  });

  describe('given the transport throws a recoverable error', () => {
    it('reports failure without asking for a teardown', async () => {
      mixFetch.mockRejectedValue(new Error('some transient blip'));
      const result = await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(result.success).toBe(false);
      expect(result.fatal).toBe(false);
    });

    it('describes a thrown non-error too', async () => {
      // WASM boundaries reject with strings as readily as with Errors.
      mixFetch.mockRejectedValue('plain string failure');
      const result = await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(result.error).toBe('plain string failure');
    });
  });

  describe('given the transport throws a fatal error', () => {
    const fatal = async (message: string) => {
      mixFetch.mockRejectedValue(new Error(message));
      return client.nymFetch('https://api.coingecko.com/x', 1000);
    };

    describe('given the go runtime has exited', () => {
      it('asks for a teardown', async () => {
        // This arrives as a rejected promise from mixFetch, never as a window
        // error — which is why the old window-level listener never fired.
        expect((await fatal('Go program has already exited')).fatal).toBe(true);
      });
    });

    describe('given the gateway connection failed', () => {
      it('asks for a teardown', async () => {
        expect((await fatal('failed to establish connection to gateway: x')).fatal).toBe(true);
        expect((await fatal('gateway connection was abruptly closed')).fatal).toBe(true);
      });
    });

    describe('given the network has no more gateways', () => {
      it('asks for a teardown', async () => {
        expect((await fatal('there are no more new gateways on the network')).fatal).toBe(true);
      });
    });
  });

  describe('given the request ignores its cors mode', () => {
    it('passes the unsafe-ignore-cors escape hatch', async () => {
      // The client runs its own CORS check inside the WASM; without this, no
      // public API can ever answer an extension origin.
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(mixFetch.mock.calls[0]?.[1]).toMatchObject({ mode: 'unsafe-ignore-cors' });
    });
  });

  describe('given a browser user agent is required', () => {
    it('sends one', async () => {
      // CoinGecko 403s a request with no User-Agent, and the Go default both
      // works today and advertises the transport.
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      const init = mixFetch.mock.calls[0]?.[1] as { headers?: Record<string, string> };
      expect(init.headers?.['User-Agent']).toContain('Mozilla/5.0');
    });
  });
});

describe('deadlines', () => {
  describe('given the deadline expires during setup', () => {
    it('fails rather than hanging', async () => {
      createMixFetch.mockImplementation(() => new Promise(() => {}));
      const result = await client.nymFetch('https://api.coingecko.com/x', 10);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });
  });

  describe('given the deadline expires during the request', () => {
    it('fails rather than hanging', async () => {
      mixFetch.mockImplementation(() => new Promise(() => {}));
      const result = await client.nymFetch('https://api.coingecko.com/x', 20);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });
  });

  describe('given a timeout is not a usable number', () => {
    it('falls back to the default', async () => {
      // Zero or NaN must not mean "deadline already passed" — that would make
      // every fetch fail instantly on a bad settings value.
      for (const bad of [0, -1, Number.NaN]) {
        mixFetch.mockResolvedValue(ok());
        expect((await client.nymFetch('https://api.coingecko.com/x', bad)).success).toBe(true);
      }
    });
  });

  describe('given the deadline has already passed before a step begins', () => {
    it('fails without starting the work', async () => {
      // Setup consumes the whole budget, so the request step must not even be
      // attempted — it should fail on the clock rather than start and hang.
      createMixFetch.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({ mixFetch }), 30)),
      );
      mixFetch.mockClear();

      const result = await client.nymFetch('https://api.coingecko.com/x', 25);
      expect(result.success).toBe(false);
      expect(mixFetch).not.toHaveBeenCalled();
    });
  });

  describe('withDeadline', () => {
    describe('given the deadline is already in the past', () => {
      it('rejects without waiting', async () => {
        // The guard that stops a later step starting work it has no time for.
        await expect(client.withDeadline(Promise.resolve(1), Date.now() - 1, 'connect'))
          .rejects.toThrow('connect');
      });
    });

    describe('given the promise settles first', () => {
      it('resolves with the value', async () => {
        await expect(client.withDeadline(Promise.resolve('ok'), Date.now() + 1000, 'x'))
          .resolves.toBe('ok');
      });

      it('propagates a rejection unchanged', async () => {
        // The original error must survive: it is what the fatal-error
        // classifier reads.
        await expect(
          client.withDeadline(
            Promise.reject(new Error('gateway client error')),
            Date.now() + 1000,
            'x',
          ),
        ).rejects.toThrow('gateway client error');
      });
    });

    describe('given the deadline passes first', () => {
      it('rejects with the labelled step', async () => {
        await expect(client.withDeadline(new Promise(() => {}), Date.now() + 5, 'request'))
          .rejects.toThrow('request');
      });
    });
  });

  describe('given any failure at all', () => {
    it('returns a result rather than throwing', async () => {
      // One contract. A function that returns a result for most errors and
      // throws for one is an unhandled rejection waiting to happen in a
      // service worker.
      mixFetch.mockImplementation(() => new Promise(() => {}));
      await expect(client.nymFetch('https://api.coingecko.com/x', 15)).resolves.toMatchObject({
        success: false,
      });
    });
  });
});

describe('teardown', () => {
  describe('given a client exists', () => {
    it('disconnects', async () => {
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      await client.destroyNymClient();
      expect(disconnectMixFetch).toHaveBeenCalled();
    });

    it('leaves the stored identity alone', async () => {
      // Wiping it re-registers with a brand new gateway every failure, which
      // walks through the network until it is exhausted.
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      await client.destroyNymClient();
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(lastSetupOptions).toMatchObject({ clientId: 'zentat' });
    });
  });

  describe('given disconnecting throws', () => {
    it('still clears local state', async () => {
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      disconnectMixFetch.mockRejectedValueOnce(new Error('already gone'));
      await expect(client.destroyNymClient()).resolves.toBeUndefined();

      // A new client is built on the next call rather than reusing a dead one.
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(createMixFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('given reset is requested', () => {
    it('drops the instance without disconnecting', async () => {
      await client.nymFetch('https://api.coingecko.com/x', 1000);
      disconnectMixFetch.mockClear();
      client.resetNymClient();
      expect(disconnectMixFetch).not.toHaveBeenCalled();

      await client.nymFetch('https://api.coingecko.com/x', 1000);
      expect(createMixFetch).toHaveBeenCalledTimes(2);
    });
  });
});

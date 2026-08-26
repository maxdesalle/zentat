// Shared Nym client logic - used by both Firefox background and Chrome offscreen document

import { createMixFetch, disconnectMixFetch, type IMixFetch } from '@nymproject/mix-fetch';
import { debug } from '../log';
import { NYM_CLIENT_ID, type NymFetchResult } from './shared';

export type { NymFetchResult } from './shared';

let mixFetchInstance: IMixFetch | null = null;
let initializingPromise: Promise<IMixFetch> | null = null;
let lastSuccessfulFetch: number = 0;

// Deliberately browser-shaped. Nym's own v2 client added a header shim for
// exactly this reason: CDN bot management rejects requests without canonical
// browser headers.
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 60s reads as generous and is actually tight: the gateway client retries the
// SAME gateway ten times at 5s intervals before declaring it dead, so it can
// legitimately spend ~50s recovering. A 60s deadline fires mid-ladder and tears
// down a client that was about to succeed. Nobody is waiting on a background
// job, so generosity here is free while a false timeout costs a registration.
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * WASM and worker boundaries reject with strings as readily as with Errors, so
 * every failure path has to handle both. One helper rather than the same
 * ternary in each place.
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class DeadlineError extends Error {
  constructor(label: string) {
    super(`Nym fetch timeout (${label})`);
    this.name = 'DeadlineError';
  }
}

// Race a promise against an absolute deadline. Every await in a nymFetch call
// shares ONE deadline, so a reconnect-and-retry path can never hang past the
// caller's timeout (the old code cleared its timer before retrying, which let
// the overall call hang forever when the mixnet was unreachable).
/** Exported for tests: this is load-bearing timing logic worth pinning directly. */
export function withDeadline<T>(promise: Promise<T>, deadline: number, label: string): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new DeadlineError(label));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError(label)), remaining);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function ensureInitialized(): Promise<IMixFetch> {
  if (mixFetchInstance) {
    return mixFetchInstance;
  }

  if (initializingPromise) {
    return initializingPromise;
  }

  // Every one of these is a non-default that the option-less call got wrong.
  initializingPromise = createMixFetch(
    {
      // forceTls defaults to FALSE, which means a plaintext ws:// hop to the
      // gateway — unacceptable for a transport whose entire purpose is privacy.
      forceTls: true,
      // The per-request default is 5 SECONDS, not the 60 the top-level helper
      // uses. Five seconds over a three-hop mixnet is most of the way to
      // guaranteeing failure, and it is very likely the bulk of what we have
      // been reading as flaky gateways.
      mixFetchOverride: { requestTimeoutMs: 45_000 },
      // Pins the IndexedDB name so reset logic cannot drift with an SDK default.
      clientId: NYM_CLIENT_ID,
      clientOverride: {
        traffic: {
          // A live client sends ~55 packets/sec whether or not it has anything
          // to say — roughly 1 Mbps, ~10 GB/day, to carry six 400-byte fetches
          // an hour. This is Nym's own keepalive shape: Poisson stream off,
          // loop cover slowed right down. Roughly 4 kbps, and the gateway
          // connection still stays warm so the next fetch skips the handshake.
          //
          // The cost is real: the entry gateway now sees WHEN we send. Route
          // unlinkability and per-hop mixing are unaffected. For a
          // fixed-cadence poll of a public price API whose destination the exit
          // already sees, that is a small loss for a very large saving.
          disableMainPoissonPacketDistribution: true,
        },
        coverTraffic: {
          loopCoverTrafficAverageDelayMs: 5_000,
        },
        topology: {
          // Nearly every gateway rates "high performance"; the default of 50
          // accepts almost anything. Free reliability.
          minimumGatewayPerformance: 80,
          // The library will otherwise wait SEVENTY MINUTES for topology.
          maxStartupGatewayWaitingPeriodMs: 60_000,
          // The default refetches ~1.5MB of topology every 5 minutes, over
          // clearnet, from the user's real IP.
          topologyRefreshRateMs: 30 * 60_000,
        },
      },
    } as Parameters<typeof createMixFetch>[0],
  );

  try {
    mixFetchInstance = await initializingPromise;
    initializingPromise = null;
    debug('Nym connected');
    return mixFetchInstance;
  } catch (error) {
    // Cleared on both paths explicitly rather than in a `finally`: a rejected
    // promise left in this slot wedges every later fetch against a failure
    // that already happened, and the explicit form makes that impossible to
    // lose in a refactor.
    initializingPromise = null;
    debug(`Nym init failed: ${describeError(error)}`);
    throw error;
  }
}

// There is deliberately no in-place reconnect. The SDK guards createMixFetch on
// a `window.__mixFetchGlobal` that disconnectMixFetch never clears, so calling
// them in sequence returns the SAME dead handle without re-running setup — no
// new gateway, no new client, and the old worker leaked. Nym documents the same
// constraint from the other side: one client per document lifetime, and the
// tunnel "cannot be reinitialized". The only real reconnect is to tear the
// offscreen document down and open a new one, which is what a fatal result asks
// the caller to do.

async function attemptFetch(url: string, deadline: number): Promise<NymFetchResult> {
  const instance = await withDeadline(ensureInitialized(), deadline, 'connect');
  // The mixnet client runs its own CORS check inside the WASM. With no mode,
  // Request defaults to 'cors', the target is cross-origin from
  // chrome-extension://, and the response is rejected unless it carries an
  // Access-Control-Allow-Origin matching our extension id — which no public
  // API will ever send. This is Nym's escape hatch for exactly that.
  const response = await withDeadline(
    instance.mixFetch(url, {
      mode: 'unsafe-ignore-cors',
      // CoinGecko 403s a request with no User-Agent. v1 lets Go supply
      // "Go-http-client/1.1", which works today but is one Cloudflare bot rule
      // from not working — and it advertises the transport to the API.
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    }),
    deadline,
    'request',
  );

  // A resolved Response means the mixnet worked, whatever the status code.
  // Nym's docs are explicit: HTTP 4xx/5xx resolve successfully, and rejections
  // occur only on transport failures. Treating a 429 from the price API as a
  // Nym failure burned a gateway registration for a healthy tunnel — and, since
  // freshness was only stamped on the ok branch, a run of 429s also made the
  // connection look stale and tripped a needless reconnect.
  lastSuccessfulFetch = Date.now();

  if (!response.ok) {
    return {
      success: false,
      status: response.status,
      error: `HTTP ${response.status}`,
      // The transport is fine; this is the API's answer. Do not churn gateways.
      transportOk: true,
    };
  }

  const data = await withDeadline(response.json(), deadline, 'response read');
  return {
    success: true,
    status: response.status,
    data,
  };
}

/**
 * Errors that mean the client cannot recover in place.
 *
 * These strings come from Nym's own error enums. The previous list was mostly
 * invented: "hasn't been initialised" and "not initialised" are never emitted,
 * and 'WebSocket'/'CLOSING'/'CLOSED' are browser DOMException text rather than
 * anything Nym produces. v1 flattens every Rust error to a bare message with no
 * code or variant tag, so string matching is the only option here — but the
 * strings have to be the real ones.
 */
function isFatalError(message: string): boolean {
  return FATAL_ERROR_SIGNATURES.some((signature) => message.includes(signature));
}

const FATAL_ERROR_SIGNATURES = [
  // The Go runtime died inside the worker. This arrives as a rejected promise
  // from mixFetch, never as a window error event — which is why the old
  // window-level crash listener could never fire.
  'Go program has already exited',
  'exit code',
  // Gateway-side failures, from common/client-core and the wasm client.
  'no more new gateways',
  'no gateways on network',
  'failed to establish connection to gateway',
  'failed to establish gateway connection',
  'gateway connection was abruptly closed',
  'timed out while trying to establish gateway connection',
  'failed to forward mix messages',
  'gateway client error',
  'Gateway communication failure',
  'unexpected exit',
];

export async function nymFetch(url: string, timeoutMs: number): Promise<NymFetchResult> {
  // Number.isFinite is the whole guard: it is false for everything that is not
  // a number, so a value that crossed the message boundary as a string or a
  // null lands on the default rather than on a deadline that has already run
  // out. A typeof check in front of it can never change the answer.
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  // Reaching the destination at all proves the tunnel, so an HTTP error is the
  // origin's answer rather than a transport fault. The distinction is carried
  // on the result (`transportOk`) and acted on by the caller; there is
  // deliberately no failure counter here — the cross-cycle backoff in the rate
  // refresh is the real circuit breaker, and a counter living in a document
  // that gets destroyed on teardown was never one.
  return nymFetchInner(url, Date.now() + timeout);
}

async function nymFetchInner(url: string, deadline: number): Promise<NymFetchResult> {
  try {
    return await attemptFetch(url, deadline);
  } catch (error) {
    // A deadline used to be rethrown while every other failure was returned,
    // so this function's declared Promise<NymFetchResult> was only sometimes
    // true. Two callers had to both check `.success` AND catch, and a missed
    // catch in a service worker is an unhandled rejection. One contract now:
    // every failure comes back as a result.
    const message = describeError(error);

    // Fatal means "this client is unusable — tear the document down and start
    // over", which is the only reconnect the SDK actually supports.
    return { success: false, error: message, fatal: isFatalError(message) };
  }
}

export async function destroyNymClient(): Promise<void> {
  debug('Destroying Nym client...');

  try {
    await disconnectMixFetch();
  } catch {
    // Ignore
  }

  mixFetchInstance = null;
  initializingPromise = null;
  lastSuccessfulFetch = 0;

  // Identity and gateway registration are deliberately left alone — see the
  // note in fetch/nym.ts. Recreating the client is what recovers; re-registering
  // with a new gateway every time is what exhausts the network.
}

export function resetNymClient(): void {
  mixFetchInstance = null;
  initializingPromise = null;
}

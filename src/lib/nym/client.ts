// Shared Nym client logic - used by both Firefox background and Chrome offscreen document

import { createMixFetch, disconnectMixFetch, type IMixFetch } from '@nymproject/mix-fetch';
import { debug } from '../log';
import { NYM_CLIENT_ID } from './shared';
import { clearNymDatabases, type NymFetchResult } from './shared';

export type { NymFetchResult } from './shared';

let mixFetchInstance: IMixFetch | null = null;
let initializingPromise: Promise<IMixFetch> | null = null;
let lastSuccessfulFetch: number = 0;

const DEFAULT_TIMEOUT_MS = 60000;

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
function withDeadline<T>(promise: Promise<T>, deadline: number, label: string): Promise<T> {
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
    } as Parameters<typeof createMixFetch>[0],
  );

  try {
    mixFetchInstance = await initializingPromise;
    debug('Nym connected');
    return mixFetchInstance;
  } catch (error) {
    console.error('Zentat: Nym init failed:', error);
    throw error;
  } finally {
    initializingPromise = null;
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
    instance.mixFetch(url, { mode: 'unsafe-ignore-cors' }),
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
  const timeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const result = await nymFetchInner(url, Date.now() + timeout);

  if (result.success || result.transportOk) {
    // Reaching the destination at all proves the tunnel; an HTTP error is the
    // server's answer, not a transport fault.
  } else if (!result.fatal) {
  }
  return result;
}

async function nymFetchInner(url: string, deadline: number): Promise<NymFetchResult> {
  try {
    return await attemptFetch(url, deadline);
  } catch (error) {
    if (error instanceof DeadlineError) throw error;
    const message = error instanceof Error ? error.message : String(error);

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

  // Clear Nym's stored registration data
  await clearNymDatabases();
}

export function resetNymClient(): void {
  mixFetchInstance = null;
  initializingPromise = null;
}

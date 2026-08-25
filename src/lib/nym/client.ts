// Shared Nym client logic - used by both Firefox background and Chrome offscreen document

import { createMixFetch, disconnectMixFetch, type IMixFetch } from '@nymproject/mix-fetch-full-fat';
import { debug } from '../log';
import { clearNymDatabases, type NymFetchResult } from './shared';

export type { NymFetchResult } from './shared';

let mixFetchInstance: IMixFetch | null = null;
let initializingPromise: Promise<IMixFetch> | null = null;
let lastSuccessfulFetch: number = 0;
let wasmCrashed: boolean = false;
let consecutiveFailures: number = 0;

const STALE_CONNECTION_MS = 6 * 60 * 1000; // 6 minutes
const MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_TIMEOUT_MS = 60000;

// Set up WASM crash detection if window is available
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const msg = event.message || '';
    if (msg.includes('Go program has already exited') || msg.includes('exit code')) {
      console.error('Zentat: WASM runtime crashed, marking for full restart');
      wasmCrashed = true;
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = String(event.reason || '');
    if (reason.includes('Go program has already exited') || reason.includes('exit code')) {
      console.error('Zentat: WASM runtime crashed (rejection), marking for full restart');
      wasmCrashed = true;
    }
  });
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

  initializingPromise = createMixFetch();

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

async function reinitialize(): Promise<IMixFetch> {
  debug('Reconnecting to Nym...');

  try {
    await disconnectMixFetch();
  } catch {
    // Ignore disconnect errors
  }

  mixFetchInstance = null;
  initializingPromise = null;

  return ensureInitialized();
}

async function attemptFetch(url: string, deadline: number): Promise<NymFetchResult> {
  const instance = await withDeadline(ensureInitialized(), deadline, 'connect');
  const response = await withDeadline(instance.mixFetch(url, {}), deadline, 'request');

  if (!response.ok) {
    return {
      success: false,
      status: response.status,
      error: `HTTP ${response.status}`,
    };
  }

  const data = await withDeadline(response.json(), deadline, 'response read');
  lastSuccessfulFetch = Date.now();
  return {
    success: true,
    status: response.status,
    data,
  };
}

function isReinitError(message: string): boolean {
  return (
    message.includes("hasn't been initialised")
    || message.includes('not initialised')
    || message.includes('WebSocket')
    || message.includes('CLOSING')
    || message.includes('CLOSED')
    || message.includes('network error')
    || message.includes('gateway client error')
    || message.includes('registration handshake')
  );
}

export async function nymFetch(url: string, timeoutMs: number): Promise<NymFetchResult> {
  const timeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const result = await nymFetchInner(url, Date.now() + timeout);

  if (result.success) {
    consecutiveFailures = 0;
  } else if (!result.fatal) {
    consecutiveFailures++;
  }
  return result;
}

async function nymFetchInner(url: string, deadline: number): Promise<NymFetchResult> {
  // Check if WASM runtime has crashed
  if (wasmCrashed) {
    return {
      success: false,
      error: 'WASM runtime crashed',
      fatal: true,
    };
  }

  // Too many consecutive failures
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    debug(`${consecutiveFailures} consecutive failures, signaling for full restart`);
    consecutiveFailures = 0;
    return {
      success: false,
      error: 'Too many consecutive failures',
      fatal: true,
    };
  }

  try {
    // Proactively reconnect if connection is stale
    const now = Date.now();
    if (
      mixFetchInstance
      && lastSuccessfulFetch > 0
      && now - lastSuccessfulFetch > STALE_CONNECTION_MS
    ) {
      debug('Connection stale, proactively reconnecting...');
      await withDeadline(reinitialize(), deadline, 'reconnect');
    }

    try {
      return await attemptFetch(url, deadline);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // "No more gateways" means we need to clear stored data and fully restart
      if (errorMessage.includes('no more new gateways')) {
        debug('Exhausted all gateways, need full restart with data clear');
        return {
          success: false,
          error: errorMessage,
          fatal: true,
        };
      }

      if (error instanceof DeadlineError) throw error;

      // Connection issues - reinitialize and retry once, still bounded by the
      // same overall deadline
      if (isReinitError(errorMessage)) {
        debug('Nym connection issue, reinitializing...');
        await withDeadline(reinitialize(), deadline, 'reconnect');
        return await attemptFetch(url, deadline);
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  } catch (error) {
    if (wasmCrashed) {
      debug('WASM crashed during fetch, signaling fatal');
      return {
        success: false,
        error: 'WASM runtime crashed',
        fatal: true,
      };
    }

    if (error instanceof DeadlineError) {
      debug('Fetch timed out, will reconnect on next attempt');
      reinitialize().catch(() => {});
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
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
  wasmCrashed = false;
  consecutiveFailures = 0;
  lastSuccessfulFetch = 0;

  // Clear Nym's stored registration data
  await clearNymDatabases();
}

export function resetNymClient(): void {
  mixFetchInstance = null;
  initializingPromise = null;
  wasmCrashed = false;
  consecutiveFailures = 0;
}

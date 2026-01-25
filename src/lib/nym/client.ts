// Shared Nym client logic - used by both Firefox background and Chrome offscreen document

import { createMixFetch, disconnectMixFetch, type IMixFetch } from '@nymproject/mix-fetch-full-fat';

export interface NymFetchResult {
  success: boolean;
  data?: unknown;
  status?: number;
  error?: string;
  fatal?: boolean;
}

let mixFetchInstance: IMixFetch | null = null;
let initializingPromise: Promise<IMixFetch> | null = null;
let lastSuccessfulFetch: number = 0;
let wasmCrashed: boolean = false;
let consecutiveFailures: number = 0;

const STALE_CONNECTION_MS = 6 * 60 * 1000; // 6 minutes
const MAX_CONSECUTIVE_FAILURES = 3;

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
    console.log('Zentat: Nym connected');
    return mixFetchInstance;
  } catch (error) {
    console.error('Zentat: Nym init failed:', error);
    throw error;
  } finally {
    initializingPromise = null;
  }
}

async function reinitialize(): Promise<IMixFetch> {
  console.log('Zentat: Reconnecting to Nym...');

  try {
    await disconnectMixFetch();
  } catch {
    // Ignore disconnect errors
  }

  mixFetchInstance = null;
  initializingPromise = null;

  return ensureInitialized();
}

export async function nymFetch(url: string, timeoutMs: number): Promise<NymFetchResult> {
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
    console.log(`Zentat: ${consecutiveFailures} consecutive failures, signaling for full restart`);
    consecutiveFailures = 0;
    return {
      success: false,
      error: 'Too many consecutive failures',
      fatal: true,
    };
  }

  const now = Date.now();

  // Proactively reconnect if connection is stale
  if (mixFetchInstance && lastSuccessfulFetch > 0 && now - lastSuccessfulFetch > STALE_CONNECTION_MS) {
    console.log('Zentat: Connection stale, proactively reconnecting...');
    await reinitialize();
  }

  // Timeout handling
  let timeoutId: ReturnType<typeof setTimeout>;
  let timedOut = false;
  const timeoutPromise = new Promise<NymFetchResult>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error('Nym fetch timeout'));
    }, timeoutMs);
  });

  const fetchPromise = (async (): Promise<NymFetchResult> => {
    try {
      const instance = await ensureInitialized();
      const response = await instance.mixFetch(url, {});
      clearTimeout(timeoutId);

      if (!response.ok) {
        consecutiveFailures++;
        return {
          success: false,
          status: response.status,
          error: `HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      lastSuccessfulFetch = Date.now();
      consecutiveFailures = 0;
      return {
        success: true,
        status: response.status,
        data,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const errorMessage = error instanceof Error ? error.message : String(error);

      // "No more gateways" means we need to clear stored data and fully restart
      if (errorMessage.includes('no more new gateways')) {
        console.log('Zentat: Exhausted all gateways, need full restart with data clear');
        consecutiveFailures++;
        return {
          success: false,
          error: errorMessage,
          fatal: true,
        };
      }

      // Connection issues - reinitialize and retry once
      const needsReinit =
        errorMessage.includes("hasn't been initialised") ||
        errorMessage.includes('not initialised') ||
        errorMessage.includes('WebSocket') ||
        errorMessage.includes('CLOSING') ||
        errorMessage.includes('CLOSED') ||
        errorMessage.includes('network error') ||
        errorMessage.includes('gateway client error') ||
        errorMessage.includes('registration handshake');

      if (needsReinit) {
        console.log('Zentat: Nym connection issue, reinitializing...');
        try {
          const instance = await reinitialize();
          const response = await instance.mixFetch(url, {});
          clearTimeout(timeoutId);

          if (!response.ok) {
            consecutiveFailures++;
            return {
              success: false,
              status: response.status,
              error: `HTTP ${response.status}`,
            };
          }

          const data = await response.json();
          lastSuccessfulFetch = Date.now();
          consecutiveFailures = 0;
          return {
            success: true,
            status: response.status,
            data,
          };
        } catch (retryError) {
          consecutiveFailures++;
          return {
            success: false,
            error: retryError instanceof Error ? retryError.message : String(retryError),
          };
        }
      }

      consecutiveFailures++;
      return {
        success: false,
        error: errorMessage,
      };
    }
  })();

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    consecutiveFailures++;

    if (wasmCrashed) {
      console.log('Zentat: WASM crashed during fetch, signaling fatal');
      return {
        success: false,
        error: 'WASM runtime crashed',
        fatal: true,
      };
    }

    if (timedOut) {
      console.log('Zentat: Fetch timed out, will reconnect on next attempt');
      reinitialize().catch(() => {});
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function destroyNymClient(): Promise<void> {
  console.log('Zentat: Destroying Nym client...');

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
  if (typeof indexedDB !== 'undefined') {
    try {
      const databases = await indexedDB.databases();
      for (const db of databases) {
        if (db.name && (db.name.includes('nym') || db.name.includes('wasm'))) {
          indexedDB.deleteDatabase(db.name);
          console.log(`Zentat: Cleared Nym database: ${db.name}`);
        }
      }
    } catch {
      // IndexedDB access might fail, ignore
    }
  }
}

export function resetNymClient(): void {
  mixFetchInstance = null;
  initializingPromise = null;
  wasmCrashed = false;
  consecutiveFailures = 0;
}

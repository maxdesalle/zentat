// Offscreen document for Nym mixnet fetching
// This runs in a context with `window` available

import { createMixFetch, disconnectMixFetch, type IMixFetch } from '@nymproject/mix-fetch-full-fat';

interface NymFetchRequest {
  type: 'nymFetch';
  url: string;
  timeoutMs: number;
}

interface NymFetchResponse {
  success: boolean;
  data?: unknown;
  status?: number;
  error?: string;
  fatal?: boolean; // Signals that offscreen document needs full recreation
}

let mixFetchInstance: IMixFetch | null = null;
let initializingPromise: Promise<IMixFetch> | null = null;
let lastSuccessfulFetch: number = 0;
let wasmCrashed: boolean = false;
let consecutiveFailures: number = 0;

// If no successful fetch in this time, proactively reconnect
const STALE_CONNECTION_MS = 6 * 60 * 1000; // 6 minutes (slightly more than one refresh interval)
const MAX_CONSECUTIVE_FAILURES = 3; // After this many failures, signal for full restart

// Detect WASM/Go runtime crashes
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

async function ensureInitialized(): Promise<IMixFetch> {
  if (mixFetchInstance) {
    return mixFetchInstance;
  }

  // Prevent concurrent initialization
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

  // Clean up old instance
  try {
    await disconnectMixFetch();
  } catch {
    // Ignore disconnect errors
  }

  mixFetchInstance = null;
  initializingPromise = null;

  return ensureInitialized();
}

// Initialize Nym on load (don't block message listener setup)
ensureInitialized().catch(() => {
  // Initial setup failed - will retry on first fetch request
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: NymFetchResponse) => void) => {
    if (typeof message !== 'object' || message === null) {
      return;
    }

    const msg = message as NymFetchRequest;

    if (msg.type === 'nymFetch') {
      handleNymFetch(msg.url, msg.timeoutMs)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true; // Keep channel open for async response
    }
  }
);

async function handleNymFetch(url: string, timeoutMs: number): Promise<NymFetchResponse> {
  // Check if WASM runtime has crashed - need full document restart
  if (wasmCrashed) {
    return {
      success: false,
      error: 'WASM runtime crashed',
      fatal: true,
    };
  }

  // Too many consecutive failures - bad gateway, need full restart to pick new one
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    console.log(`Zentat: ${consecutiveFailures} consecutive failures, signaling for full restart`);
    consecutiveFailures = 0; // Reset so next attempt after restart starts fresh
    return {
      success: false,
      error: 'Too many consecutive failures',
      fatal: true,
    };
  }

  const now = Date.now();

  // Proactively reconnect if connection is stale (no successful fetch recently)
  // This handles the case where WebSocket died silently without throwing errors
  if (mixFetchInstance && lastSuccessfulFetch > 0 && now - lastSuccessfulFetch > STALE_CONNECTION_MS) {
    console.log('Zentat: Connection stale, proactively reconnecting...');
    await reinitialize();
  }

  // Use Promise.race for timeout since AbortSignal can't be passed to Nym's internal Worker
  let timeoutId: ReturnType<typeof setTimeout>;
  let timedOut = false;
  const timeoutPromise = new Promise<NymFetchResponse>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error('Nym fetch timeout'));
    }, timeoutMs);
  });

  const fetchPromise = (async (): Promise<NymFetchResponse> => {
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
      // Track successful fetch
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

      // If SDK lost its state, WebSocket died, or network error, reinitialize and retry once
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

    // On timeout, check if WASM crashed during the fetch
    if (wasmCrashed) {
      console.log('Zentat: WASM crashed during fetch, signaling fatal');
      return {
        success: false,
        error: 'WASM runtime crashed',
        fatal: true,
      };
    }

    // Otherwise, force reconnect for next attempt since connection is likely dead
    if (timedOut) {
      console.log('Zentat: Fetch timed out, will reconnect on next attempt');
      // Don't await - just trigger reconnect in background
      reinitialize().catch(() => {});
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

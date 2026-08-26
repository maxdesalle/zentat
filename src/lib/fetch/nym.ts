import { storage } from 'wxt/utils/storage';
import { debug } from '../log';
import { clearNymDatabases, isAllowedNymUrl, type NymFetchResult } from '../nym/shared';
import type { Fetcher, FetcherResponse, NymStatus } from './types';

// Build-time, not runtime sniffing. The old detectFirefox() inferred the
// browser from "window exists AND chrome.offscreen doesn't" — which is also
// true inside the Chrome offscreen document (it exposes only chrome.runtime),
// in content scripts, and on Safari.
const isFirefox = Boolean(import.meta.env.FIREFOX);

// The live status is kept in memory for background-side consumers AND mirrored
// to storage so the popup/options UI can show the real connection state
// instead of inferring it from the settings toggle.
const nymStatusItem = storage.defineItem<NymStatus>('local:nymStatus', {
  fallback: 'disconnected',
});

let nymStatus: NymStatus = 'disconnected';
let statusListeners: Set<(status: NymStatus) => void> = new Set();

function setStatus(status: NymStatus) {
  nymStatus = status;
  statusListeners.forEach((listener) => listener(status));
  void nymStatusItem.setValue(status).catch(() => {});
}

export function getNymStatus(): NymStatus {
  return nymStatus;
}

export function watchNymStatus(callback: (status: NymStatus) => void): () => void {
  statusListeners.add(callback);
  callback(nymStatus);
  return () => statusListeners.delete(callback);
}

export function watchStoredNymStatus(callback: (status: NymStatus) => void): () => void {
  return nymStatusItem.watch(callback);
}

export async function getStoredNymStatus(): Promise<NymStatus> {
  return nymStatusItem.getValue();
}

// ============================================================================
// Firefox: Direct Nym client (has window in background/event page)
// ============================================================================

// Both builds carry Nym, but only via the standard @nymproject/mix-fetch
// package: it ships its WASM as separate .wasm files (which addons-linter
// treats as binary and never parses) and loads its worker from a real extension
// URL rather than a blob: URL, which Firefox MV3 forbids outright. The
// -full-fat variant failed on both counts — it base64-inlines the WASM and the
// worker into one 22.9MB index.js, well over the 5MB addons-linter will parse,
// which is what kept Zentat off AMO and therefore off Firefox Android.
let firefoxClientModule: typeof import('../nym/client') | null = null;

async function getFirefoxClient() {
  // Firefox-only by construction. Chrome reaches the client through the
  // offscreen document instead, and without this guard the dynamic import
  // below survives into the Chrome service worker — which then parses the
  // whole Nym bundle on every cold start, for every user, to reach code it
  // never executes.
  if (!import.meta.env.FIREFOX) throw new Error('Direct Nym client is Firefox-only');
  // Holding the reference saves a trip through the module loader per fetch and
  // nothing else: import() of a specifier that is already in the ESM registry
  // resolves to the very same namespace object, so a reload would hand back the
  // identical client.
  // Stryker disable next-line ConditionalExpression: re-import returns the same namespace object
  if (!firefoxClientModule) {
    firefoxClientModule = await import('../nym/client');
  }
  return firefoxClientModule;
}

function createFirefoxNymFetcher(timeoutMs: number): Fetcher {
  return {
    async fetch(url: string): Promise<FetcherResponse> {
      if (nymStatus === 'disconnected') {
        setStatus('connecting');
      }

      const client = await getFirefoxClient();
      const result = await client.nymFetch(url, timeoutMs);

      if (result.success) {
        setStatus('connected');
        return {
          ok: true,
          status: result.status || 200,
          json: async () => result.data,
        };
      }

      if (result.fatal) {
        debug('Fatal Nym error, destroying client');
        await client.destroyNymClient();
        setStatus('error');
      }

      throw new Error(result.error || 'Nym fetch failed');
    },
  };
}

async function destroyFirefoxNymConnection(): Promise<void> {
  setStatus('disconnected');
  if (firefoxClientModule) {
    await firefoxClientModule.destroyNymClient();
  }
}

function resetFirefoxNymConnection(): void {
  setStatus('disconnected');
  if (firefoxClientModule) {
    firefoxClientModule.resetNymClient();
  }
}

// ============================================================================
// Chrome: Offscreen document (service worker has no window)
// ============================================================================

let offscreenCreated = false;
let creatingPromise: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCreated) {
    return;
  }

  if (creatingPromise) {
    return creatingPromise;
  }

  creatingPromise = doCreateOffscreenDocument();
  try {
    await creatingPromise;
  } finally {
    creatingPromise = null;
  }
}

async function doCreateOffscreenDocument(): Promise<void> {
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (existingContexts.length > 0) {
      offscreenCreated = true;
      return;
    }
  } catch {
    // getContexts might fail, continue to try creating
  }

  // Creating the document is NOT a mixnet connection — status stays
  // 'connecting' until the first successful fetch through the mixnet.
  setStatus('connecting');

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run Nym mixnet SDK which requires window object',
    });
    offscreenCreated = true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('single offscreen document')) {
      offscreenCreated = true;
      return;
    }
    console.error('Zentat: Failed to create offscreen document:', error);
    setStatus('error');
    throw error;
  }
}

function createChromeNymFetcher(timeoutMs: number): Fetcher {
  return {
    async fetch(url: string): Promise<FetcherResponse> {
      if (nymStatus === 'disconnected') {
        setStatus('connecting');
      }
      await ensureOffscreenDocument();

      let response: NymFetchResult | undefined;
      try {
        response = (await chrome.runtime.sendMessage({
          type: 'nymFetch',
          url,
          timeoutMs,
        })) as NymFetchResult | undefined;
      } catch (error) {
        // Tearing the document down under an in-flight message REJECTS the
        // promise ("message channel closed") rather than resolving undefined,
        // so the falsy-response branch below never ran and offscreenCreated
        // stayed true — the next fetch then messaged into a dead context.
        offscreenCreated = false;
        throw error instanceof Error ? error : new Error(String(error));
      }

      if (!response) {
        offscreenCreated = false;
        throw new Error('No response from Nym - connection may be stale');
      }

      if (!response.success) {
        if (response.fatal) {
          debug('Fatal Nym error, destroying offscreen document');
          await destroyChromeNymConnection();
          setStatus('error');
        }
        throw new Error(response.error || 'Nym fetch failed');
      }

      // Only now has traffic actually gone through the mixnet
      setStatus('connected');
      return {
        ok: true,
        status: response.status || 200,
        json: async () => response.data,
      };
    },
  };
}

function resetChromeNymConnection(): void {
  offscreenCreated = false;
  setStatus('disconnected');
}

async function destroyChromeNymConnection(): Promise<void> {
  offscreenCreated = false;
  setStatus('disconnected');

  try {
    await chrome.offscreen.closeDocument();
    debug('Offscreen document closed for full reset');
  } catch {
    // Document might not exist, ignore
  }

  // Deliberately NOT clearing IndexedDB here.
  //
  // Wiping it discards the client's identity and its gateway registration, so
  // the next setup registers with a BRAND NEW gateway. Doing that on every
  // failure walks through the network until it hits "there are no more new
  // gateways on the network - it seems this client has already registered with
  // all nodes it could have" — a real error string in the WASM, and one this
  // code used to handle rather than avoid. At three retries a cycle it was
  // burning on the order of a hundred registrations a day per user, which is
  // both antisocial toward a ~575-gateway network and a distinctive signature.
  //
  // Closing the document is enough to get a fresh client. Identity is wiped
  // only by the explicit user-facing reset.
}

/** Discard the client's identity and gateway registration. User-initiated only. */
export async function resetNymIdentity(): Promise<void> {
  await destroyChromeNymConnection();
  await clearNymDatabases();
}

// ============================================================================
// Unified exports
// ============================================================================

export function createNymFetcher(timeoutMs: number = 60000): Fetcher {
  const base = isFirefox ? createFirefoxNymFetcher(timeoutMs) : createChromeNymFetcher(timeoutMs);
  return {
    async fetch(url: string, init?: RequestInit): Promise<FetcherResponse> {
      if (!isAllowedNymUrl(url)) {
        throw new Error(`Refusing to route non-rate-API URL through Nym: ${url}`);
      }
      return base.fetch(url, init);
    },
  };
}

export function resetNymConnection(): void {
  if (isFirefox) {
    resetFirefoxNymConnection();
  } else {
    resetChromeNymConnection();
  }
}

export async function destroyNymConnection(): Promise<void> {
  if (isFirefox) {
    await destroyFirefoxNymConnection();
  } else {
    await destroyChromeNymConnection();
  }
}

import type { Fetcher, FetcherResponse, NymStatus } from './types';

// Detect environment: Firefox has window in background, Chrome needs offscreen
const isFirefox = typeof window !== 'undefined' && typeof chrome?.offscreen === 'undefined';

let nymStatus: NymStatus = 'disconnected';
let statusListeners: Set<(status: NymStatus) => void> = new Set();

function setStatus(status: NymStatus) {
  nymStatus = status;
  statusListeners.forEach((listener) => listener(status));
}

export function getNymStatus(): NymStatus {
  return nymStatus;
}

export function watchNymStatus(callback: (status: NymStatus) => void): () => void {
  statusListeners.add(callback);
  callback(nymStatus);
  return () => statusListeners.delete(callback);
}

// ============================================================================
// Firefox: Direct Nym client (has window in background/event page)
// ============================================================================

let firefoxClientModule: typeof import('../nym/client') | null = null;

async function getFirefoxClient() {
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
        console.log('Zentat: Fatal Nym error, destroying client');
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
      setStatus('connected');
      return;
    }
  } catch {
    // getContexts might fail, continue to try creating
  }

  setStatus('connecting');

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run Nym mixnet SDK which requires window object',
    });
    offscreenCreated = true;
    setStatus('connected');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('single offscreen document')) {
      offscreenCreated = true;
      setStatus('connected');
      return;
    }
    console.error('Zentat: Failed to create offscreen document:', error);
    setStatus('error');
    throw error;
  }
}

interface NymFetchResponse {
  success: boolean;
  data?: unknown;
  status?: number;
  error?: string;
  fatal?: boolean;
}

function createChromeNymFetcher(timeoutMs: number): Fetcher {
  return {
    async fetch(url: string): Promise<FetcherResponse> {
      await ensureOffscreenDocument();

      const response = (await chrome.runtime.sendMessage({
        type: 'nymFetch',
        url,
        timeoutMs,
      })) as NymFetchResponse | undefined;

      if (!response) {
        offscreenCreated = false;
        throw new Error('No response from Nym - connection may be stale');
      }

      if (!response.success) {
        if (response.fatal) {
          console.log('Zentat: Fatal Nym error, destroying offscreen document');
          await destroyChromeNymConnection();
        }
        throw new Error(response.error || 'Nym fetch failed');
      }

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
    console.log('Zentat: Offscreen document closed for full reset');
  } catch {
    // Document might not exist, ignore
  }

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

// ============================================================================
// Unified exports
// ============================================================================

export function createNymFetcher(timeoutMs: number = 60000): Fetcher {
  if (isFirefox) {
    console.log('Zentat: Using Firefox direct Nym client');
    return createFirefoxNymFetcher(timeoutMs);
  } else {
    console.log('Zentat: Using Chrome offscreen Nym client');
    return createChromeNymFetcher(timeoutMs);
  }
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

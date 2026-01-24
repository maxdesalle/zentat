import type { Fetcher, FetcherResponse, NymStatus } from './types';

let offscreenCreated = false;
let creatingPromise: Promise<void> | null = null;
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

async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCreated) {
    return;
  }

  // Prevent concurrent creation attempts
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
  // Check if offscreen document already exists
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
    // "Only a single offscreen document may be created" means it already exists
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

export function createNymFetcher(timeoutMs: number = 60000): Fetcher {
  return {
    async fetch(url: string): Promise<FetcherResponse> {
      await ensureOffscreenDocument();

      const response = (await chrome.runtime.sendMessage({
        type: 'nymFetch',
        url,
        timeoutMs,
      })) as NymFetchResponse | undefined;

      if (!response) {
        // No response usually means the offscreen document isn't listening
        // Reset state so next attempt recreates it
        offscreenCreated = false;
        throw new Error('No response from Nym - connection may be stale');
      }

      if (!response.success) {
        // Fatal error means WASM crashed - need full document restart
        if (response.fatal) {
          console.log('Zentat: Fatal Nym error, destroying offscreen document');
          await destroyNymConnection();
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

export function resetNymConnection() {
  offscreenCreated = false;
  setStatus('disconnected');
}

export async function destroyNymConnection(): Promise<void> {
  offscreenCreated = false;
  setStatus('disconnected');

  // Close the offscreen document to fully reset WASM state
  try {
    await chrome.offscreen.closeDocument();
    console.log('Zentat: Offscreen document closed for full reset');
  } catch {
    // Document might not exist, ignore
  }
}

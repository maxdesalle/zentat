import type { Fetcher, FetcherResponse, NymStatus } from './types';

let offscreenCreated = false;
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

  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (existingContexts.length > 0) {
    offscreenCreated = true;
    return;
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
    setStatus('error');
    throw error;
  }
}

interface NymFetchResponse {
  success: boolean;
  data?: unknown;
  status?: number;
  error?: string;
}

export function createNymFetcher(timeoutMs: number = 60000): Fetcher {
  return {
    async fetch(url: string): Promise<FetcherResponse> {
      await ensureOffscreenDocument();

      const response = (await chrome.runtime.sendMessage({
        type: 'nymFetch',
        url,
        timeoutMs,
      })) as NymFetchResponse;

      if (!response.success) {
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

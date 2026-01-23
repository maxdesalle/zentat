import type { Fetcher, FetcherResponse, NymStatus } from './types';

type MixFetch = (url: string, init?: RequestInit) => Promise<Response>;

let mixFetchInstance: MixFetch | null = null;
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

async function initMixFetch(): Promise<MixFetch> {
  if (mixFetchInstance) {
    return mixFetchInstance;
  }

  setStatus('connecting');

  try {
    // Lazy load the Nym SDK - only loads when called
    const { mixFetch } = await import('@nymproject/mix-fetch-full-fat');
    mixFetchInstance = mixFetch;
    setStatus('connected');
    return mixFetch;
  } catch (error) {
    setStatus('error');
    throw error;
  }
}

export function createNymFetcher(timeoutMs: number = 60000): Fetcher {
  return {
    async fetch(url: string, init?: RequestInit): Promise<FetcherResponse> {
      const mixFetch = await initMixFetch();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await mixFetch(url, {
          ...init,
          signal: controller.signal,
        });

        return {
          ok: response.ok,
          status: response.status,
          json: () => response.json(),
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

export function resetNymConnection() {
  mixFetchInstance = null;
  setStatus('disconnected');
}

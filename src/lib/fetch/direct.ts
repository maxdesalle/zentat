import type { Fetcher, FetcherResponse } from './types';

const DEFAULT_TIMEOUT_MS = 10000;

export function createDirectFetcher(timeoutMs: number = DEFAULT_TIMEOUT_MS): Fetcher {
  return {
    async fetch(url: string, init?: RequestInit): Promise<FetcherResponse> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
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

import type { Fetcher } from './types';
import { createDirectFetcher } from './direct';
import { createNymFetcher } from './nym';

export { createDirectFetcher } from './direct';
export { createNymFetcher, getNymStatus, watchNymStatus, resetNymConnection } from './nym';
export type { Fetcher, FetcherResponse, NymStatus } from './types';

export interface FetcherOptions {
  nymEnabled: boolean;
  nymTimeoutMs?: number;
  directTimeoutMs?: number;
}

export function createFetcher(options: FetcherOptions): Fetcher {
  if (options.nymEnabled) {
    return createNymFetcher(options.nymTimeoutMs ?? 60000);
  }
  return createDirectFetcher(options.directTimeoutMs ?? 10000);
}

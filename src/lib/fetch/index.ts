import { createDirectFetcher } from './direct';
import { createNymFetcher } from './nym';
import type { Fetcher } from './types';

export { createDirectFetcher } from './direct';
export {
  createNymFetcher,
  destroyNymConnection,
  getNymStatus,
  getStoredNymStatus,
  resetNymConnection,
  watchNymStatus,
  watchStoredNymStatus,
} from './nym';
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

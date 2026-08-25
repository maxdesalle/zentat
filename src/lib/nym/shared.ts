// Types and helpers shared between the Nym client (offscreen document /
// Firefox background) and the background-side fetcher, so the message
// contract can't silently drift between the two contexts.

export interface NymFetchResult {
  /**
   * The request reached its destination and came back — the mixnet did its job
   * even if the server answered with an error. Distinguishes an API's 429 from
   * a broken tunnel, which are handled very differently.
   */
  transportOk?: boolean;
  success: boolean;
  data?: unknown;
  status?: number;
  error?: string;
  fatal?: boolean;
}

export interface NymFetchRequest {
  type: 'nymFetch';
  url: string;
  timeoutMs: number;
}

// Only the rate APIs may be fetched through the mixnet — the offscreen
// document must not be usable as a generic proxy.
const ALLOWED_NYM_HOSTS = new Set(['api.coingecko.com', 'api.kraken.com']);

export function isAllowedNymUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_NYM_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

// Clear Nym's persisted registration/WASM data (IndexedDB is per-origin and
// shared between the extension's contexts, so this works from either side).
export async function clearNymDatabases(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const databases = await indexedDB.databases();
    for (const db of databases) {
      if (db.name && (db.name.includes('nym') || db.name.includes('wasm'))) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  } catch {
    // IndexedDB access might fail, ignore
  }
}

/** Pins the client's IndexedDB name (stored as `mix-fetch-{clientId}`). */
export const NYM_CLIENT_ID = 'zentat';

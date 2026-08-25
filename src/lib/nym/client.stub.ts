// Stands in for the Nym client on Firefox builds, which ship no mixnet bundle.
// Aliased in at build time (see wxt.config.ts) so the 22.9MB dependency is
// never pulled into the module graph rather than merely being unreachable.
import type { NymFetchResult } from './shared';

export async function nymFetch(): Promise<NymFetchResult> {
  return { success: false, error: 'Nym is not included in this build', fatal: true };
}

export async function destroyNymClient(): Promise<void> {}
export function resetNymClient(): void {}

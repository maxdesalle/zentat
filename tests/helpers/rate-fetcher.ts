import type { Fetcher } from '../../src/lib/fetch/types';

/** A fetcher that answers per host, so a provider test never touches network. */
export function fetcherReturning(
  byHost: Record<string, { ok: boolean; status?: number; body?: unknown }>,
): { fetcher: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: Fetcher = {
    async fetch(url: string) {
      calls.push(url);
      const host = new URL(url).hostname;
      const spec = byHost[host];
      if (!spec) throw new Error(`Unexpected host: ${host}`);
      return {
        ok: spec.ok,
        status: spec.status ?? (spec.ok ? 200 : 500),
        json: async () => spec.body,
      };
    },
  };
  return { fetcher, calls };
}

import { SITE_ADAPTERS } from './sites';
import { hostMatches, type SiteAdapter } from './types';

export { SITE_ADAPTERS } from './sites';
export type { AdapterContext, SiteAdapter } from './types';
export { hostMatches } from './types';

/** The adapter for a host, or null for the generic path. */
export function adapterFor(hostname: string): SiteAdapter | null {
  return SITE_ADAPTERS.find((adapter) => hostMatches(hostname, adapter.hosts)) ?? null;
}

/** Whether an element is one this adapter treats as a whole price. */
export function isWholeReplacement(adapter: SiteAdapter | null, el: Element): boolean {
  if (!adapter?.replaceWhole) return false;
  return adapter.replaceWhole.some((selector) => el.matches(selector));
}

/** Whether an element sits somewhere this adapter says never to convert. */
export function isExcluded(adapter: SiteAdapter | null, el: Element): boolean {
  if (!adapter?.exclude) return false;
  return adapter.exclude.some((selector) => el.closest(selector) !== null);
}

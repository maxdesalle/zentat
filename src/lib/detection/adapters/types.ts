/**
 * Site adapters.
 *
 * Per-site behaviour used to live in three files at once: a regex and a
 * hostname list in patterns.ts, a querySelectorAll block and a cross-module
 * WeakSet in walker.ts, and a chain of booleans in converter.ts. Adding a site
 * meant editing all three and could not be tested without a DOM and a stubbed
 * window.location — so nothing pinned the behaviour, and the hacks accumulated.
 *
 * An adapter is data plus, where genuinely needed, two small functions. Adding
 * a site is one object; testing one is one fixture.
 *
 * Prefer PLATFORM adapters (Shopify, WooCommerce, schema.org) over single-site
 * ones: a platform adapter is written once against a public, versioned,
 * slowly-changing template and covers millions of independent domains, where a
 * single-site adapter is hostage to one company's next redesign.
 */

export interface AdapterContext {
  hostname: string;
  documentLang?: string;
}

export interface SiteAdapter {
  /** Stable id — also names the adapter's fixture. */
  readonly id: string;

  /** Matched by exact host or as a suffix, never by substring. */
  readonly hosts: string[];

  /**
   * What this host lets us assume. A declared currency is what makes a bare
   * "149,00" safe to read as a price at all.
   */
  readonly assume?: { currency?: string };

  /** Selectors for elements that ARE a price, in full. */
  readonly containers?: string[];

  /** Elements whose entire contents may be replaced, rather than spliced. */
  readonly replaceWhole?: string[];

  /** Never convert inside these, whatever the generic rules say. */
  readonly exclude?: string[];

  /**
   * Escape hatch for markup no selector can express — bol.com's aria-hidden
   * grid is the motivating case. Returns the text to parse.
   */
  extract?(container: Element, ctx: AdapterContext): string | null;
}

/** Suffix-safe host matching: "bol.com" matches "www.bol.com", never "notbol.com". */
export function hostMatches(hostname: string, hosts: string[]): boolean {
  const host = hostname.toLowerCase();
  return hosts.some((entry) => host === entry || host.endsWith('.' + entry));
}

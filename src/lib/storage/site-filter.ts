// Pure site allow/block matching, kept free of any storage or browser
// dependency so it can be imported directly by unit tests.

export interface SiteFilterSettings {
  siteMode: 'blocklist' | 'allowlist';
  blockedSites: string[];
  allowedSites: string[];
}

export function isSiteAllowed(hostname: string, settings: SiteFilterSettings): boolean {
  if (settings.siteMode === 'allowlist') {
    return settings.allowedSites.some((pattern) => matchesPattern(hostname, pattern));
  }
  return !settings.blockedSites.some((pattern) => matchesPattern(hostname, pattern));
}

export function matchesPattern(hostname: string, pattern: string): boolean {
  hostname = hostname.toLowerCase();
  pattern = pattern.toLowerCase();

  // Wildcard pattern: *.example.com matches example.com and any subdomain
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return hostname === suffix || hostname.endsWith('.' + suffix);
  }

  if (hostname === pattern) {
    return true;
  }

  // Subdomain match: "example.com" also matches "www.example.com", "api.example.com", etc.
  if (hostname.endsWith('.' + pattern)) {
    return true;
  }

  return false;
}

/**
 * The domain a per-site toggle should write. Storing the exact hostname made
 * "Disable here" on www.example.com leave example.com converting, which reads
 * as the button not working; matchesPattern already covers subdomains.
 */
export function siteToggleKey(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  // Keep two-part public suffixes intact (co.uk, com.au, com.br).
  const tail = parts.slice(-2).join('.');
  const isCompoundSuffix = /^(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(tail);
  return parts.slice(isCompoundSuffix ? -3 : -2).join('.');
}

/** Every stored pattern that currently applies to this hostname. */
export function patternsMatching(hostname: string, patterns: string[]): string[] {
  return patterns.filter((pattern) => matchesPattern(hostname, pattern));
}

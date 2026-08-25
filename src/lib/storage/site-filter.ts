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

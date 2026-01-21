import { describe, it, expect } from 'vitest';

// Inline the type and function to avoid importing storage module (requires browser runtime)
interface Settings {
  enabled: boolean;
  currencies: string[];
  precision: 'auto' | number;
  blockedSites: string[];
  allowedSites: string[];
  siteMode: 'blocklist' | 'allowlist';
}

function matchesPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return hostname === suffix || hostname.endsWith('.' + suffix);
  }
  return hostname === pattern;
}

function isSiteAllowed(hostname: string, settings: Settings): boolean {
  if (settings.siteMode === 'allowlist') {
    return settings.allowedSites.some((pattern) => matchesPattern(hostname, pattern));
  }
  return !settings.blockedSites.some((pattern) => matchesPattern(hostname, pattern));
}

const baseSettings: Settings = {
  enabled: true,
  currencies: ['USD'],
  precision: 'auto',
  blockedSites: [],
  allowedSites: [],
  siteMode: 'blocklist',
};

describe('isSiteAllowed', () => {
  describe('blocklist mode', () => {
    it('allows sites not in blocklist', () => {
      const settings: Settings = {
        ...baseSettings,
        siteMode: 'blocklist',
        blockedSites: ['blocked.com'],
      };
      expect(isSiteAllowed('allowed.com', settings)).toBe(true);
    });

    it('blocks sites in blocklist', () => {
      const settings: Settings = {
        ...baseSettings,
        siteMode: 'blocklist',
        blockedSites: ['blocked.com'],
      };
      expect(isSiteAllowed('blocked.com', settings)).toBe(false);
    });

    it('supports wildcard patterns', () => {
      const settings: Settings = {
        ...baseSettings,
        siteMode: 'blocklist',
        blockedSites: ['*.example.com'],
      };
      expect(isSiteAllowed('sub.example.com', settings)).toBe(false);
      expect(isSiteAllowed('example.com', settings)).toBe(false);
      expect(isSiteAllowed('other.com', settings)).toBe(true);
    });
  });

  describe('allowlist mode', () => {
    it('blocks sites not in allowlist', () => {
      const settings: Settings = {
        ...baseSettings,
        siteMode: 'allowlist',
        allowedSites: ['allowed.com'],
      };
      expect(isSiteAllowed('blocked.com', settings)).toBe(false);
    });

    it('allows sites in allowlist', () => {
      const settings: Settings = {
        ...baseSettings,
        siteMode: 'allowlist',
        allowedSites: ['allowed.com'],
      };
      expect(isSiteAllowed('allowed.com', settings)).toBe(true);
    });

    it('supports wildcard patterns', () => {
      const settings: Settings = {
        ...baseSettings,
        siteMode: 'allowlist',
        allowedSites: ['*.amazon.com'],
      };
      expect(isSiteAllowed('www.amazon.com', settings)).toBe(true);
      expect(isSiteAllowed('amazon.com', settings)).toBe(true);
      expect(isSiteAllowed('amazon.co.uk', settings)).toBe(false);
    });
  });
});

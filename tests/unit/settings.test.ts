import { describe, expect, it } from 'vitest';
// Tests the REAL implementation (extracted into a pure module) — the previous
// version of this file tested an inline copy that had drifted from shipped
// behavior (no case-insensitivity, no plain-domain subdomain matching).
import {
  isSiteAllowed,
  matchesPattern,
  type SiteFilterSettings,
  siteToggleKey,
} from '../../src/lib/storage/site-filter';

const baseSettings: SiteFilterSettings = {
  blockedSites: [],
  allowedSites: [],
  siteMode: 'blocklist',
};

describe('isSiteAllowed', () => {
  describe('blocklist mode', () => {
    it('allows sites not in blocklist', () => {
      const settings = { ...baseSettings, blockedSites: ['blocked.com'] };
      expect(isSiteAllowed('allowed.com', settings)).toBe(true);
    });

    it('blocks sites in blocklist', () => {
      const settings = { ...baseSettings, blockedSites: ['blocked.com'] };
      expect(isSiteAllowed('blocked.com', settings)).toBe(false);
    });

    it('blocks subdomains of a plain-domain pattern', () => {
      const settings = { ...baseSettings, blockedSites: ['blocked.com'] };
      expect(isSiteAllowed('www.blocked.com', settings)).toBe(false);
      expect(isSiteAllowed('api.blocked.com', settings)).toBe(false);
      expect(isSiteAllowed('notblocked.com', settings)).toBe(true);
    });

    it('matches case-insensitively', () => {
      const settings = { ...baseSettings, blockedSites: ['Blocked.COM'] };
      expect(isSiteAllowed('WWW.Blocked.com', settings)).toBe(false);
    });

    it('supports wildcard patterns', () => {
      const settings = { ...baseSettings, blockedSites: ['*.example.com'] };
      expect(isSiteAllowed('sub.example.com', settings)).toBe(false);
      expect(isSiteAllowed('example.com', settings)).toBe(false);
      expect(isSiteAllowed('other.com', settings)).toBe(true);
    });
  });

  describe('allowlist mode', () => {
    it('blocks sites not in allowlist', () => {
      const settings: SiteFilterSettings = {
        ...baseSettings,
        siteMode: 'allowlist',
        allowedSites: ['allowed.com'],
      };
      expect(isSiteAllowed('blocked.com', settings)).toBe(false);
    });

    it('allows sites in allowlist', () => {
      const settings: SiteFilterSettings = {
        ...baseSettings,
        siteMode: 'allowlist',
        allowedSites: ['allowed.com'],
      };
      expect(isSiteAllowed('allowed.com', settings)).toBe(true);
    });

    it('blocks everything when the allowlist is empty', () => {
      const settings: SiteFilterSettings = { ...baseSettings, siteMode: 'allowlist' };
      expect(isSiteAllowed('anything.com', settings)).toBe(false);
    });

    it('supports wildcard patterns', () => {
      const settings: SiteFilterSettings = {
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

describe('per-site toggle writes what the filter actually matches', () => {
  it('normalises to the registrable domain so subdomains follow', () => {
    expect(siteToggleKey('www.amazon.com')).toBe('amazon.com');
    expect(siteToggleKey('smile.amazon.co.uk')).toBe('amazon.co.uk');
    expect(siteToggleKey('shop.example.com.br')).toBe('example.com.br');
    expect(siteToggleKey('example.com')).toBe('example.com');
  });

  it('re-enabling clears every pattern that was blocking the site', () => {
    const blocked = ['amazon.com', '*.amazon.com', 'unrelated.com'];
    const remaining = blocked.filter((p) => !matchesPattern('www.amazon.com', p));
    expect(remaining).toEqual(['unrelated.com']);
  });

  it('the label predicate agrees with the conversion predicate', () => {
    const settings = {
      siteMode: 'blocklist' as const,
      blockedSites: ['amazon.com'],
      allowedSites: [],
    };
    // The old label read exact list membership and said "Disable here" here.
    expect(isSiteAllowed('www.amazon.com', settings)).toBe(false);
  });
});

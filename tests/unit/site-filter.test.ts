import { describe, expect, it } from 'vitest';

// Spec: tests/trees/site-filter.tree
// Tests the REAL implementation (extracted into a pure module) — the previous
// version of this file tested an inline copy that had drifted from shipped
// behavior (no case-insensitivity, no plain-domain subdomain matching).
import {
  isSiteAllowed,
  matchesPattern,
  patternsMatching,
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

    it('blocks a site that matches only one of several entries', () => {
      // One entry has to be enough. Requiring every entry to match would leave
      // the block list working only for users who blocked exactly one site.
      const settings = { ...baseSettings, blockedSites: ['blocked.com', 'other.com'] };
      expect(isSiteAllowed('blocked.com', settings)).toBe(false);
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

describe('matchesPattern', () => {
  describe('given a wildcard pattern', () => {
    it('matches the bare domain', () => {
      expect(matchesPattern('example.com', '*.example.com')).toBe(true);
    });

    it('matches a subdomain', () => {
      expect(matchesPattern('shop.example.com', '*.example.com')).toBe(true);
    });

    it('does not match a domain that merely ends in the same letters', () => {
      // notexample.com is a different registrant. Suffix matching without the
      // dot boundary is how a block list silently blocks a stranger's site.
      expect(matchesPattern('notexample.com', '*.example.com')).toBe(false);
    });
  });

  describe('given a plain pattern', () => {
    it('does not match an unrelated host', () => {
      expect(matchesPattern('other.org', 'example.com')).toBe(false);
    });

    it('does not match a host the pattern is a suffix of without a dot', () => {
      expect(matchesPattern('myexample.com', 'example.com')).toBe(false);
    });
  });
});

describe('siteToggleKey', () => {
  describe('given a two-part hostname', () => {
    it('returns it unchanged', () => {
      expect(siteToggleKey('example.com')).toBe('example.com');
    });
  });

  describe('given a www prefix', () => {
    it('strips the prefix', () => {
      expect(siteToggleKey('www.example.com')).toBe('example.com');
    });
  });

  describe('given a deep subdomain', () => {
    it('keeps the registrable domain', () => {
      expect(siteToggleKey('shop.example.com')).toBe('example.com');
      expect(siteToggleKey('a.b.example.com')).toBe('example.com');
    });
  });

  describe('given www sits inside a label rather than in front of it', () => {
    it('leaves the label whole', () => {
      // Cutting 'www.' out of the middle glues two labels together, and the
      // toggle then writes a domain that matches nothing — the button looks
      // dead while the site keeps converting.
      expect(siteToggleKey('secure-www.bank.com')).toBe('bank.com');
    });
  });

  describe('given a domain name that merely ends in a suffix word', () => {
    it('keeps the registrable domain', () => {
      // 'banco.es' is the registrant, not a public suffix. Reading the 'co.es'
      // inside it as one would write a per-subdomain entry and leave the rest
      // of the bank's site converting.
      expect(siteToggleKey('shop.banco.es')).toBe('banco.es');
    });
  });

  describe('given a suffix word in front of a long top-level domain', () => {
    it('treats it as an ordinary domain', () => {
      // The compound-suffix rule covers two-letter country codes (co.uk,
      // com.au). Anything longer is an ordinary domain, so the toggle covers
      // the whole of it rather than the one host the user happened to be on.
      expect(siteToggleKey('news.gov.scot')).toBe('gov.scot');
    });
  });

  describe('given a compound public suffix', () => {
    it('keeps three parts', () => {
      // Trimming to two would write 'co.uk' and disable every British site.
      expect(siteToggleKey('shop.example.co.uk')).toBe('example.co.uk');
      expect(siteToggleKey('loja.example.com.br')).toBe('example.com.br');
    });
  });

  describe('given a subdomain of a compound public suffix', () => {
    it('still keeps only the registrable domain', () => {
      expect(siteToggleKey('a.b.example.co.uk')).toBe('example.co.uk');
    });
  });

  describe('given mixed case', () => {
    it('lowercases the result', () => {
      expect(siteToggleKey('WWW.Example.COM')).toBe('example.com');
    });
  });
});

describe('patternsMatching', () => {
  describe('given several stored patterns', () => {
    it('returns only the ones that apply', () => {
      const found = patternsMatching('shop.example.com', [
        'example.com',
        '*.example.com',
        'other.org',
      ]);
      expect(found).toEqual(['example.com', '*.example.com']);
    });
  });

  describe('given no pattern applies', () => {
    it('returns nothing', () => {
      expect(patternsMatching('example.com', ['other.org'])).toEqual([]);
    });
  });
});

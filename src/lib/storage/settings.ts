import { storage } from 'wxt/utils/storage';

export interface Settings {
  enabled: boolean;
  currencies: string[];
  precision: 'auto' | number;
  blockedSites: string[];
  allowedSites: string[];
  siteMode: 'blocklist' | 'allowlist';
  displayCurrency: string;
}

const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  currencies: ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY'],
  precision: 'auto',
  blockedSites: [],
  allowedSites: [],
  siteMode: 'blocklist',
  displayCurrency: 'USD',
};

const settingsItem = storage.defineItem<Settings>('sync:settings', {
  fallback: DEFAULT_SETTINGS,
});

export async function getSettings(): Promise<Settings> {
  return settingsItem.getValue();
}

export async function setSettings(settings: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await settingsItem.setValue({ ...current, ...settings });
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return settingsItem.watch(callback);
}

export function isSiteAllowed(hostname: string, settings: Settings): boolean {
  if (settings.siteMode === 'allowlist') {
    return settings.allowedSites.some((pattern) => matchesPattern(hostname, pattern));
  }
  return !settings.blockedSites.some((pattern) => matchesPattern(hostname, pattern));
}

function matchesPattern(hostname: string, pattern: string): boolean {
  // Normalize both to lowercase
  hostname = hostname.toLowerCase();
  pattern = pattern.toLowerCase();

  // Wildcard pattern: *.example.com matches example.com and any subdomain
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return hostname === suffix || hostname.endsWith('.' + suffix);
  }

  // Exact match
  if (hostname === pattern) {
    return true;
  }

  // Subdomain match: "example.com" also matches "www.example.com", "api.example.com", etc.
  if (hostname.endsWith('.' + pattern)) {
    return true;
  }

  return false;
}

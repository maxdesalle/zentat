import { storage } from 'wxt/utils/storage';
import type { Anchor } from '../anchors';
import { CURRENCY_CODES } from '../currencies';
import { isSiteAllowed, type SiteFilterSettings } from './site-filter';

export { isSiteAllowed } from './site-filter';

export type DisplayMode = 'replace' | 'append';
export type DisplayUnit = 'auto' | 'zec' | 'zats';
export type RateSource = 'auto' | 'coingecko' | 'kraken';

export interface Settings extends SiteFilterSettings {
  enabled: boolean;
  currencies: string[];
  precision: 'auto' | number;
  displayCurrency: string;
  displayMode: DisplayMode;
  displayUnit: DisplayUnit;
  rateSource: RateSource;
  /** Things the user buys, used to express prices as ratios they can picture. */
  anchors: Anchor[];
  nymEnabled: boolean;
  nymTimeoutMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  // All supported currencies are on by default; the rate fetch retrieves all of
  // them regardless, so enabling them costs nothing and avoids silently showing
  // no conversions to users in KRW/INR/BRL/MXN regions.
  currencies: [...CURRENCY_CODES],
  precision: 'auto',
  blockedSites: [],
  allowedSites: [],
  siteMode: 'blocklist',
  displayCurrency: 'USD',
  displayMode: 'replace',
  displayUnit: 'auto',
  rateSource: 'auto',
  anchors: [],
  nymEnabled: false,
  nymTimeoutMs: 60000,
};

// Settings are deliberately stored in the local area, not sync: the site
// block/allow lists reveal which sites the user visits, and the privacy policy
// promises preferences never leave the device.
const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

// One-time migration from the pre-1.1 'sync:settings' location. Runs at most
// once per JS context; safe to re-run after service-worker restarts because it
// only copies when no local value exists yet.
let migrationDone = false;
async function migrateFromSyncStorage(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;
  try {
    const legacy = await storage.getItem<Settings>('sync:settings');
    if (legacy) {
      const local = await storage.getItem<Settings>('local:settings');
      if (local == null) {
        await settingsItem.setValue({ ...DEFAULT_SETTINGS, ...legacy });
      }
      await storage.removeItem('sync:settings');
    }
  } catch {
    // Sync storage may be unavailable; local fallback covers us.
  }
}

export async function getSettings(): Promise<Settings> {
  await migrateFromSyncStorage();
  const stored = await settingsItem.getValue();
  // Merge with defaults to handle missing fields from older versions
  const merged = { ...DEFAULT_SETTINGS, ...stored };

  // Repair corrupted values, but respect a deliberately-empty currency list
  // (empty array = "convert nothing", chosen in the options page).
  if (!Array.isArray(merged.currencies)) {
    merged.currencies = [...DEFAULT_SETTINGS.currencies];
  }
  if (!Array.isArray(merged.blockedSites)) {
    merged.blockedSites = [];
  }
  if (!Array.isArray(merged.allowedSites)) {
    merged.allowedSites = [];
  }
  if (merged.precision === undefined || merged.precision === null) {
    merged.precision = DEFAULT_SETTINGS.precision;
  }

  return merged;
}

export async function setSettings(settings: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await settingsItem.setValue({ ...current, ...settings });
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return settingsItem.watch((value) => {
    callback({ ...DEFAULT_SETTINGS, ...value });
  });
}

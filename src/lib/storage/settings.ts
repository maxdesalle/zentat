import { storage } from 'wxt/utils/storage';
import type { Anchor } from '../anchors';
import type { Precision } from '../conversion/format';
import { CURRENCY_CODES } from '../currencies';
import type { Liability } from '../liabilities';
import { isSiteAllowed, type SiteFilterSettings } from './site-filter';

export { isSiteAllowed } from './site-filter';

export type DisplayMode = 'replace' | 'append';
export type DisplayUnit = 'auto' | 'zec' | 'zats';
export type RateSource = 'auto' | 'coingecko' | 'kraken';

export interface Settings extends SiteFilterSettings {
  enabled: boolean;
  currencies: string[];
  precision: Precision;
  displayCurrency: string;
  displayMode: DisplayMode;
  displayUnit: DisplayUnit;
  rateSource: RateSource;
  /** Things the user buys, used to express prices as ratios they can picture. */
  anchors: Anchor[];
  /**
   * Rent, salary, subscriptions — the numbers a person's economic life is
   * actually denominated in. Until these exist in ZEC, converted shop prices
   * do not make it the user's unit.
   */
  liabilities: Liability[];
  /**
   * Advanced mode: no fiat anywhere — not on hover, not in the popup. You
   * cannot claim to think in a unit you can escape with one hover, so this is
   * the switch that makes the claim real. Off by default; it is a commitment,
   * not a default.
   */
  /**
   * 'held' shows a rate that only moves when ZEC leaves a band, so the number
   * is stable enough to remember; 'spot' shows the market rate, which changes
   * several times a day and is what a payment actually settles at.
   */
  rateMode: 'held' | 'spot';
  /** The band, and the accuracy bound disclosed to the user. */
  heldBand: number;
  hideFiat: boolean;
  /**
   * Fade the original price out of the tooltip over weeks rather than
   * requiring the user to quit it cold.
   *
   * Habituation is the product, so the off-ramp from fiat needs designing as
   * deliberately as the on-ramp. hideFiat is a cliff most people will not
   * jump; this is the ramp to it, and it ends by turning hideFiat on.
   */
  weanFromFiat: boolean;
  /** When weaning started, so the schedule is measured from a real date. */
  weanStartedAt: number;
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
  liabilities: [],
  // Held by default: the whole product depends on the number being memorable,
  // and spot is not.
  rateMode: 'held',
  heldBand: 0.1,
  hideFiat: false,
  weanFromFiat: false,
  weanStartedAt: 0,
  nymEnabled: false,
  nymTimeoutMs: 60000,
};

// Settings are deliberately stored in the local area, not sync: the site
// block/allow lists reveal which sites the user visits, and the privacy policy
// promises preferences never leave the device.
// Stryker disable next-line ObjectLiteral: dropping the fallback cannot change
// any result. Both readers of this item spread DEFAULT_SETTINGS underneath the
// stored value (getSettings, watchSettings), so an unset item resolves to the
// same record whether the fallback supplies it or the spread does; nothing
// outside this module reads the item.
const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

// One-time migration from the pre-1.1 'sync:settings' location. Runs at most
// once per JS context; safe to re-run after service-worker restarts because it
// only copies when no local value exists yet.
let migration: Promise<void> | null = null;
async function migrateFromSyncStorage(): Promise<void> {
  // The guard is the PROMISE, not a boolean. A boolean set before the first
  // await is no guard at all: the popup and the background both call
  // getSettings on startup, both see it unset, both migrate, and the second
  // can write defaults over what the first just restored. Storing the
  // in-flight promise makes concurrent callers await the same migration.
  migration ??= runMigration();
  return migration;
}

async function runMigration(): Promise<void> {
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

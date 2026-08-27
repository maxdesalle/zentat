import { storage } from 'wxt/utils/storage';
import type { HeldRate } from '../rates/held';
import { DEFAULT_RATES, type RatesData } from './rates';
import { normalizeSettings, type Settings } from './settings';

export interface StartupState {
  rates: RatesData;
  settings: Settings;
  held: HeldRate | null;
}

/**
 * Everything the content script needs before it can convert, in ONE read.
 *
 * Three reads are three cross-process replies, and in a content script each one
 * is delivered as its own task on a main thread that is busy parsing the page.
 * The parser does not yield between them, so the three do not overlap the way
 * three concurrent promises suggest — the wait is however long it takes the
 * page to let go of the thread, once per reply. Every one of those is time the
 * user spends looking at a fiat price.
 */
export async function readStartupState(): Promise<StartupState> {
  const [rates, settings, held] = await storage.getItems([
    'local:rates',
    'local:settings',
    'local:heldRate',
  ]);
  return {
    rates: (rates.value as RatesData | null) ?? DEFAULT_RATES,
    settings: normalizeSettings((settings.value as Partial<Settings> | null) ?? undefined),
    held: (held.value as HeldRate | null) ?? null,
  };
}

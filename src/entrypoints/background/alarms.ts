import type { Browser } from 'wxt/browser';
import { REFRESH_TTL_MS } from '../../lib/storage/rates';
import { refreshRates } from './rates';

const ALARM_NAME = 'zentat-rate-refresh';
// The alarm fires at half the staleness TTL so a failed fetch gets one retry
// within a single TTL window; refreshRates() itself skips when rates are fresh.
const REFRESH_INTERVAL_MINUTES = REFRESH_TTL_MS / 2 / 60_000;

// Idempotent: keeps an existing alarm's schedule so service-worker cold starts
// don't perpetually push the next fire back (the old clear+create reset the
// 5-minute clock on every worker wake). Pass recreate=true on install/update.
export async function setupAlarms(recreate: boolean = false): Promise<void> {
  if (!recreate) {
    const existing = await browser.alarms.get(ALARM_NAME);
    if (existing) return;
  }

  await browser.alarms.clear(ALARM_NAME);
  await browser.alarms.create(ALARM_NAME, {
    periodInMinutes: REFRESH_INTERVAL_MINUTES,
  });
}

export function handleAlarm(alarm: Browser.alarms.Alarm): void {
  if (alarm.name === ALARM_NAME) {
    void refreshRates(false);
  }
}

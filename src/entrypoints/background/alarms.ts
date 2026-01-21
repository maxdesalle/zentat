import type { Browser } from 'wxt/browser';
import { refreshRates } from './rates';

const ALARM_NAME = 'zentat-rate-refresh';
const REFRESH_INTERVAL_MINUTES = 5;

export async function setupAlarms(): Promise<void> {
  // Clear any existing alarm
  await browser.alarms.clear(ALARM_NAME);

  // Create periodic alarm
  await browser.alarms.create(ALARM_NAME, {
    periodInMinutes: REFRESH_INTERVAL_MINUTES,
  });
}

export function handleAlarm(alarm: Browser.alarms.Alarm): void {
  if (alarm.name === ALARM_NAME) {
    refreshRates(false);
  }
}

import { destroyNymConnection, getStoredNymStatus } from '../../lib/fetch/nym';
import { debug } from '../../lib/log';
import { getRates, isRatesStale, watchRates } from '../../lib/storage/rates';
import { getSettings, setSettings, watchSettings } from '../../lib/storage/settings';
import { handleAlarm, setupAlarms } from './alarms';
import { setupQuickConvert } from './quick';
import { refreshRates } from './rates';

const STALE_BADGE_AGE_MS = 30 * 60 * 1000;

export default defineBackground(() => {
  debug('Background script starting...');

  browser.runtime.onInstalled.addListener(async (details) => {
    await setupAlarms(true);
    if (details.reason === 'install') {
      // Lightweight welcome: the options page explains what converts, the
      // Alt+Z shortcut, and which currencies are enabled. (Pages that were
      // already open convert after their next reload — injecting into them
      // would require blanket host permissions this extension avoids.)
      try {
        await browser.runtime.openOptionsPage();
      } catch {
        // Not critical
      }
    }
    refreshRates(true).catch((error) => console.error('Zentat: Install rate fetch error:', error));
  });

  // Also fetch on startup (for existing installs)
  browser.runtime.onStartup.addListener(() => {
    void setupAlarms();
    refreshRates(false).catch((error) => console.error('Zentat: Startup rate fetch error:', error));
  });

  // Handle periodic alarm
  browser.alarms.onAlarm.addListener((alarm) => {
    handleAlarm(alarm);
    void updateBadge();
  });

  // Handle keyboard shortcut. The background persists the flip; content
  // scripts react through their settings watchers. (No per-tab broadcast: the
  // old 'toggle' message made every tab re-toggle from possibly-stale local
  // state, so Alt+Z could undo itself.)
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle') return;
    try {
      const settings = await getSettings();
      await setSettings({ enabled: !settings.enabled });
    } catch (error) {
      console.error('Zentat: Toggle command error', error);
    }
  });

  // Handle messages from content scripts and popup. Every async branch must
  // resolve sendResponse — even on failure — or the sender hangs on an open
  // channel until the worker dies.
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (typeof message !== 'object' || message === null) return;

    const msg = message as { type?: string; enabled?: boolean };

    if (msg.type === 'refreshRates') {
      refreshRates(true)
        .then((success) => sendResponse({ success }))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true; // Keep channel open for async response
    }

    if (msg.type === 'setEnabled' && msg.enabled !== undefined) {
      setSettings({ enabled: msg.enabled })
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;
    }

    if (msg.type === 'getStatus') {
      Promise.all([getSettings(), getRates(), getStoredNymStatus()])
        .then(([settings, rates, nymStatus]) => {
          sendResponse({
            enabled: settings.enabled,
            rates: rates.rates,
            updatedAt: rates.updatedAt,
            source: rates.source,
            nymStatus,
          });
        })
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;
    }
  });

  // React to settings changes: tear down the Nym connection the moment the
  // user disables it (previously a live mixnet websocket persisted
  // indefinitely), and keep the toolbar badge honest.
  let lastNymEnabled: boolean | null = null;
  getSettings()
    .then((s) => {
      lastNymEnabled = s.nymEnabled;
    })
    .catch(() => {});
  watchSettings((settings) => {
    if (lastNymEnabled !== null && lastNymEnabled && !settings.nymEnabled) {
      destroyNymConnection().catch(() => {});
    }
    lastNymEnabled = settings.nymEnabled;
    void updateBadge();
  });
  watchRates(() => void updateBadge());

  // Ensure alarms are set up (in case onInstalled/onStartup didn't fire)
  void setupAlarms();
  setupQuickConvert();
  refreshRates(false)
    .then((success) => debug(`Initial rate fetch ${success ? 'succeeded' : 'failed'}`))
    .catch((error) => console.error('Zentat: Initial rate fetch error:', error));
  void updateBadge();

  debug('Background script initialized');
});

// Toolbar badge: 'OFF' when conversion is disabled, '!' when the cached rates
// are stale enough to mislead, empty otherwise.
async function updateBadge(): Promise<void> {
  try {
    const action = browser.action ?? browser.browserAction;
    if (!action?.setBadgeText) return;

    const [settings, rates] = await Promise.all([getSettings(), getRates()]);
    if (!settings.enabled) {
      await action.setBadgeText({ text: 'OFF' });
      await action.setBadgeBackgroundColor({ color: '#8e8e93' });
      await action.setTitle?.({ title: 'Zentat — conversion paused (Alt+Z)' });
    } else if (isRatesStale(rates, STALE_BADGE_AGE_MS)) {
      await action.setBadgeText({ text: '!' });
      await action.setBadgeBackgroundColor({ color: '#d97706' });
      await action.setTitle?.({ title: 'Zentat — exchange rate is stale' });
    } else {
      await action.setBadgeText({ text: '' });
      await action.setTitle?.({ title: 'Zentat' });
    }
  } catch {
    // Badge is cosmetic; never let it break the background
  }
}

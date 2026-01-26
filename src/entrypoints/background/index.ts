import { refreshRates } from './rates';
import { setupAlarms, handleAlarm } from './alarms';
import { setSettings, getSettings } from '../../lib/storage/settings';

export default defineBackground(() => {
  console.log('Zentat: Background script starting...');

  // Initial rate fetch on install/startup
  browser.runtime.onInstalled.addListener(async () => {
    console.log('Zentat: onInstalled event fired');
    await refreshRates(true);
    await setupAlarms();
  });

  // Also fetch on startup (for existing installs)
  browser.runtime.onStartup.addListener(async () => {
    await refreshRates(false);
    await setupAlarms();
  });

  // Handle periodic alarm
  browser.alarms.onAlarm.addListener(handleAlarm);

  // Handle keyboard shortcut
  browser.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle') {
      const settings = await getSettings();
      await setSettings({ enabled: !settings.enabled });

      // Notify all tabs
      const tabs = await browser.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          browser.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {
            // Tab might not have content script
          });
        }
      }
    }
  });

  // Handle messages from content scripts and popup
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (typeof message !== 'object' || message === null) return;

    const msg = message as { type?: string; enabled?: boolean };

    if (msg.type === 'refreshRates') {
      refreshRates(true).then((success) => {
        sendResponse({ success });
      });
      return true; // Keep channel open for async response
    }

    if (msg.type === 'setEnabled' && msg.enabled !== undefined) {
      setSettings({ enabled: msg.enabled }).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    if (msg.type === 'getStatus') {
      Promise.all([getSettings(), import('../../lib/storage/rates').then((m) => m.getRates())]).then(
        ([settings, rates]) => {
          sendResponse({
            enabled: settings.enabled,
            rates: rates.rates,
            updatedAt: rates.updatedAt,
            source: rates.source,
          });
        }
      );
      return true;
    }
  });

  // Ensure alarms are set up (in case onInstalled/onStartup didn't fire)
  console.log('Zentat: Setting up alarms and fetching rates...');
  setupAlarms();
  refreshRates(false).then((success) => {
    console.log(`Zentat: Initial rate fetch ${success ? 'succeeded' : 'failed'}`);
  }).catch((error) => {
    console.error('Zentat: Initial rate fetch error:', error);
  });

  console.log('Zentat: Background script initialized');
});

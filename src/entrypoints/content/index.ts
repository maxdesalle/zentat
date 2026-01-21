import { getRates, watchRates, type RatesData } from '../../lib/storage/rates';
import { getSettings, watchSettings, isSiteAllowed, type Settings } from '../../lib/storage/settings';
import { convertPricesInDocument, revertConversions } from './converter';
import { startObserver, stopObserver, updateObserverConfig } from './observer';

let hideStyleElement: HTMLStyleElement | null = null;
let currentRates: RatesData | null = null;
let currentSettings: Settings | null = null;
let unwatchSettings: (() => void) | null = null;
let unwatchRates: (() => void) | null = null;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',

  async main() {
    // Immediately hide body to prevent FOUC
    injectHideStyle();

    try {
      // Load cached data synchronously (no network)
      const [rates, settings] = await Promise.all([getRates(), getSettings()]);

      currentRates = rates;
      currentSettings = settings;

      // Check if site is allowed
      const hostname = window.location.hostname;
      if (!isSiteAllowed(hostname, settings)) {
        removeHideStyle();
        return;
      }

      // Check if extension is enabled
      if (!settings.enabled) {
        removeHideStyle();
        return;
      }

      // Wait for DOM to be ready, then convert
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
      } else {
        onDomReady();
      }

      // Watch for settings/rate changes
      unwatchSettings = watchSettings(onSettingsChange);
      unwatchRates = watchRates(onRatesChange);

      // Listen for toggle command from background
      browser.runtime.onMessage.addListener(handleMessage);
    } catch (error) {
      console.error('Zentat: Initialization error', error);
      removeHideStyle();
    }
  },
});

function injectHideStyle(): void {
  if (hideStyleElement) return;

  hideStyleElement = document.createElement('style');
  hideStyleElement.id = 'zentat-hide';
  hideStyleElement.textContent = 'body { visibility: hidden !important; }';

  // Insert as early as possible
  const target = document.head || document.documentElement;
  if (target) {
    target.appendChild(hideStyleElement);
  }
}

function removeHideStyle(): void {
  if (hideStyleElement) {
    hideStyleElement.remove();
    hideStyleElement = null;
  }
}

function onDomReady(): void {
  if (!currentRates || !currentSettings) {
    removeHideStyle();
    return;
  }

  // Convert prices
  convertPricesInDocument(currentRates, currentSettings);

  // Remove hide style
  removeHideStyle();

  // Start observing for dynamic content
  startObserver(currentRates, currentSettings);
}

function onSettingsChange(settings: Settings): void {
  const wasEnabled = currentSettings?.enabled ?? true;
  currentSettings = settings;

  const hostname = window.location.hostname;
  const isAllowed = isSiteAllowed(hostname, settings);

  if (!settings.enabled || !isAllowed) {
    stopObserver();
    revertConversions();
    return;
  }

  if (!wasEnabled && settings.enabled && currentRates) {
    convertPricesInDocument(currentRates, settings);
    startObserver(currentRates, settings);
  } else if (currentRates) {
    updateObserverConfig(currentRates, settings);
  }
}

function onRatesChange(rates: RatesData): void {
  currentRates = rates;

  if (currentSettings?.enabled) {
    updateObserverConfig(rates, currentSettings);
  }
}

function handleMessage(message: unknown): void {
  if (typeof message !== 'object' || message === null) return;

  const msg = message as { type?: string };

  if (msg.type === 'toggle') {
    if (currentSettings) {
      const newEnabled = !currentSettings.enabled;
      // Settings change will be handled by watcher
      browser.runtime.sendMessage({ type: 'setEnabled', enabled: newEnabled });
    }
  }

  if (msg.type === 'refresh' && currentRates && currentSettings) {
    revertConversions();
    convertPricesInDocument(currentRates, currentSettings);
  }
}

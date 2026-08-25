import { setDisplayLocale } from '../../lib/conversion/format';
import { getRates, type RatesData, watchRates } from '../../lib/storage/rates';
import {
  getSettings,
  isSiteAllowed,
  type Settings,
  watchSettings,
} from '../../lib/storage/settings';
import { convertPricesInDocument, revertConversions } from './converter';
import { startObserver, stopObserver, updateObserverConfig } from './observer';

let currentRates: RatesData | null = null;
let currentSettings: Settings | null = null;
let running = false;

export default defineContentScript({
  matches: ['<all_urls>'],
  // Convert prices inside iframes (embedded checkouts, product widgets) too
  allFrames: true,
  runAt: 'document_start',

  async main() {
    // Render in the page's locale, the same one the parser reads prices under.
    setDisplayLocale(document.documentElement.lang || undefined);
    try {
      // Load cached data (no network requests are ever made from this context)
      const [rates, settings] = await Promise.all([getRates(), getSettings()]);

      currentRates = rates;
      currentSettings = settings;

      // Register reactions BEFORE any early return: a page loaded while the
      // extension was disabled must still respond when the user re-enables it
      // (previously Alt+Z was one-way on such tabs until a full reload).
      watchSettings(onSettingsChange);
      watchRates(onRatesChange);
      browser.runtime.onMessage.addListener(handleMessage);

      if (!isActive(settings)) return;

      whenDomReady(start);
    } catch (error) {
      console.error('Zentat: Initialization error', error);
    }
  },
});

function isActive(settings: Settings): boolean {
  return settings.enabled && isSiteAllowed(window.location.hostname, settings);
}

function whenDomReady(fn: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

function start(): void {
  if (running) return;
  if (!currentRates || !currentSettings || !isActive(currentSettings)) return;
  running = true;

  // Note: the page is never hidden while this runs. The old "zero FOUC"
  // approach blanked <body> on EVERY site until rates + DOMContentLoaded + a
  // full scan completed — a universal page-load regression that outweighed the
  // brief fiat flash it prevented.
  convertPricesInDocument(currentRates, currentSettings);
  startObserver(currentRates, currentSettings);
}

function stop(): void {
  running = false;
  stopObserver();
  revertConversions();
}

function onSettingsChange(settings: Settings): void {
  const prev = currentSettings;
  currentSettings = settings;

  if (!isActive(settings)) {
    if (running) stop();
    return;
  }

  if (!running) {
    whenDomReady(start);
    return;
  }

  // Still active: if a display-affecting setting changed, re-convert the page
  // so the change applies without a reload.
  const displayChanged = prev !== null
    && (prev.precision !== settings.precision
      || prev.displayMode !== settings.displayMode
      || prev.displayUnit !== settings.displayUnit
      || prev.currencies.join(',') !== settings.currencies.join(','));

  if (displayChanged && currentRates) {
    revertConversions();
    convertPricesInDocument(currentRates, settings);
  }
  if (currentRates) {
    updateObserverConfig(currentRates, settings);
  }
}

function onRatesChange(rates: RatesData): void {
  currentRates = rates;
  if (!currentSettings || !isActive(currentSettings) || !running) return;

  // Re-convert so displayed ZEC values track the fresh rate instead of
  // freezing at whatever the rate was when the tab loaded.
  revertConversions();
  convertPricesInDocument(rates, currentSettings);
  updateObserverConfig(rates, currentSettings);
}

// A transient answer for the context-menu conversion. Rendered here rather
// than as a notification so it needs no extra permission and appears where the
// user is already looking.
let toastTimer: number | null = null;

function showToast(text: string, ok: boolean): void {
  document.getElementById('zentat-toast')?.remove();

  const toast = document.createElement('div');
  toast.id = 'zentat-toast';
  toast.textContent = text;
  toast.setAttribute('role', 'status');
  toast.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'bottom:24px',
    'left:50%',
    'transform:translateX(-50%)',
    'padding:10px 16px',
    'border-radius:10px',
    'font:600 14px/1.4 system-ui,sans-serif',
    'color:#1a1400',
    `background:${ok ? '#f4b728' : '#e0e0e0'}`,
    'box-shadow:0 6px 24px rgba(0,0,0,0.28)',
    'max-width:min(90vw,420px)',
    'pointer-events:none',
  ].join(';');

  (document.body || document.documentElement).appendChild(toast);

  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 3200) as unknown as number;
}

function handleMessage(message: unknown): void {
  if (typeof message !== 'object' || message === null) return;

  const msg = message as { type?: string; text?: string; ok?: boolean };

  if (msg.type === 'quickResult' && msg.text) {
    showToast(msg.text, msg.ok !== false);
    return;
  }

  // Enabled/disabled state arrives via the settings watcher — there is
  // deliberately no 'toggle' echo here (the old echo re-toggled from
  // possibly-stale per-tab state and could undo an Alt+Z press).
  if (msg.type === 'refresh' && currentRates && currentSettings && isActive(currentSettings)) {
    revertConversions();
    convertPricesInDocument(currentRates, currentSettings);
  }
}

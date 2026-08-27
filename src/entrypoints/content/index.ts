import { setDisplayLocale } from '../../lib/conversion/format';
import type { HeldRate } from '../../lib/rates/held';
import {
  getHeldRate,
  getRates,
  type RatesData,
  watchHeldRate,
  watchRates,
} from '../../lib/storage/rates';
import {
  getSettings,
  isSiteAllowed,
  type Settings,
  watchSettings,
} from '../../lib/storage/settings';
import { installCopyHandler } from './converter';
import { convertPricesInDocument, revertConversions } from './converter';
import { startObserver, stopObserver, updateObserverConfig } from './observer';

let currentRates: RatesData | null = null;
let currentHeld: HeldRate | null = null;
let currentSettings: Settings | null = null;
let running = false;
let uninstallCopy: (() => void) | null = null;

export default defineContentScript({
  matches: ['<all_urls>'],
  // Convert prices inside iframes (embedded checkouts, product widgets) too
  allFrames: true,
  runAt: 'document_start',

  async main() {
    // Render in the page's locale, the same one the parser reads prices under.
    setDisplayLocale(document.documentElement.lang || undefined);
    try {
      // All four in parallel. Resolving the policy host is a round trip to the
      // service worker, which in MV3 may have to be woken up first, and doing
      // it before the storage reads put that wait in front of every page — the
      // whole of it spent with the page showing fiat.
      const [rates, settings, held] = await Promise.all([
        getRates(),
        getSettings(),
        getHeldRate(),
        resolvePolicyHost(),
      ]);
      currentHeld = held;

      currentRates = rates;
      currentSettings = settings;

      // Register reactions BEFORE any early return: a page loaded while the
      // extension was disabled must still respond when the user re-enables it
      // (previously Alt+Z was one-way on such tabs until a full reload).
      watchSettings(onSettingsChange);
      watchRates(onRatesChange);
      // A re-peg is a real change to what the numbers mean, so it re-converts.
      // Ordinary spot movement inside the band does not, which is the point.
      watchHeldRate((held: HeldRate | null) => {
        currentHeld = held;
        if (currentRates && currentSettings && isActive(currentSettings)) {
          revertConversions();
          convertPricesInDocument(currentRates, currentSettings, heldForDisplay());
        }
      });
      browser.runtime.onMessage.addListener(handleMessage);

      if (!isActive(settings)) return;

      whenBodyExists(start);
    } catch (error) {
      console.error('Zentat: Initialization error', error);
    }
  },
});

/**
 * The hostname a site policy should be judged against.
 *
 * A subframe's own hostname is the wrong key: blocking `bank.com` must also
 * stop conversion inside the `secure.bankcdn.com` iframe it embeds, and an
 * `about:blank` or `srcdoc` subframe reports an empty hostname that matches no
 * pattern at all — so it converted regardless of the user's blocklist.
 */
let policyHost = window.location.hostname;

async function resolvePolicyHost(): Promise<void> {
  if (window.top === window.self && policyHost) return;
  try {
    const response = await browser.runtime.sendMessage({ type: 'getTopHost' }) as
      | { host?: string }
      | undefined;
    if (response?.host) policyHost = response.host;
  } catch {
    // Fall back to the frame's own host — no worse than before.
  }
}

function isActive(settings: Settings): boolean {
  return settings.enabled && isSiteAllowed(policyHost, settings);
}

/**
 * As soon as there is a body to convert, which is far earlier than the document
 * is complete.
 *
 * Waiting for DOMContentLoaded meant every price parsed before it was painted
 * in fiat first — a second of dollars on a large page, which is the one thing
 * this extension exists to remove. The observer converts whatever arrives
 * after, so starting early costs nothing and shortens the window each price
 * spends unconverted to a single task.
 *
 * The page is still never hidden. Blanking <body> until rates and a full scan
 * completed was tried once and was a universal page-load regression that
 * outweighed the flash it prevented.
 */
function whenBodyExists(fn: () => void): void {
  if (document.body) {
    fn();
    return;
  }
  const waiting = new MutationObserver(() => {
    if (!document.body) return;
    waiting.disconnect();
    fn();
  });
  waiting.observe(document.documentElement, { childList: true });
}

function whenDomReady(fn: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

/** Null when the user asked for spot, so the conversion path falls back to it. */
function heldForDisplay(): HeldRate | null {
  return currentSettings?.rateMode === 'spot' ? null : currentHeld;
}

function start(): void {
  if (running) return;
  if (!currentRates || !currentSettings || !isActive(currentSettings)) return;
  running = true;

  // Note: the page is never hidden while this runs. The old "zero FOUC"
  // approach blanked <body> on EVERY site until rates + DOMContentLoaded + a
  // full scan completed — a universal page-load regression that outweighed the
  // brief fiat flash it prevented.
  convertPricesInDocument(currentRates, currentSettings, heldForDisplay());
  startObserver(currentRates, currentSettings, heldForDisplay());
  uninstallCopy = installCopyHandler();
}

function stop(): void {
  uninstallCopy?.();
  uninstallCopy = null;
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

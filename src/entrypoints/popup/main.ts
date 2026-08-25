import { storage } from 'wxt/utils/storage';
import { formatZecWithSymbol } from '../../lib/conversion/format';
import type { NymStatus } from '../../lib/fetch/types';
import { monthlyPosition } from '../../lib/liabilities';
import {
  getFetchStatus,
  getHeldRate,
  getRates,
  isRatesStale,
  type RateFetchStatus,
  type RatesData,
  watchFetchStatus,
  watchRates,
} from '../../lib/storage/rates';
import { getSettings, setSettings, type Settings, watchSettings } from '../../lib/storage/settings';
import { isSiteAllowed, matchesPattern, siteToggleKey } from '../../lib/storage/site-filter';

const enabledCheckbox = document.getElementById('enabled') as HTMLInputElement;
const stateLine = document.getElementById('state-line')!;
const zecFiatValue = document.getElementById('zec-fiat-value')!;
const zecFiatUnit = document.getElementById('zec-fiat-unit')!;
const fiatZecLabel = document.getElementById('fiat-zec-label')!;
const fiatZecValue = document.getElementById('fiat-zec-value')!;
const sourceEl = document.getElementById('source')!;
const updatedEl = document.getElementById('updated')!;
const nymStatusEl = document.getElementById('nym-status')!;
const statusLine = document.getElementById('status-line') as HTMLParagraphElement;
const refreshBtn = document.getElementById('refresh') as HTMLButtonElement;
const optionsBtn = document.getElementById('options')!;

// Current-site controls
const siteRow = document.getElementById('site-row') as HTMLDivElement;
const siteName = document.getElementById('site-name')!;
const siteToggleBtn = document.getElementById('site-toggle') as HTMLButtonElement;

// Site filtering elements

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let currentSettings: Settings | null = null;
let currentRates: RatesData | null = null;
let currentFetchStatus: RateFetchStatus | null = null;
let currentHostname: string | null = null;

async function init() {
  // Load initial state
  const [settings, rates, fetchStatus, nymStatus] = await Promise.all([
    getSettings(),
    getRates(),
    getFetchStatus(),
    storage.getItem<NymStatus>('local:nymStatus'),
  ]);

  currentSettings = settings;
  currentRates = rates;
  currentFetchStatus = fetchStatus;
  enabledCheckbox.checked = settings.enabled;
  updateStateLine(settings.enabled);
  updateRateDisplay();
  updateNymStatus(settings.nymEnabled, nymStatus ?? 'disconnected');
  void initSiteRow();
  if (currentSettings) void renderPosition(currentSettings, currentRates);

  // First paint is done — allow toggle transitions from now on, so the switch
  // doesn't visibly animate OFF→ON on every open.
  requestAnimationFrame(() => document.body.classList.remove('preload'));

  // Watch for changes
  watchSettings((s) => {
    currentSettings = s;
    enabledCheckbox.checked = s.enabled;
    updateStateLine(s.enabled);
    updateNymStatus(s.nymEnabled, null);
    updateSiteRow();
    updateRateDisplay();
    void renderPosition(s, currentRates);
  });

  watchRates((r) => {
    currentRates = r;
    updateRateDisplay();
    if (currentSettings) void renderPosition(currentSettings, r);
  });

  watchFetchStatus((s) => {
    currentFetchStatus = s;
    updateRateDisplay();
  });

  storage.watch<NymStatus>('local:nymStatus', (status) => {
    if (currentSettings) updateNymStatus(currentSettings.nymEnabled, status ?? 'disconnected');
  });

  // Keep the "X min ago" text live while the popup is open
  setInterval(updateRateDisplay, 30_000);

  // Event listeners
  enabledCheckbox.addEventListener('change', async () => {
    await setSettings({ enabled: enabledCheckbox.checked });
  });

  refreshBtn.addEventListener('click', onRefreshClick);

  document.getElementById('practice')!.addEventListener('click', () => {
    void browser.tabs.create({ url: browser.runtime.getURL('/training.html') });
  });

  optionsBtn.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });
}

function updateStateLine(enabled: boolean) {
  stateLine.innerHTML = enabled
    ? 'Converting prices · <kbd>Alt+Z</kbd>'
    : 'Paused · <kbd>Alt+Z</kbd>';
}

async function onRefreshClick() {
  refreshBtn.disabled = true;
  const originalLabel = refreshBtn.textContent;
  refreshBtn.textContent = 'Refreshing…';
  showStatus(null);

  try {
    const response = (await browser.runtime.sendMessage({ type: 'refreshRates' })) as
      | { success?: boolean; error?: string }
      | undefined;
    if (!response?.success) {
      showStatus("Couldn't fetch rates — check your connection", 'error');
    }
  } catch {
    showStatus("Couldn't reach the extension — try reopening the popup", 'error');
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = originalLabel;
    updateRateDisplay();
  }
}

function showStatus(message: string | null, kind: 'error' | 'info' = 'info') {
  if (!message) {
    statusLine.hidden = true;
    return;
  }
  statusLine.hidden = false;
  statusLine.textContent = message;
  statusLine.classList.toggle('error', kind === 'error');
}

// --- Current site quick toggle -------------------------------------------

async function initSiteRow() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url;
    if (!url || !/^https?:/.test(url)) return;
    currentHostname = new URL(url).hostname;
    updateSiteRow();
  } catch {
    // No activeTab access; hide the row
  }
}

function updateSiteRow() {
  if (!currentHostname || !currentSettings) return;
  siteRow.hidden = false;
  siteName.textContent = currentHostname;

  const s = currentSettings;
  const host = currentHostname;
  // The label has to come from the same predicate that decides conversion.
  // Reading exact list membership meant www.amazon.com showed "Disable here"
  // while amazon.com in the blocklist was already blocking it.
  const converting = isSiteAllowed(host, s);
  siteToggleBtn.textContent = converting ? 'Disable here' : 'Enable here';

  siteToggleBtn.onclick = async () => {
    const key = siteToggleKey(host);
    if (s.siteMode === 'blocklist') {
      const blockedSites = converting
        ? [...s.blockedSites, key]
        // Remove every pattern that applies, not just an exact string match.
        : s.blockedSites.filter((p) => !matchesPattern(host, p));
      await setSettings({ blockedSites });
    } else {
      const allowedSites = converting
        ? s.allowedSites.filter((p) => !matchesPattern(host, p))
        : [...s.allowedSites, key];
      await setSettings({ allowedSites });
    }
  };
}

// --- Site filtering form --------------------------------------------------

function updateNymStatus(nymEnabled: boolean, status: NymStatus | null) {
  nymStatusEl.classList.remove('connecting', 'connected', 'error', 'inactive');
  nymStatusEl.classList.add('visible');

  if (!nymEnabled) {
    nymStatusEl.classList.add('inactive');
    nymStatusEl.textContent = 'Nym off';
    return;
  }

  // Show the REAL connection state, not the checkbox
  const s = status ?? 'disconnected';
  if (s === 'connected') {
    nymStatusEl.classList.add('connected');
    nymStatusEl.textContent = 'Nym connected';
  } else if (s === 'connecting') {
    nymStatusEl.classList.add('connecting');
    nymStatusEl.textContent = 'Nym connecting…';
  } else if (s === 'error') {
    nymStatusEl.classList.add('error');
    nymStatusEl.textContent = 'Nym failed';
  } else {
    nymStatusEl.classList.add('connecting');
    nymStatusEl.textContent = 'Nym idle';
  }
}

// --- Rate display ---------------------------------------------------------

function updateRateDisplay() {
  const rates = currentRates;
  const currency = currentSettings?.displayCurrency ?? 'USD';

  zecFiatUnit.textContent = currency;
  fiatZecLabel.textContent = `1 ${currency} =`;

  const rate = rates?.rates[currency];
  if (rates && rate !== undefined) {
    fiatZecValue.textContent = formatRate(rate);
    zecFiatValue.textContent = formatFiatPrice(1 / rate, currency);
  } else {
    zecFiatValue.textContent = '--';
    fiatZecValue.textContent = '--';
  }

  // CoinGecko's terms require visible attribution wherever their data is shown.
  sourceEl.textContent = rates?.source === 'coingecko'
    ? 'Powered by CoinGecko'
    : rates?.source || '--';

  // Freshness with an honest empty/loading/error state instead of dead dashes
  updatedEl.classList.remove('stale', 'very-stale');
  if (!rates || !rates.updatedAt) {
    if (currentFetchStatus?.state === 'fetching') {
      updatedEl.textContent = 'fetching…';
      showStatus('Fetching ZEC rate…');
    } else if (currentFetchStatus?.state === 'error') {
      updatedEl.textContent = 'no rate yet';
      showStatus("No rate yet — tap Refresh (couldn't reach the rate API)", 'error');
    } else {
      updatedEl.textContent = 'fetching…';
    }
    return;
  }

  updatedEl.textContent = formatRelativeTime(rates.updatedAt);
  if (isRatesStale(rates, 60 * 60 * 1000)) {
    updatedEl.classList.add('very-stale');
  } else if (isRatesStale(rates)) {
    updatedEl.classList.add('stale');
  }
}

function formatRate(rate: number): string {
  if (rate >= 1) {
    return rate.toFixed(4);
  }
  return rate.toPrecision(4);
}

// The code is rendered in its own element next to this value, so formatting
// with style:'currency' produced "1 ZEC = $47.62 USD". The code is also the
// unambiguous half — "$" is USD, CAD, AUD and MXN.
function formatFiatPrice(price: number, currency: string): string {
  const digits = currency === 'JPY' || currency === 'KRW' ? 0 : 2;
  return price.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

init();

// ---------------------------------------------------------------------------
// Your month, in ZEC
//
// Deliberately in the popup rather than buried in options: a number you see
// daily is one you eventually think in, and this is the number the whole
// unit-of-account claim rests on.
// ---------------------------------------------------------------------------

const positionSection = document.getElementById('position')!;
const positionNet = document.getElementById('position-net')!;
const positionIn = document.getElementById('position-in')!;
const positionOut = document.getElementById('position-out')!;
const positionGaps = document.getElementById('position-gaps')!;

async function renderPosition(settings: Settings, rates: RatesData | null) {
  const liabilities = settings.liabilities ?? [];
  if (liabilities.length === 0 || !rates) {
    positionSection.hidden = true;
    return;
  }

  const held = settings.rateMode === 'spot' ? null : await getHeldRate();
  const { incoming, outgoing, net, unpriced } = monthlyPosition(liabilities, rates, held);

  positionSection.hidden = false;
  positionNet.textContent = `${net >= 0 ? '+' : ''}${formatZecWithSymbol(net, 'coarse')}`;
  positionNet.classList.toggle('negative', net < 0);
  positionIn.textContent = `in ${formatZecWithSymbol(incoming, 'coarse')}`;
  positionOut.textContent = `out ${formatZecWithSymbol(outgoing, 'coarse')}`;

  // Say what is missing rather than quietly reporting a smaller total.
  positionGaps.hidden = unpriced.length === 0;
  positionGaps.textContent = unpriced.length > 0
    ? `No rate for ${unpriced.join(', ')} — not counted.`
    : '';
}

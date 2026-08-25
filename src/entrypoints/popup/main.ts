import { storage } from 'wxt/utils/storage';
import type { NymStatus } from '../../lib/fetch/types';
import {
  getFetchStatus,
  getRates,
  isRatesStale,
  type RateFetchStatus,
  type RatesData,
  watchFetchStatus,
  watchRates,
} from '../../lib/storage/rates';
import { getSettings, setSettings, type Settings, watchSettings } from '../../lib/storage/settings';

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
const siteFilterToggle = document.getElementById('site-filter-toggle')!;
const siteFilterContent = document.getElementById('site-filter-content')!;
const toggleIcon = document.getElementById('toggle-icon')!;
const siteModeRadios = document.querySelectorAll<HTMLInputElement>('input[name="siteMode"]');
const blockedSitesTextarea = document.getElementById('blockedSites') as HTMLTextAreaElement;
const allowedSitesTextarea = document.getElementById('allowedSites') as HTMLTextAreaElement;
const blocklistContainer = document.getElementById('blocklist-container')!;
const allowlistContainer = document.getElementById('allowlist-container')!;

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
  populateSiteFiltering(settings);
  updateNymStatus(settings.nymEnabled, nymStatus ?? 'disconnected');
  void initSiteRow();

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
  });

  watchRates((r) => {
    currentRates = r;
    updateRateDisplay();
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

  optionsBtn.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });

  // Site filter toggle
  siteFilterToggle.addEventListener('click', () => {
    const isExpanded = siteFilterContent.classList.toggle('expanded');
    siteFilterToggle.classList.toggle('expanded', isExpanded);
    siteFilterToggle.setAttribute('aria-expanded', String(isExpanded));
    toggleIcon.classList.toggle('expanded', isExpanded);
  });

  // Site mode radios
  siteModeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      updateSiteListVisibility();
      debouncedSave();
    });
  });

  // Site list textareas - auto-save on change
  blockedSitesTextarea.addEventListener('input', debouncedSave);
  allowedSitesTextarea.addEventListener('input', debouncedSave);

  // The popup document dies the instant it loses focus, killing pending
  // debounce timers — flush unsaved site-filter edits before that happens.
  window.addEventListener('blur', flushPendingSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSave();
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
  if (s.siteMode === 'blocklist') {
    const blocked = s.blockedSites.includes(currentHostname);
    siteToggleBtn.textContent = blocked ? 'Enable here' : 'Disable here';
    siteToggleBtn.onclick = async () => {
      const blockedSites = blocked
        ? s.blockedSites.filter((h) => h !== currentHostname)
        : [...s.blockedSites, currentHostname!];
      await setSettings({ blockedSites });
      blockedSitesTextarea.value = blockedSites.join('\n');
    };
  } else {
    const allowed = s.allowedSites.includes(currentHostname);
    siteToggleBtn.textContent = allowed ? 'Disable here' : 'Enable here';
    siteToggleBtn.onclick = async () => {
      const allowedSites = allowed
        ? s.allowedSites.filter((h) => h !== currentHostname)
        : [...s.allowedSites, currentHostname!];
      await setSettings({ allowedSites });
      allowedSitesTextarea.value = allowedSites.join('\n');
    };
  }
}

// --- Site filtering form --------------------------------------------------

function populateSiteFiltering(settings: Settings) {
  siteModeRadios.forEach((radio) => {
    radio.checked = radio.value === settings.siteMode;
  });
  blockedSitesTextarea.value = settings.blockedSites.join('\n');
  allowedSitesTextarea.value = settings.allowedSites.join('\n');
  updateSiteListVisibility();
}

function updateSiteListVisibility() {
  const selectedMode = document.querySelector<HTMLInputElement>('input[name="siteMode"]:checked')
    ?.value;
  blocklistContainer.classList.toggle('active', selectedMode === 'blocklist');
  allowlistContainer.classList.toggle('active', selectedMode === 'allowlist');
}

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

function debouncedSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveSiteFiltering, 500);
}

function flushPendingSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
    void saveSiteFiltering();
  }
}

async function saveSiteFiltering() {
  const siteMode = document.querySelector<HTMLInputElement>('input[name="siteMode"]:checked')
    ?.value as
      | 'blocklist'
      | 'allowlist';

  const blockedSites = blockedSitesTextarea.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const allowedSites = allowedSitesTextarea.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  await setSettings({ siteMode, blockedSites, allowedSites });
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

  sourceEl.textContent = rates?.source || '--';

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

function formatFiatPrice(price: number, currency: string): string {
  try {
    return price.toLocaleString(undefined, { style: 'currency', currency });
  } catch {
    return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
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

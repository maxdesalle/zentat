import { getSettings, setSettings, watchSettings, type Settings } from '../../lib/storage/settings';
import { getRates, watchRates } from '../../lib/storage/rates';

const enabledCheckbox = document.getElementById('enabled') as HTMLInputElement;
const zecUsdValue = document.getElementById('zec-usd-value')!;
const usdZecValue = document.getElementById('usd-zec-value')!;
const sourceEl = document.getElementById('source')!;
const updatedEl = document.getElementById('updated')!;
const refreshBtn = document.getElementById('refresh') as HTMLButtonElement;
const optionsBtn = document.getElementById('options')!;

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

async function init() {
  // Load initial state
  const [settings, rates] = await Promise.all([getSettings(), getRates()]);

  enabledCheckbox.checked = settings.enabled;
  updateRateDisplay(rates.rates.USD, rates.source, rates.updatedAt);
  populateSiteFiltering(settings);

  // Watch for changes
  watchSettings((s) => {
    enabledCheckbox.checked = s.enabled;
  });

  watchRates((r) => {
    updateRateDisplay(r.rates.USD, r.source, r.updatedAt);
  });

  // Event listeners
  enabledCheckbox.addEventListener('change', async () => {
    await setSettings({ enabled: enabledCheckbox.checked });
  });

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;

    try {
      await browser.runtime.sendMessage({ type: 'refreshRates' });
      const rates = await getRates();
      updateRateDisplay(rates.rates.USD, rates.source, rates.updatedAt);
    } finally {
      refreshBtn.classList.remove('loading');
      refreshBtn.disabled = false;
    }
  });

  optionsBtn.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });

  // Site filter toggle
  siteFilterToggle.addEventListener('click', () => {
    const isExpanded = siteFilterContent.classList.toggle('expanded');
    siteFilterToggle.classList.toggle('expanded', isExpanded);
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
}

function populateSiteFiltering(settings: Settings) {
  siteModeRadios.forEach((radio) => {
    radio.checked = radio.value === settings.siteMode;
  });
  blockedSitesTextarea.value = settings.blockedSites.join('\n');
  allowedSitesTextarea.value = settings.allowedSites.join('\n');
  updateSiteListVisibility();
}

function updateSiteListVisibility() {
  const selectedMode = document.querySelector<HTMLInputElement>('input[name="siteMode"]:checked')?.value;
  blocklistContainer.classList.toggle('active', selectedMode === 'blocklist');
  allowlistContainer.classList.toggle('active', selectedMode === 'allowlist');
}

function debouncedSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveSiteFiltering, 500);
}

async function saveSiteFiltering() {
  const siteMode = document.querySelector<HTMLInputElement>('input[name="siteMode"]:checked')?.value as
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

function updateRateDisplay(usdRate: number | undefined, source: string, updatedAt: number) {
  if (usdRate !== undefined) {
    // USD→ZEC rate (what we get from API)
    usdZecValue.textContent = formatRate(usdRate);
    // ZEC→USD rate (inverse)
    const zecToUsd = 1 / usdRate;
    zecUsdValue.textContent = formatUsdPrice(zecToUsd);
  } else {
    zecUsdValue.textContent = '--';
    usdZecValue.textContent = '--';
  }

  sourceEl.textContent = source || '--';
  updatedEl.textContent = updatedAt ? formatRelativeTime(updatedAt) : '--';
}

function formatRate(rate: number): string {
  if (rate >= 1) {
    return rate.toFixed(4);
  }
  return rate.toPrecision(4);
}

function formatUsdPrice(price: number): string {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

  return 'over a day ago';
}

init();

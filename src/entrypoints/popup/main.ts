import { getSettings, setSettings, watchSettings } from '../../lib/storage/settings';
import { getRates, watchRates } from '../../lib/storage/rates';

const enabledCheckbox = document.getElementById('enabled') as HTMLInputElement;
const rateValue = document.getElementById('rate-value')!;
const sourceEl = document.getElementById('source')!;
const updatedEl = document.getElementById('updated')!;
const refreshBtn = document.getElementById('refresh') as HTMLButtonElement;
const optionsBtn = document.getElementById('options')!;

async function init() {
  // Load initial state
  const [settings, rates] = await Promise.all([getSettings(), getRates()]);

  enabledCheckbox.checked = settings.enabled;
  updateRateDisplay(rates.rates.USD, rates.source, rates.updatedAt);

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
}

function updateRateDisplay(usdRate: number | undefined, source: string, updatedAt: number) {
  if (usdRate !== undefined) {
    // Format to show meaningful precision
    rateValue.textContent = formatRate(usdRate);
  } else {
    rateValue.textContent = '--';
  }

  sourceEl.textContent = source || '--';
  updatedEl.textContent = updatedAt ? formatRelativeTime(updatedAt) : '--';
}

function formatRate(rate: number): string {
  if (rate >= 1) {
    return rate.toFixed(4);
  }
  // For small numbers, show more decimals
  return rate.toPrecision(4);
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

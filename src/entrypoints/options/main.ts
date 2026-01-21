import { getSettings, setSettings, type Settings } from '../../lib/storage/settings';

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'KRW', name: 'Korean Won' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
];

const currenciesContainer = document.getElementById('currencies')!;
const precisionRadios = document.querySelectorAll<HTMLInputElement>('input[name="precision"]');
const siteModeRadios = document.querySelectorAll<HTMLInputElement>('input[name="siteMode"]');
const blockedSitesTextarea = document.getElementById('blockedSites') as HTMLTextAreaElement;
const allowedSitesTextarea = document.getElementById('allowedSites') as HTMLTextAreaElement;
const blocklistContainer = document.getElementById('blocklist-container')!;
const allowlistContainer = document.getElementById('allowlist-container')!;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;

let currentSettings: Settings;

async function init() {
  // Build currency checkboxes
  for (const currency of CURRENCIES) {
    const label = document.createElement('label');
    label.className = 'currency-option';
    label.innerHTML = `
      <input type="checkbox" value="${currency.code}" />
      <span>${currency.code}</span>
    `;
    currenciesContainer.appendChild(label);
  }

  // Load settings
  currentSettings = await getSettings();
  populateForm(currentSettings);

  // Event listeners
  siteModeRadios.forEach((radio) => {
    radio.addEventListener('change', updateSiteListVisibility);
  });

  saveBtn.addEventListener('click', save);
}

function populateForm(settings: Settings) {
  // Currencies
  const checkboxes = currenciesContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  checkboxes.forEach((cb) => {
    cb.checked = settings.currencies.includes(cb.value);
  });

  // Precision
  const precisionValue = settings.precision === 'auto' ? 'auto' : String(settings.precision);
  precisionRadios.forEach((radio) => {
    radio.checked = radio.value === precisionValue;
  });

  // Site mode
  siteModeRadios.forEach((radio) => {
    radio.checked = radio.value === settings.siteMode;
  });

  // Site lists
  blockedSitesTextarea.value = settings.blockedSites.join('\n');
  allowedSitesTextarea.value = settings.allowedSites.join('\n');

  updateSiteListVisibility();
}

function updateSiteListVisibility() {
  const selectedMode = document.querySelector<HTMLInputElement>('input[name="siteMode"]:checked')?.value;

  blocklistContainer.classList.toggle('active', selectedMode === 'blocklist');
  allowlistContainer.classList.toggle('active', selectedMode === 'allowlist');
}

function getFormValues(): Partial<Settings> {
  // Currencies
  const checkboxes = currenciesContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
  const currencies = Array.from(checkboxes).map((cb) => cb.value);

  // Precision
  const precisionRadio = document.querySelector<HTMLInputElement>('input[name="precision"]:checked');
  const precision = precisionRadio?.value === 'auto' ? 'auto' : parseInt(precisionRadio?.value || '2', 10);

  // Site mode
  const siteMode = document.querySelector<HTMLInputElement>('input[name="siteMode"]:checked')?.value as
    | 'blocklist'
    | 'allowlist';

  // Site lists
  const blockedSites = blockedSitesTextarea.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const allowedSites = allowedSitesTextarea.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    currencies,
    precision,
    siteMode,
    blockedSites,
    allowedSites,
  };
}

async function save() {
  saveBtn.disabled = true;
  statusEl.textContent = '';

  try {
    const values = getFormValues();
    await setSettings(values);
    currentSettings = await getSettings();

    statusEl.textContent = 'Saved!';
    setTimeout(() => {
      statusEl.textContent = '';
    }, 2000);
  } catch (error) {
    statusEl.textContent = 'Error saving settings';
    console.error('Save error:', error);
  } finally {
    saveBtn.disabled = false;
  }
}

init();

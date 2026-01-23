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
const displayCurrencySelect = document.getElementById('displayCurrency') as HTMLSelectElement;
const precisionRadios = document.querySelectorAll<HTMLInputElement>('input[name="precision"]');
const nymEnabledCheckbox = document.getElementById('nymEnabled') as HTMLInputElement;

let currentSettings: Settings;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

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

  // Auto-save on any change
  currenciesContainer.addEventListener('change', debouncedSave);
  displayCurrencySelect.addEventListener('change', debouncedSave);
  precisionRadios.forEach((radio) => radio.addEventListener('change', debouncedSave));
  nymEnabledCheckbox.addEventListener('change', debouncedSave);
}

function debouncedSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(save, 300);
}

function populateForm(settings: Settings) {
  // Currencies
  const checkboxes = currenciesContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  checkboxes.forEach((cb) => {
    cb.checked = settings.currencies.includes(cb.value);
  });

  // Display currency
  displayCurrencySelect.value = settings.displayCurrency;

  // Precision
  const precisionValue = settings.precision === 'auto' ? 'auto' : String(settings.precision);
  precisionRadios.forEach((radio) => {
    radio.checked = radio.value === precisionValue;
  });

  // Nym settings
  nymEnabledCheckbox.checked = settings.nymEnabled;
}

function getFormValues(): Partial<Settings> {
  // Currencies
  const checkboxes = currenciesContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
  const currencies = Array.from(checkboxes).map((cb) => cb.value);

  // Display currency
  const displayCurrency = displayCurrencySelect.value;

  // Precision
  const precisionRadio = document.querySelector<HTMLInputElement>('input[name="precision"]:checked');
  const precision = precisionRadio?.value === 'auto' ? 'auto' : parseInt(precisionRadio?.value || '2', 10);

  return {
    currencies,
    displayCurrency,
    precision,
    nymEnabled: nymEnabledCheckbox.checked,
  };
}

async function save() {
  try {
    const values = getFormValues();
    await setSettings(values);
    currentSettings = await getSettings();
  } catch (error) {
    console.error('Save error:', error);
  }
}

init();

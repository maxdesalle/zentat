import { storage } from 'wxt/utils/storage';
import { SUPPORTED_CURRENCIES } from '../../lib/currencies';
import type { NymStatus } from '../../lib/fetch/types';
import {
  DEFAULT_SETTINGS,
  getSettings,
  setSettings,
  type Settings,
} from '../../lib/storage/settings';

const enabledCheckbox = document.getElementById('enabled') as HTMLInputElement;
const currenciesContainer = document.getElementById('currencies')!;
const currencyHint = document.getElementById('currency-hint') as HTMLParagraphElement;
const displayCurrencySelect = document.getElementById('displayCurrency') as HTMLSelectElement;
const precisionRadios = () =>
  document.querySelectorAll<HTMLInputElement>('input[name="precision"]');
const displayModeRadios = () =>
  document.querySelectorAll<HTMLInputElement>('input[name="displayMode"]');
const displayUnitRadios = () =>
  document.querySelectorAll<HTMLInputElement>('input[name="displayUnit"]');
const siteModeRadios = () => document.querySelectorAll<HTMLInputElement>('input[name="siteMode"]');
const nymEnabledCheckbox = document.getElementById('nymEnabled') as HTMLInputElement;
const nymPill = document.getElementById('nym-pill') as HTMLSpanElement;
const blockedSitesTextarea = document.getElementById('blockedSites') as HTMLTextAreaElement;
const allowedSitesTextarea = document.getElementById('allowedSites') as HTMLTextAreaElement;
const blocklistContainer = document.getElementById('blocklist-container')!;
const allowlistContainer = document.getElementById('allowlist-container')!;
const rateSourceSelect = document.getElementById('rateSource') as HTMLSelectElement;
const nymTimeoutSelect = document.getElementById('nymTimeout') as HTMLSelectElement;
const resetButton = document.getElementById('reset-defaults') as HTMLButtonElement;
const selectAllBtn = document.getElementById('select-all') as HTMLButtonElement;
const selectNoneBtn = document.getElementById('select-none') as HTMLButtonElement;
const saveIndicator = document.getElementById('save-indicator') as HTMLDivElement;

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let indicatorTimeout: ReturnType<typeof setTimeout> | null = null;

async function init() {
  // Build currency checkboxes and the display-currency select from the single
  // shared currency list (previously three hardcoded copies drifted apart)
  for (const currency of SUPPORTED_CURRENCIES) {
    const label = document.createElement('label');
    label.className = 'currency-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = currency.code;
    const span = document.createElement('span');
    span.textContent = `${currency.code} · ${currency.name}`;
    label.append(input, span);
    currenciesContainer.appendChild(label);

    const option = document.createElement('option');
    option.value = currency.code;
    option.textContent = `${currency.code} - ${currency.name}`;
    displayCurrencySelect.appendChild(option);
  }

  const settings = await getSettings();
  populateForm(settings);
  void updateNymPill(settings.nymEnabled);

  storage.watch<NymStatus>('local:nymStatus', () => {
    void updateNymPill(nymEnabledCheckbox.checked);
  });

  // Auto-save on any change
  enabledCheckbox.addEventListener('change', debouncedSave);
  currenciesContainer.addEventListener('change', () => {
    updateCurrencyHint();
    debouncedSave();
  });
  displayCurrencySelect.addEventListener('change', debouncedSave);
  rateSourceSelect.addEventListener('change', debouncedSave);
  nymTimeoutSelect.addEventListener('change', debouncedSave);
  precisionRadios().forEach((r) => r.addEventListener('change', debouncedSave));
  displayModeRadios().forEach((r) => r.addEventListener('change', debouncedSave));
  displayUnitRadios().forEach((r) => r.addEventListener('change', debouncedSave));
  siteModeRadios().forEach((r) =>
    r.addEventListener('change', () => {
      updateSiteListVisibility();
      debouncedSave();
    })
  );
  nymEnabledCheckbox.addEventListener('change', () => {
    void updateNymPill(nymEnabledCheckbox.checked);
    debouncedSave();
  });
  blockedSitesTextarea.addEventListener('input', debouncedSave);
  allowedSitesTextarea.addEventListener('input', debouncedSave);

  selectAllBtn.addEventListener('click', () => {
    setAllCurrencies(true);
  });
  selectNoneBtn.addEventListener('click', () => {
    setAllCurrencies(false);
  });

  resetButton.addEventListener('click', async () => {
    if (!confirm('Reset all Zentat settings to their defaults?')) return;
    await setSettings({ ...DEFAULT_SETTINGS });
    populateForm(await getSettings());
    showSaved('Defaults restored');
  });

  // Don't lose an edit made just before the tab closes
  window.addEventListener('pagehide', flushPendingSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSave();
  });
}

function setAllCurrencies(checked: boolean) {
  currenciesContainer
    .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    .forEach((cb) => (cb.checked = checked));
  updateCurrencyHint();
  debouncedSave();
}

function updateCurrencyHint() {
  const anyChecked = currenciesContainer.querySelector('input[type="checkbox"]:checked') !== null;
  currencyHint.hidden = anyChecked;
}

async function updateNymPill(nymEnabled: boolean) {
  if (!nymEnabled) {
    nymPill.hidden = true;
    return;
  }
  const status = (await storage.getItem<NymStatus>('local:nymStatus')) ?? 'disconnected';
  nymPill.hidden = false;
  nymPill.className = 'status-pill ' + status;
  nymPill.textContent = status === 'connected'
    ? 'connected'
    : status === 'connecting'
    ? 'connecting…'
    : status === 'error'
    ? 'failed'
    : 'idle';
}

function debouncedSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(save, 300);
}

function flushPendingSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
    void save();
  }
}

function populateForm(settings: Settings) {
  enabledCheckbox.checked = settings.enabled;

  const checkboxes = currenciesContainer.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  checkboxes.forEach((cb) => {
    cb.checked = settings.currencies.includes(cb.value);
  });
  updateCurrencyHint();

  displayCurrencySelect.value = settings.displayCurrency;
  rateSourceSelect.value = settings.rateSource;
  nymTimeoutSelect.value = String(settings.nymTimeoutMs);
  if (nymTimeoutSelect.value === '') nymTimeoutSelect.value = '60000';

  const precisionValue = settings.precision === 'auto' ? 'auto' : String(settings.precision);
  precisionRadios().forEach((radio) => {
    radio.checked = radio.value === precisionValue;
  });
  displayModeRadios().forEach((radio) => {
    radio.checked = radio.value === settings.displayMode;
  });
  displayUnitRadios().forEach((radio) => {
    radio.checked = radio.value === settings.displayUnit;
  });
  siteModeRadios().forEach((radio) => {
    radio.checked = radio.value === settings.siteMode;
  });
  blockedSitesTextarea.value = settings.blockedSites.join('\n');
  allowedSitesTextarea.value = settings.allowedSites.join('\n');
  updateSiteListVisibility();

  nymEnabledCheckbox.checked = settings.nymEnabled;
}

function updateSiteListVisibility() {
  const selectedMode = document.querySelector<HTMLInputElement>('input[name="siteMode"]:checked')
    ?.value;
  blocklistContainer.classList.toggle('active', selectedMode === 'blocklist');
  allowlistContainer.classList.toggle('active', selectedMode === 'allowlist');
}

function getFormValues(): Partial<Settings> {
  const checkboxes = currenciesContainer.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]:checked',
  );
  // An empty selection is a valid choice ("convert nothing") and is preserved
  const currencies = Array.from(checkboxes).map((cb) => cb.value);

  const precisionRadio = document.querySelector<HTMLInputElement>(
    'input[name="precision"]:checked',
  );
  const precision = precisionRadio?.value === 'auto'
    ? 'auto'
    : parseInt(precisionRadio?.value || '2', 10);
  const displayMode = (document.querySelector<HTMLInputElement>('input[name="displayMode"]:checked')
    ?.value ?? 'replace') as Settings['displayMode'];
  const displayUnit = (document.querySelector<HTMLInputElement>('input[name="displayUnit"]:checked')
    ?.value ?? 'auto') as Settings['displayUnit'];
  const siteMode = (document.querySelector<HTMLInputElement>('input[name="siteMode"]:checked')
    ?.value ?? 'blocklist') as Settings['siteMode'];

  const splitLines = (value: string) =>
    value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

  return {
    enabled: enabledCheckbox.checked,
    currencies,
    displayCurrency: displayCurrencySelect.value,
    precision,
    displayMode,
    displayUnit,
    siteMode,
    blockedSites: splitLines(blockedSitesTextarea.value),
    allowedSites: splitLines(allowedSitesTextarea.value),
    rateSource: rateSourceSelect.value as Settings['rateSource'],
    nymTimeoutMs: parseInt(nymTimeoutSelect.value, 10) || 60000,
    nymEnabled: nymEnabledCheckbox.checked,
  };
}

async function save() {
  try {
    await setSettings(getFormValues());
    showSaved('Saved ✓');
  } catch (error) {
    console.error('Save error:', error);
    showSaved('Could not save — storage error', true);
  }
}

function showSaved(message: string, isError: boolean = false) {
  saveIndicator.textContent = message;
  saveIndicator.classList.toggle('error', isError);
  saveIndicator.classList.add('visible');
  if (indicatorTimeout) clearTimeout(indicatorTimeout);
  indicatorTimeout = setTimeout(
    () => saveIndicator.classList.remove('visible'),
    isError ? 6000 : 1500,
  );
}

init();

import { storage } from 'wxt/utils/storage';
import { type Anchor, createAnchor, driftedAnchors, MAX_ANCHORS } from '../../lib/anchors';
import { SUPPORTED_CURRENCIES } from '../../lib/currencies';
import type { NymStatus } from '../../lib/fetch/types';
import { localizeDocument } from '../../lib/i18n';
import {
  type Cadence,
  createLiability,
  type Liability,
  MAX_LIABILITIES,
} from '../../lib/liabilities';
import { clearSeenPrices, getSeenPrices } from '../../lib/storage/practice';
import { getRates } from '../../lib/storage/rates';
import {
  DEFAULT_SETTINGS,
  getSettings,
  setSettings,
  type Settings,
  watchSettings,
} from '../../lib/storage/settings';
import { daysToNextStage, describeStage, weanStage } from '../../lib/weaning';

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
const weanCheckbox = document.getElementById('weanFromFiat') as HTMLInputElement;
const weanStageLine = document.getElementById('wean-stage')!;
const hideFiatCheckbox = document.getElementById('hideFiat') as HTMLInputElement;
const practiceSeenCheckbox = document.getElementById('practiceFromSeen') as HTMLInputElement;
const practiceClear = document.getElementById('practice-clear')!;
const practiceCount = document.getElementById('practice-count')!;
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

let lastKnown: Settings | null = null;
let saving = false;

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
  lastKnown = settings;
  initAnchors();
  initLiabilities();
  populateForm(settings);
  void renderAnchors(settings.anchors ?? []);
  renderLiabilities(settings.liabilities ?? []);
  void updateNymPill(settings.nymEnabled);

  // Without this, the form is a snapshot taken at load. A change made from the
  // popup (or a second options tab, or Alt+Z) was invisible here, and the next
  // edit wrote the whole stale form back over it — silently undoing it.
  watchSettings((next) => {
    if (saving) return;
    lastKnown = next;
    populateForm(next);
    void renderAnchors(next.anchors ?? []);
    renderLiabilities(next.liabilities ?? []);
    void updateNymPill(next.nymEnabled);
  });

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

  const precisionValue = String(settings.precision);
  precisionRadios().forEach((radio) => {
    radio.checked = radio.value === precisionValue;
  });
  displayModeRadios().forEach((radio) => {
    radio.checked = radio.value === settings.displayMode;
  });
  displayUnitRadios().forEach((radio) => {
    // 'auto' and 'zec' are the same behaviour now, and the auto radio is gone.
    // A stored 'auto' — which is every existing install — selects ZEC.
    radio.checked =
      radio.value === (settings.displayUnit === 'auto' ? 'zec' : settings.displayUnit);
  });
  siteModeRadios().forEach((radio) => {
    radio.checked = radio.value === settings.siteMode;
  });
  blockedSitesTextarea.value = settings.blockedSites.join('\n');
  allowedSitesTextarea.value = settings.allowedSites.join('\n');
  updateSiteListVisibility();

  hideFiatCheckbox.checked = settings.hideFiat;
  practiceSeenCheckbox.checked = settings.practiceFromSeen;
  weanCheckbox.checked = settings.weanFromFiat;
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="rateMode"]')) {
    radio.checked = radio.value === settings.rateMode;
  }
  renderWeanStage(settings);
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
  const raw = precisionRadio?.value;
  const precision = raw === 'auto' || raw === 'coarse'
    ? (raw as 'auto' | 'coarse')
    : parseInt(raw || '2', 10);
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
    hideFiat: hideFiatCheckbox.checked,
    practiceFromSeen: practiceSeenCheckbox.checked,
    weanFromFiat: weanCheckbox.checked,
    // Starting the clock on the first enable is what makes the schedule mean
    // anything; re-enabling later must not silently reset progress.
    weanStartedAt: weanCheckbox.checked
      ? (lastKnown?.weanStartedAt || Date.now())
      : (lastKnown?.weanStartedAt ?? 0),
    rateMode: (document.querySelector<HTMLInputElement>('input[name="rateMode"]:checked')
      ?.value ?? 'held') as Settings['rateMode'],
    nymEnabled: nymEnabledCheckbox.checked,
  };
}

async function save() {
  saving = true;
  try {
    // Send only what this form actually changed. Writing all twelve fields
    // meant every save carried whatever the DOM last happened to hold.
    const values = getFormValues();
    const changed: Partial<Settings> = {};
    for (const [key, value] of Object.entries(values) as [keyof Settings, unknown][]) {
      if (!sameValue(lastKnown?.[key], value)) {
        (changed as Record<string, unknown>)[key] = value;
      }
    }
    if (Object.keys(changed).length === 0) return;

    await setSettings(changed);
    lastKnown = { ...(lastKnown as Settings), ...changed };
    showSaved('Saved ✓');
  } catch (error) {
    console.error('Save error:', error);
    showSaved('Could not save — storage error', true);
  } finally {
    saving = false;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
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

// ---------------------------------------------------------------------------
// Price anchors
// ---------------------------------------------------------------------------

const anchorList = document.getElementById('anchor-list')!;
const anchorForm = document.getElementById('anchor-form') as HTMLFormElement;
const anchorLabel = document.getElementById('anchor-label') as HTMLInputElement;
const anchorAmount = document.getElementById('anchor-amount') as HTMLInputElement;
const anchorCurrency = document.getElementById('anchor-currency') as HTMLSelectElement;
const anchorHint = document.getElementById('anchor-hint')!;
const anchorDrift = document.getElementById('anchor-drift')!;

function initAnchors() {
  for (const { code, name } of SUPPORTED_CURRENCIES) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = `${code} — ${name}`;
    anchorCurrency.appendChild(option);
  }

  anchorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rates = await getRates();
    const anchor = createAnchor(
      anchorLabel.value,
      Number(anchorAmount.value),
      anchorCurrency.value,
      rates,
    );
    if (!anchor) {
      anchorHint.textContent = 'Need a name, an amount, and a rate for that currency.';
      return;
    }
    const anchors = [...(lastKnown?.anchors ?? []), anchor].slice(0, MAX_ANCHORS);
    await setSettings({ anchors });
    anchorForm.reset();
    anchorCurrency.value = lastKnown?.displayCurrency ?? 'USD';
  });
}

async function renderAnchors(anchors: Anchor[]) {
  anchorList.replaceChildren();

  for (const anchor of anchors) {
    const item = document.createElement('li');
    item.className = 'anchor-item';

    const text = document.createElement('span');
    text.textContent = `${anchor.label} — ${anchor.amount} ${anchor.currency}`;
    item.appendChild(text);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'anchor-remove';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${anchor.label}`);
    remove.addEventListener('click', async () => {
      await setSettings({
        anchors: (lastKnown?.anchors ?? []).filter((a) => a.id !== anchor.id),
      });
    });
    item.appendChild(remove);

    anchorList.appendChild(item);
  }

  anchorHint.textContent = anchors.length >= MAX_ANCHORS
    ? `That's the maximum (${MAX_ANCHORS}). Remove one to add another.`
    : anchors.length === 0
    ? 'Add one or two — a coffee and your rent go a long way.'
    : '';

  // Drift is the maintenance ritual that keeps a volatile unit usable: a
  // memorised level goes quietly wrong, so say so and ask for a re-look.
  const drifted = driftedAnchors(anchors, await getRates());
  anchorDrift.hidden = drifted.length === 0;
  anchorDrift.replaceChildren();
  for (const { anchor, change } of drifted) {
    const line = document.createElement('p');
    const direction = change > 0 ? 'more' : 'less';
    line.textContent = `${anchor.label} now costs ${Math.round(Math.abs(change) * 100)}% `
      + `${direction} ZEC than when you set it — worth a re-look.`;
    anchorDrift.appendChild(line);
  }
}

function renderWeanStage(settings: Settings) {
  if (!settings.weanFromFiat || !settings.weanStartedAt) {
    weanStageLine.textContent = '';
    return;
  }
  const stage = weanStage(settings.weanStartedAt);
  const days = daysToNextStage(settings.weanStartedAt);
  weanStageLine.textContent = days === null
    ? describeStage(stage)
    : `${describeStage(stage)} Next step in ${days} day${days === 1 ? '' : 's'}.`;
}

// Applied once at load: browser.i18n resolves synchronously, so there is no
// flash of untranslated text.
localizeDocument();

// ---------------------------------------------------------------------------
// What you earn and owe
//
// The model, the arithmetic and the popup's monthly position all existed; the
// only missing piece was any way to enter one. Until rent and salary live in
// ZEC, converting shop prices is translation, not a unit of account — so a
// feature nobody could reach was the one that mattered most.
// ---------------------------------------------------------------------------

const liabilityList = document.getElementById('liability-list')!;
const liabilityForm = document.getElementById('liability-form') as HTMLFormElement;
const liabilityLabel = document.getElementById('liability-label') as HTMLInputElement;
const liabilityAmount = document.getElementById('liability-amount') as HTMLInputElement;
const liabilityCurrency = document.getElementById('liability-currency') as HTMLSelectElement;
const liabilityCadence = document.getElementById('liability-cadence') as HTMLSelectElement;
const liabilityDirection = document.getElementById('liability-direction') as HTMLSelectElement;
const liabilityHint = document.getElementById('liability-hint')!;

const CADENCE_WORD: Record<Cadence, string> = {
  monthly: 'a month',
  weekly: 'a week',
  yearly: 'a year',
};

function initLiabilities() {
  for (const { code, name } of SUPPORTED_CURRENCIES) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = `${code} — ${name}`;
    liabilityCurrency.appendChild(option);
  }

  liabilityForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rates = await getRates();
    const liability = createLiability(
      liabilityLabel.value,
      Number(liabilityAmount.value),
      liabilityCurrency.value,
      liabilityCadence.value as Cadence,
      liabilityDirection.value as 'in' | 'out',
      rates,
    );
    if (!liability) {
      liabilityHint.textContent =
        'Need a name, an amount above zero, and a rate for that currency.';
      return;
    }
    const liabilities = [...(lastKnown?.liabilities ?? []), liability].slice(0, MAX_LIABILITIES);
    await setSettings({ liabilities });
    liabilityForm.reset();
    liabilityCurrency.value = lastKnown?.displayCurrency ?? 'USD';
  });
}

function renderLiabilities(liabilities: Liability[]) {
  liabilityList.replaceChildren();

  for (const liability of liabilities) {
    const item = document.createElement('li');
    item.className = 'anchor-item';

    const text = document.createElement('span');
    // The direction said in words rather than by a sign: a minus in front of a
    // number people are reading as money is the wrong kind of ambiguous.
    const flow = liability.direction === 'in' ? 'in' : 'out';
    text.textContent = `${liability.label} — ${liability.amount} ${liability.currency} `
      + `${CADENCE_WORD[liability.cadence]}, ${flow}`;
    item.appendChild(text);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'anchor-remove';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${liability.label}`);
    remove.addEventListener('click', async () => {
      await setSettings({
        liabilities: (lastKnown?.liabilities ?? []).filter((l) => l.id !== liability.id),
      });
    });
    item.appendChild(remove);

    liabilityList.appendChild(item);
  }

  liabilityHint.textContent = liabilities.length >= MAX_LIABILITIES
    ? `That's the maximum (${MAX_LIABILITIES}). Remove one to add another.`
    : liabilities.length === 0
    ? 'Start with your rent and your salary. The popup then shows your month in ZEC.'
    : '';
}

// ---------------------------------------------------------------------------
// Practice material
// ---------------------------------------------------------------------------

async function showPracticeCount(): Promise<void> {
  const kept = await getSeenPrices();
  practiceCount.textContent = kept.length === 0
    ? 'Nothing kept yet.'
    : `${kept.length} price${kept.length === 1 ? '' : 's'} kept.`;
}

// Turning it off empties the store. PRIVACY.md says so in as many words, and a
// promise in that file has to be literally true of the code — a setting that
// merely stops ADDING to a list the user asked to be rid of would make it a lie.
practiceSeenCheckbox.addEventListener('change', async () => {
  if (!practiceSeenCheckbox.checked) await clearSeenPrices();
  await showPracticeCount();
});

practiceClear.addEventListener('click', async () => {
  await clearSeenPrices();
  await showPracticeCount();
});

void showPracticeCount();

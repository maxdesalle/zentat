import { formatZecWithSymbol } from '../../lib/conversion/format';
import { SUPPORTED_CURRENCIES } from '../../lib/currencies';
import { localizeDocument } from '../../lib/i18n';
import { getRates, watchRates } from '../../lib/storage/rates';
import { setSettings } from '../../lib/storage/settings';

// The demo price is deliberately converted with the REAL fetched rate. A
// hardcoded number would be the one thing on this page that is a lie, and if
// the rate cannot be reached, the honest failure is worth more than a fake
// success — it is the best possible moment to learn the network is blocked.
const DEMO_FIAT = 348;

const demoZec = document.getElementById('demo-zec')!;
const demoFiat = document.getElementById('demo-fiat')!;
const choices = document.getElementById('currency-choices')!;
const dots = Array.from(document.querySelectorAll<HTMLElement>('.dot'));
const screens = Array.from(document.querySelectorAll<HTMLElement>('.screen'));

let reference = 'USD';

function guessCurrency(): string {
  const region = new Intl.Locale(navigator.language || 'en-US').maximize().region;
  const byRegion: Record<string, string> = {
    US: 'USD',
    GB: 'GBP',
    JP: 'JPY',
    CA: 'CAD',
    AU: 'AUD',
    CH: 'CHF',
    CN: 'CNY',
    KR: 'KRW',
    IN: 'INR',
    BR: 'BRL',
    MX: 'MXN',
    DE: 'EUR',
    FR: 'EUR',
    ES: 'EUR',
    IT: 'EUR',
    NL: 'EUR',
    BE: 'EUR',
    AT: 'EUR',
    IE: 'EUR',
    PT: 'EUR',
    FI: 'EUR',
    GR: 'EUR',
  };
  return (region && byRegion[region]) || 'USD';
}

function show(index: number): void {
  screens.forEach((screen, i) => screen.classList.toggle('is-active', i === index - 1));
  dots.forEach((dot, i) => dot.classList.toggle('is-on', i === index - 1));
  screens[index - 1]?.querySelector<HTMLElement>('.btn-primary')?.focus();
}

function renderDemo(rate: number | undefined): void {
  demoFiat.textContent = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: reference,
  }).format(DEMO_FIAT);

  demoZec.textContent = rate === undefined
    ? 'waiting for the rate…'
    : formatZecWithSymbol(DEMO_FIAT * rate);
  demoZec.classList.toggle('is-pending', rate === undefined);
}

function buildCurrencyChoices(): void {
  for (const { code, name } of SUPPORTED_CURRENCIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'currency-choice';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(code === reference));
    button.dataset.code = code;
    button.innerHTML = `<strong>${code}</strong><span>${name}</span>`;
    button.addEventListener('click', async () => {
      reference = code;
      for (const other of choices.children) {
        other.setAttribute('aria-checked', String(other === button));
      }
      await setSettings({ displayCurrency: code });
      renderDemo((await getRates()).rates[code]);
    });
    choices.appendChild(button);
  }
}

async function init(): Promise<void> {
  reference = guessCurrency();
  await setSettings({ displayCurrency: reference });

  buildCurrencyChoices();
  const rates = await getRates();
  renderDemo(rates.rates[reference]);

  // The first fetch may still be in flight on a fresh install.
  watchRates((next) => renderDemo(next.rates[reference]));

  for (const button of document.querySelectorAll<HTMLElement>('[data-next]')) {
    button.addEventListener('click', () => show(Number(button.dataset.next)));
  }

  for (const dot of dots) {
    dot.addEventListener('click', () => show(Number(dot.dataset.dot)));
  }

  // Opening a FRESH tab is the whole point of this button: with no blanket host
  // permission, tabs that were already open do not convert until reloaded, so
  // sending someone back to the tab they came from is the single most likely
  // way for a working install to look broken.
  document.getElementById('try-it')!.addEventListener('click', () => {
    browser.tabs.create({ url: 'https://www.amazon.com/deals' });
  });

  document.getElementById('open-options')!.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });
}

void init();

// Applied once at load: browser.i18n resolves synchronously, so there is no
// flash of untranslated text.
localizeDocument();

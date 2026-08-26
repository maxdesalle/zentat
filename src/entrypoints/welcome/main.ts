import { formatZecWithSymbol } from '../../lib/conversion/format';
import { SUPPORTED_CURRENCIES } from '../../lib/currencies';
import { localizeDocument } from '../../lib/i18n';
import { getRates, watchRates } from '../../lib/storage/rates';
import { setSettings } from '../../lib/storage/settings';

// The demo price is deliberately converted with the REAL fetched rate. A
// hardcoded number would be the one thing on this page that is a lie, and if
// the rate cannot be reached, the honest failure is worth more than a fake
// success — it is the best possible moment to learn the network is blocked.
//
// Per currency, because a single number is not a single price: 348 rendered
// as ¥348 is about two dollars, and a Korean visitor was shown ₩348 — 25
// cents — as an example of a pair of headphones. Roughly the same real value
// everywhere, rounded to something a shop would actually print.
const DEMO_PRICES: Record<string, number> = {
  USD: 348,
  EUR: 320,
  GBP: 275,
  JPY: 52_000,
  CAD: 475,
  AUD: 530,
  CHF: 310,
  CNY: 2_500,
  KRW: 480_000,
  INR: 29_000,
  BRL: 1_900,
  MXN: 6_300,
};
const demoFiatAmount = (): number => DEMO_PRICES[reference] ?? DEMO_PRICES.USD;

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
  const amount = demoFiatAmount();
  demoFiat.textContent = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: reference,
  }).format(amount);

  // Says what is happening and roughly how long, rather than trailing off.
  // This used to sit unchanged for up to ninety seconds on a fresh install,
  // so the first thing anyone saw was the product failing at its one job.
  demoZec.textContent = rate === undefined
    ? 'fetching today’s ZEC price…'
    : formatZecWithSymbol(amount * rate);
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

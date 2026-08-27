import type { Fixture } from '../types';

/**
 * Hand-written markup reproducing the shapes real sites actually use.
 *
 * Deliberately not scraped HTML: these stay readable in review, carry no
 * third-party content, and can be committed without a licensing question. The
 * shapes are what matter — each one is a pattern observed on a real site,
 * named so a failure says which site class broke.
 */
export const FIXTURES: Fixture[] = [
  {
    name: 'amazon-product',
    hostname: 'www.amazon.com',
    lang: 'en-US',
    html: `
      <div id="ppd">
        <span class="a-price">
          <span class="a-offscreen">$1,299.00</span>
          <span aria-hidden="true"><span class="a-price-symbol">$</span><span
            class="a-price-whole">1,299</span><span class="a-price-fraction">00</span></span>
        </span>
        <span class="a-icon-alt">4.5 out of 5 stars</span>
        <span id="acrCustomerReviewText">2,847 ratings</span>
      </div>`,
    expect: [{ text: '$1,299.00', currency: 'USD', amount: 1299 }],
    forbid: ['4.5 out of 5 stars', '2,847 ratings'],
  },
  {
    name: 'amazon-deal-price',
    hostname: 'www.amazon.com',
    lang: 'en-US',
    // The DEAL block, which is a different shape from the plain product price
    // above: the discount badge and the price share one aok-align-center
    // section, and the whole string "-40% $18.79" lives in an `aok-offscreen`
    // span — Amazon's OTHER accessibility class, not the `a-offscreen` the
    // adapter knows. Reported by a user as an unconverted price.
    html: `
      <div id="corePriceDisplay_desktop_feature_div" class="celwidget">
        <div class="a-section a-spacing-none aok-align-center aok-relative">
          <span class="aok-offscreen">-40% $18.79</span>
          <span class="a-size-large aok-align-center a-color-price savingsPercentage"
            aria-hidden="true">-40%</span>
          <span class="a-price aok-align-center reinventPriceToPayMargin priceToPay"
            data-a-size="xl" data-a-color="base" aria-hidden="true">
            <span class="a-offscreen">$18.79</span>
            <span aria-hidden="true"><span class="a-price-symbol">$</span><span
              class="a-price-whole">18<span class="a-price-decimal">.</span></span><span
              class="a-price-fraction">79</span></span>
          </span>
        </div>
        <div class="a-section a-spacing-small a-spacing-top-mini">
          <span class="a-size-small a-color-price">($0.47 / ounce)</span>
        </div>
        <div class="a-section a-spacing-small aok-align-center basisPrice">
          <span class="a-size-small aok-offscreen">Typical price: $31.35</span>
          <span aria-hidden="true"><span class="a-size-small a-color-secondary">Typical
            price:</span> <span class="a-size-small a-color-secondary a-text-strike"
            >$31.35</span></span>
        </div>
      </div>`,
    expect: [
      { text: '$18.79', currency: 'USD', amount: 18.79 },
      { text: '$0.47', currency: 'USD', amount: 0.47 },
      { text: '$31.35', currency: 'USD', amount: 31.35 },
    ],
    // The discount badge is not money.
    forbid: ['-40%'],
  },
  {
    name: 'split-cents-no-separator',
    hostname: 'www.example-store.com',
    lang: 'en-US',
    html: `<div class="price"><span>$</span><span>49</span><span>99</span></div>`,
    // The 100x case. Refusing is correct: there is no separator and no
    // accessible copy, so nothing can distinguish $49.99 from $4,999.
    expect: [],
    forbid: ['$4999'],
    knownGaps: [{
      text: '$49.99',
      why: 'No separator and no accessible copy — refused rather than guessed',
    }],
  },
  {
    name: 'split-cents-with-sr-copy',
    hostname: 'www.example-store.com',
    lang: 'en-US',
    html: `
      <div class="price">
        <span class="sr-only">$49.99</span>
        <span aria-hidden="true"><span>$</span><span>49</span><span>99</span></span>
      </div>`,
    expect: [{ text: '$49.99', currency: 'USD', amount: 49.99 }],
  },
  {
    name: 'superscript-cents',
    hostname: 'www.newegg.com',
    lang: 'en-US',
    html: `<li class="price-current">$<strong>132</strong><sup>.99</sup></li>`,
    expect: [{ text: '$132.99', currency: 'USD', amount: 132.99 }],
  },
  {
    name: 'saas-pricing-table',
    hostname: 'www.example-saas.com',
    lang: 'en-US',
    // Label–dash–price: the layout that used to be dropped entirely.
    html: `
      <ul>
        <li>Basic – $10/mo</li>
        <li>Pro - $29/mo</li>
        <li>Team — $99/mo</li>
      </ul>`,
    expect: [
      { text: '$10', currency: 'USD', amount: 10 },
      { text: '$29', currency: 'USD', amount: 29 },
      { text: '$99', currency: 'USD', amount: 99 },
    ],
  },
  {
    name: 'cloud-sub-cent',
    hostname: 'www.digitalocean.com',
    lang: 'en-US',
    html: `<div class="pricing"><span>$0.00595</span> per hour</div>`,
    expect: [{ text: '$0.00595', currency: 'USD', amount: 0.00595 }],
  },
  {
    name: 'latam-dot-thousands',
    hostname: 'www.tienda.com.mx',
    lang: 'es-MX',
    // "$1.500" is 1500 pesos here, not 1.5.
    html: `<p class="precio">$1.500</p>`,
    expect: [{ text: '$1.500', currency: 'MXN', amount: 1500 }],
  },
  {
    // The same markup where the currency is one we hold no rate for. The TLD
    // says Argentine pesos, ARS is not supported, and the only safe reading of
    // "$1.500" is then no reading at all — showing it as dollars is a
    // thousandfold error stated with full confidence. This fixture used to
    // expect exactly that dollar reading.
    name: 'unsupported-currency-refused',
    hostname: 'www.tienda.com.ar',
    lang: 'es-AR',
    html: `<p class="precio">$1.500</p>`,
    expect: [],
    forbid: ['$1.500'],
  },
  {
    name: 'european-formats',
    hostname: 'www.otto.de',
    lang: 'de-DE',
    html: `<div><span class="price">1.299,00 €</span><span>179,99 €</span></div>`,
    expect: [
      { text: '1.299,00 €', currency: 'EUR', amount: 1299 },
      { text: '179,99 €', currency: 'EUR', amount: 179.99 },
    ],
  },
  {
    name: 'coolblue-spec-sheet',
    hostname: 'www.coolblue.nl',
    lang: 'nl-NL',
    // The confirmed live false positives: bare numbers on a EUR-assumed host.
    html: `
      <ul class="specs">
        <li>Resolutie 1.920 x 1.080 pixels</li>
        <li>Batterij 5.000 mAh</li>
        <li>Geheugen 3.500 MHz</li>
      </ul>`,
    expect: [],
    forbid: ['1.920', '1.080', '5.000', '3.500'],
  },
  {
    name: 'editorial-prose',
    hostname: 'en.wikipedia.org',
    lang: 'en-US',
    html: `
      <p>The company was valued at $1.2 billion in 2019, up from
      $150 million. Its stock rose 4.5% on the news.</p>`,
    expect: [
      { text: '$1.2 billion', currency: 'USD', amount: 1_200_000_000 },
      { text: '$150 million', currency: 'USD', amount: 150_000_000 },
    ],
    forbid: ['2019', '4.5%'],
  },
  {
    name: 'non-price-numbers',
    hostname: 'www.example.com',
    lang: 'en-US',
    html: `
      <div>
        <span>Order #1,234</span><span>Version 2.1.4</span>
        <span>Call +1 415 555 0100</span><span>$AAPL up today</span>
        <span>Final score 3-1</span><span>The CHF is strong</span>
      </div>`,
    expect: [],
    forbid: ['1,234', '2.1.4', '555 0100', '$AAPL', '3-1'],
  },
  {
    name: 'checkout-controls-stay-fiat',
    hostname: 'www.example-store.com',
    lang: 'en-US',
    html: `
      <div>
        <p class="price">$49.99</p>
        <button id="buy-now">Buy now — $49.99</button>
      </div>`,
    // The displayed price converts; the control the merchant charges through
    // does not.
    expect: [{ text: '$49.99', currency: 'USD', amount: 49.99, count: 1 }],
  },
];

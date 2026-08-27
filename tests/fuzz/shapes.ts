// Every price shape the web puts a number in, generated rather than collected.
//
// The corpus of captured pages can only contain the shapes those pages happen
// to use, and every defect this project has shipped was a SHAPE: a symbol in a
// child element, a digit meeting a digit across a boundary, a label covering a
// subtree, a footnote marker turning a four-digit price into a suspected
// concatenation. Waiting to meet one on a real site means waiting for a user
// to find it first.
//
// So the shapes are enumerated here, each with the amount and currency it was
// built from. That is what makes the assertion exact: not "did something
// convert" but "does the number on screen follow from the number we put in".

export interface Money {
  /** The amount as a page would write it, e.g. "1.280,17". */
  written: string;
  /** What that amount actually is. */
  value: number;
  currency: string;
  /** html[lang] a page carrying this notation would declare. */
  lang: string;
}

/** How a page can spell a symbol and a number. */
export const MONEY: Money[] = [
  { written: '$19.99', value: 19.99, currency: 'USD', lang: 'en-US' },
  { written: '$1199', value: 1199, currency: 'USD', lang: 'en-US' },
  { written: '$1,199.00', value: 1199, currency: 'USD', lang: 'en-US' },
  { written: '$23.38', value: 23.38, currency: 'USD', lang: 'en-US' },
  { written: '$1,234,567', value: 1234567, currency: 'USD', lang: 'en-US' },
  { written: '$0.30', value: 0.3, currency: 'USD', lang: 'en-US' },
  { written: 'US$50', value: 50, currency: 'USD', lang: 'en-US' },
  { written: 'C$25.99', value: 25.99, currency: 'CAD', lang: 'en-CA' },
  { written: 'CA$19.49', value: 19.49, currency: 'CAD', lang: 'en-CA' },
  { written: 'CDN$ 19.49', value: 19.49, currency: 'CAD', lang: 'en-CA' },
  { written: 'A$50', value: 50, currency: 'AUD', lang: 'en-AU' },
  { written: 'R$100', value: 100, currency: 'BRL', lang: 'pt-BR' },
  { written: 'MX$200', value: 200, currency: 'MXN', lang: 'es-MX' },
  { written: '€49,99', value: 49.99, currency: 'EUR', lang: 'de-DE' },
  { written: '1.280,17 €', value: 1280.17, currency: 'EUR', lang: 'nl-BE' },
  { written: '182.900 €', value: 182900, currency: 'EUR', lang: 'de-DE' },
  { written: '350 900 €', value: 350900, currency: 'EUR', lang: 'fr-FR' },
  { written: '£1,050,000', value: 1050000, currency: 'GBP', lang: 'en-GB' },
  { written: '£9.99', value: 9.99, currency: 'GBP', lang: 'en-GB' },
  { written: '¥12,800', value: 12800, currency: 'JPY', lang: 'ja-JP' },
  { written: '₹1,17,990', value: 117990, currency: 'INR', lang: 'en-IN' },
  { written: '₩2,055,300', value: 2055300, currency: 'KRW', lang: 'ko-KR' },
];

export interface Shape {
  name: string;
  /** Markup for one price. `m` is the written amount. */
  html: (m: string) => string;
  /** Where the price ends up, for the assertion. */
  selector: string;
  /** True when the extension is RIGHT to leave this one in fiat. */
  staysFiat?: boolean;
}

/** The ways markup wraps a price, each drawn from a real page. */
export const SHAPES: Shape[] = [
  { name: 'plain text', html: (m) => `<p id="t">${m}</p>`, selector: '#t' },
  { name: 'words around it', html: (m) => `<p id="t">Now only ${m} today</p>`, selector: '#t' },
  { name: 'own span', html: (m) => `<div id="t"><span>${m}</span></div>`, selector: '#t' },
  {
    name: 'trailing footnote marker',
    html: (m) => `<p id="t">From ${m} or more<sup>**</sup></p>`,
    selector: '#t',
  },
  {
    name: 'trailing footnote link',
    html: (m) => `<p id="t">From ${m}<a href="#f">1</a></p>`,
    selector: '#t',
  },
  {
    // Only where the symbol leads: splitting "1.280,17 €" after its first
    // character puts a "1" in the child and asks the wrong question.
    name: 'symbol in its own child',
    html: (m) =>
      /^[^\d]/.test(m)
        ? `<p id="t"><span>${m.slice(0, 1)}</span>${m.slice(1)} each</p>`
        : `<p id="t"><span>${m}</span> each</p>`,
    selector: '#t',
  },
  {
    name: 'beside a sibling element',
    html: (m) => `<div id="t">${m}<span>per month</span></div>`,
    selector: '#t',
  },
  {
    name: 'nested three deep',
    html: (m) => `<div id="t"><div><div><span>${m}</span></div></div></div>`,
    selector: '#t',
  },
  {
    name: 'beside a struck-through original',
    html: (m) => `<div id="t"><s>was more</s> <span>${m}</span></div>`,
    selector: '#t',
  },
  {
    name: 'in a label with a radio',
    html: (m) => `<label id="t"><input type="radio">Option ${m}</label>`,
    selector: '#t',
  },
  {
    name: 'in a link',
    html: (m) => `<a id="t" href="/p">Product name ${m}</a>`,
    selector: '#t',
  },
  {
    name: 'in a clickable price widget',
    html: (m) => `<div id="t" role="button"><div>${m}</div></div>`,
    selector: '#t',
  },
  {
    name: 'in a checkout button',
    html: (m) => `<button id="t">Buy now ${m}</button>`,
    selector: '#t',
    staysFiat: true,
  },
  {
    name: 'with an accessible copy',
    html: (m) =>
      `<div id="t"><span class="a-offscreen">${m}</span><span aria-hidden="true">${m}</span></div>`,
    selector: '#t',
  },
  {
    name: 'inside a table cell',
    html: (m) => `<table><tr><td id="t">${m}</td><td>in stock</td></tr></table>`,
    selector: '#t',
  },
  {
    name: 'inside a list item with a rating',
    html: (m) => `<li id="t"><span>4.5 stars</span><span>${m}</span></li>`,
    selector: '#t',
  },
  {
    name: 'in a long paragraph',
    html: (m) => `<p id="t">${'Some description of the item. '.repeat(30)}It costs ${m} today.</p>`,
    selector: '#t',
  },
  {
    name: 'in a heading',
    html: (m) => `<h2 id="t">Save on ${m} models</h2>`,
    selector: '#t',
  },
];

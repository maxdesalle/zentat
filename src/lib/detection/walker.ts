import { SPAN_CLASS } from '../../entrypoints/content/markers';
import { adapterFor, isExcluded } from './adapters';
import { textLengthOf, textOf } from './dom';
import { QUICK_DETECT_PATTERN } from './patterns';
import { collectShadowRoots, hasShadowDom } from './shadow';

export { textOf } from './dom';

// Elements to skip entirely. Tag names are compared upper-cased because SVG
// and MathML elements report lowercase tagName in HTML documents.
// BUTTON is skipped so checkout CTAs ("Pay $49.99 now") never show a ZEC
// amount the merchant won't actually charge.
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'CANVAS',
  'SVG',
  'MATH',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'BUTTON',
  'CODE',
  'PRE',
  'HEAD',
]);

export function isSkippedTag(tagName: string): boolean {
  return SKIP_TAGS.has(tagName.toUpperCase());
}

// Max text length for elements to process (partial replacement handles surrounding text)
// Twitter splits long tweets into multiple spans, some of which can be 600+ chars
const MAX_PURE_PRICE_LENGTH = 1000;

export interface WalkResult {
  /** True when a site adapter identified this element as a price container. */
  inPriceContainer?: boolean;
  node: Element;
  text: string;
  // When set, only the element's DIRECT text-node children should be
  // converted — its element children carry their own prices and are walked
  // separately (fixes "<p>$10 – <span>$8</span></p>" losing the $10).
  directTextOnly?: boolean;
}

// Text that looks numeric but is not a price. Never treat the extension's own
// output ("… ZEC", "… zats") as a price — that is what allowed converted text
// to be re-parsed and compounded on sites with bare-number patterns.
export function isNonPriceText(text: string): boolean {
  if (/\bZEC\b/.test(text) || /\bzats?\b/i.test(text)) return true;
  if (/out of \d/i.test(text)) return true; // "4.5 out of 5 stars"
  // Stryker disable next-line Regex: equivalent — any run of digits contains a
  // single digit, so requiring one or more matches exactly where one does.
  if (/\d+\s*stars?\b/i.test(text)) return true; // "5 stars" (but not "$5 Starship kit")
  // Stryker disable next-line Regex: equivalent — as above, one digit and one
  // or more digits match the same strings here.
  if (/\d+[KMB]?\+?\s*(bought|sold|reviews?|ratings?)/i.test(text)) return true; // "10K+ bought"
  if (/^\d+(\.\d{1,2})?$/.test(text)) return true; // Just a plain number like "4.5"
  // "(123 reviews)" — but keep parenthesized text that contains a currency symbol
  if (/^\(\d/.test(text) && !/[$€£¥₩₹]/.test(text)) return true;
  return false;
}

// A control the user acts on, as opposed to a card that happens to be clickable.
// Modern storefronts wrap whole product tiles in role="button" or an <a>, and
// skipping those would drop entire category pages — measured across 31 real
// pages, only ~1% of prices sit in a genuine control. So the test is size, not
// tag: a checkout CTA is short, a product tile is not.
const CONTROL_SELECTOR = 'button, [role="button"], a[href], [role="link"], label, summary';
const MAX_CONTROL_DESCENDANTS = 12;
const MAX_CONTROL_TEXT = 40;

export function isInteractiveControl(el: Element): boolean {
  const control = el.closest(CONTROL_SELECTOR);
  if (!control) return false;
  const text = textOf(control);
  return text.length <= MAX_CONTROL_TEXT
    && control.getElementsByTagName('*').length <= MAX_CONTROL_DESCENDANTS;
}

const A11Y_TEXT_SELECTOR = '.a-offscreen, .aok-offscreen, .sr-only, .visually-hidden, '
  + '.screen-reader-only, [class*="visuallyhidden"], [class*="screenReader"]';

/**
 * Concatenating child text drops the separator between them, so
 * `$<span>49</span><span>99</span>` reads as "$4999" — a silent 100x error, and
 * one of the most common price markups on the web (Walmart, Target, Best Buy,
 * Etsy). Newegg only survives because its decimal point happens to sit inside
 * the <sup>. Four or more unbroken digits after a symbol, in an element built
 * from multiple children, is the signature.
 */
export function looksConcatenated(el: Element, text: string): boolean {
  // One child is enough: `$18<sup>79</sup>` is a single-child element whose
  // text concatenates to "$1879". Requiring two meant the most common
  // superscript-cents markup on the web walked straight past this guard.
  if (el.children.length < 1) return false;
  return /[$€£¥₩₹][\s\u00A0]*\d{4,}(?!\d)/.test(text);
}

/**
 * The canonical, unsplit price is very often in the accessibility layer while
 * the visible DOM holds the styled/split version — Amazon's `.a-offscreen` is
 * the well-known case, but Walmart, Target, Best Buy and many themes use a
 * plain `sr-only` span for exactly the same purpose. Reading it turns the
 * hardest markup into the easiest, so prefer it wherever it parses.
 */
export function accessiblePriceText(el: Element): string | null {
  // The label is ON this element, so it describes this element whatever its
  // size. A hidden descendant is a different claim and is bounded below.
  const label = el.getAttribute('aria-label');
  if (label && QUICK_DETECT_PATTERN.test(label) && !isNonPriceText(label)) {
    return label.trim();
  }
  for (const node of el.querySelectorAll(A11Y_TEXT_SELECTOR)) {
    const text = textOf(node);
    if (text && QUICK_DETECT_PATTERN.test(text) && !isNonPriceText(text)) return text;
  }
  return null;
}

/**
 * The element's text with our own output removed.
 *
 * `isNonPriceText` rejects anything containing "ZEC" or "zats" so we never
 * re-parse our own conversions. Applied to raw textContent that guard was far
 * too wide: once ONE price inside a container had converted, the container's
 * text contained "ZEC", so the container — and its own remaining fiat price —
 * was rejected on every later pass. "<p>$10 – <span>$8</span></p>" lost the
 * $10 permanently the moment the $8 converted.
 *
 * Residue that escaped our markers still reads as ours, which is the case the
 * guard actually exists for.
 */
function pageAuthoredText(el: Element): string {
  // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent —
  // our own output always carries a "ZEC" or "zats" suffix, so whatever this
  // returns for one of our spans is rejected by isNonPriceText either way.
  if (el.classList.contains(SPAN_CLASS)) return '';
  // Stryker disable next-line ConditionalExpression: equivalent — cloning an
  // element that contains none of our spans removes nothing, so the clone
  // yields the same text. The shortcut saves the copy, not the answer.
  if (el.querySelector(`.${SPAN_CLASS}`) === null) return textOf(el);
  const clone = el.cloneNode(true) as Element;
  for (const own of clone.querySelectorAll(`.${SPAN_CLASS}`)) own.remove();
  return textOf(clone);
}

/** Just the digits, which is what survives whatever markup did to a price. */
function digitsOf(text: string): string {
  return text.replace(/\D/g, '');
}

/**
 * Whether an accessible copy may stand in for this element's whole text.
 *
 * It may only do so if it accounts for EVERY price inside the element. The
 * search for a hidden price runs the whole subtree, so without this any
 * ancestor — right up to <body> — adopted the first accessible price it found
 * anywhere beneath it as its own entire text. <body> then looked like a single
 * short price, got collected, got marked converted, and the marker made the
 * converter skip every other price on the page for the rest of the visit. One
 * page, two units, and no way for the user to tell which prices were real.
 *
 * Digits rather than text, because the accessible copy and the visible
 * rendering rarely agree on anything else: "-40% $18.79" covers a child
 * reading "$18.79", and does not cover one reading "$0.47".
 */
export function accessibleCopyCovers(el: Element, accessible: string | null): string | null {
  if (accessible === null) return null;
  const covered = digitsOf(accessible);
  for (const child of el.children) {
    const childText = textOf(child);
    if (!QUICK_DETECT_PATTERN.test(childText) || isNonPriceText(childText)) continue;
    if (!covered.includes(digitsOf(childText))) return null;
  }
  return accessible;
}

/** Every eligibility rule, applied to every candidate however it was collected. */
export function isConvertible(el: Element): boolean {
  if (isSkippedTag(el.tagName)) return false;
  if ((el as HTMLElement).isContentEditable) return false;
  if ((el as HTMLElement).hidden === true) return false;
  if (isInteractiveControl(el)) return false;
  return true;
}

// The per-element cap bounds one string, not the pass. 200 elements of 999
// characters each still cost seconds of frozen main thread, because the number
// patterns are quadratic on long digit runs. Budget the whole pass too.
const MAX_PASS_CHARS = 200_000;

/** A selector's matches within `root`, plus `root` itself when it matches. */
function selfAndMatching(root: Element, selector: string): Element[] {
  const within = Array.from(root.querySelectorAll(selector));
  return root.matches(selector) ? [root, ...within] : within;
}

export function walkPriceElements(root: Node): WalkResult[] {
  const results: WalkResult[] = [];
  let charBudget = MAX_PASS_CHARS;
  const processedElements = new Set<Element>();

  // Element only. Every caller passes one — document.body on the first pass,
  // a mutation's added node after that — and accepting a Document as well
  // meant carrying a branch no code path could take.
  if (!(root instanceof Element)) return results;

  // One pass over whatever this site's adapter declares as a whole price.
  // Previously this was a hand-written block per site, each with its own
  // querySelectorAll, its own eligibility checks, and in bol.com's case a
  // module-level WeakSet smuggling a boolean into the converter.
  // A DOM root implies a window: the instanceof check above already proved
  // this is running in a document.
  const hostname = window.location.hostname;
  const adapter = adapterFor(hostname);

  if (adapter?.containers) {
    for (const selector of adapter.containers) {
      for (const container of selfAndMatching(root, selector)) {
        if (processedElements.has(container)) continue;
        if (!isConvertible(container)) continue;
        if (isExcluded(adapter, container)) continue;

        // An adapter's extract() exists for markup no selector can express —
        // an accessible copy of a price that the visible DOM has split up.
        // Stryker disable next-line ObjectLiteral: equivalent — no adapter reads
        // the hostname yet. It is passed because extraction is a per-site hook,
        // and the site is the first thing such a hook will want to know.
        const extracted = adapter.extract?.(container, { hostname });
        // Page-authored, so our own earlier output inside this container neither
        // disqualifies it nor ends up in the text we hand the converter.
        const text = extracted ?? pageAuthoredText(container);

        if (!text || text.length > MAX_PURE_PRICE_LENGTH) continue;
        if (!QUICK_DETECT_PATTERN.test(text) || isNonPriceText(text)) continue;
        // The same refusal the generic pass makes, which this one was missing.
        // A .a-price whose decimal point is CSS rather than a node reads as
        // "$1879" once its children are concatenated, and being named by an
        // adapter is not evidence about the separator — so the adapter path was
        // the one remaining route to a silent 100x error.
        if (extracted == null && looksConcatenated(container, text)) {
          // Refusing the container is not enough on its own: its children are
          // the fragments of that same price, and converting "$49" while
          // leaving "99" beside it is its own wrong price. Marking it processed
          // makes the refusal cover the subtree it was about.
          processedElements.add(container);
          continue;
        }

        results.push({ node: container, text, inPriceContainer: true });
        processedElements.add(container);
      }
    }
  }

  // Shadow trees are invisible to getElementsByTagName, so they are walked as
  // additional roots. Probed first: most pages have none and should not pay.
  const shadowRoots = hasShadowDom(root as ParentNode)
    ? collectShadowRoots(root as ParentNode)
    : [];
  const allElements = [
    // The root ITSELF, not only its descendants. The observer queues each
    // added element as a root, so an infinite-scroll page that appends
    // `<span class="price">$19.99</span>` — the price in the added element's
    // own text — had that price skipped entirely: getElementsByTagName and
    // querySelectorAll both look only downwards.
    root,
    ...Array.from(root.getElementsByTagName('*')),
    ...shadowRoots.flatMap((shadow) => Array.from(shadow.querySelectorAll('*'))),
  ];

  for (const element of allElements) {
    if (processedElements.has(element)) continue;
    if (!isConvertible(element)) continue;

    // The accessibility copy is read through accessiblePriceText() on its owner
    // element rather than converted in place.
    // getAttribute, not className: on an SVG element className is an
    // SVGAnimatedString, and a regex run against that object matches nothing
    // however the element is actually classed.
    // Stryker disable next-line StringLiteral: equivalent — the fallback only
    // stands in for an element with no class at all, and no replacement string
    // matches the accessibility class names tested on the next line.
    const classStr = element.getAttribute('class') ?? '';
    if (/a-offscreen|sr-only|visually-hidden|screen-reader-only/i.test(classStr)) continue;

    // Skip if an ancestor was already collected (walk up — much cheaper than
    // scanning the whole processed set per element)
    let ancestorProcessed = false;
    for (let p = element.parentElement; p; p = p.parentElement) {
      if (processedElements.has(p)) {
        ancestorProcessed = true;
        break;
      }
    }
    if (ancestorProcessed) continue;

    // Length is checked against the raw text first: cloning to strip our own
    // output is only worth doing for something that could still be a price.
    // Stryker disable next-line ConditionalExpression,EqualityOperator:
    // equivalent — anything this admits is rejected a few lines later by the
    // price-length rule. The pre-filter saves the clone, never the verdict.
    if (textLengthOf(element) > MAX_PURE_PRICE_LENGTH * 4) continue;

    // Prefer the accessibility text when the visible text is split or styled.
    const rawText = pageAuthoredText(element);
    const accessible = accessibleCopyCovers(element, accessiblePriceText(element));
    // Both are trimmed already: accessiblePriceText trims what it returns and
    // pageAuthoredText goes through textOf.
    const trimmed = accessible ?? rawText;

    // Stryker disable next-line ConditionalExpression: equivalent — empty text
    // fails the price pattern on the next line regardless.
    if (!trimmed) continue;
    if (!QUICK_DETECT_PATTERN.test(trimmed)) continue;

    // Judged on what the PAGE wrote, so a converted child cannot disqualify
    // its own parent.
    if (isNonPriceText(trimmed)) continue;

    // Only process elements where the text is SHORT (likely just a price)
    // This avoids replacing "Price: $19.99 - Save 20%" with just the ZEC amount
    if (trimmed.length > MAX_PURE_PRICE_LENGTH) continue;

    // Refuse rather than risk a 100x error when the text looks like it lost a
    // separator between child elements and no accessible source disambiguates.
    // Not marked processed, unlike the adapter pass above: any ancestor can
    // trip this, and an ancestor's refusal must not veto a descendant that
    // still has an accessible copy to resolve it.
    if (accessible === null && looksConcatenated(element, trimmed)) continue;

    if (charBudget <= 0) break;
    charBudget -= trimmed.length;

    // If a child also contains a price, the child will be collected on its own —
    // but the parent's DIRECT text may hold a price of its own
    // ("<p>$10 – <span class='sale'>$8</span></p>"), so convert just that part.
    // An accessible copy describes the WHOLE element, so its children are the
    // split rendering of the same price, not separate prices to defer to.
    let hasMatchingChild = false;
    for (const child of accessible !== null ? [] : element.children) {
      // Page-authored again: a child holding only OUR output is not a child
      // with its own price, and treating it as one made the parent look like
      // a single price and swallow the whole page.
      const childText = pageAuthoredText(child);
      if (
        childText && QUICK_DETECT_PATTERN.test(childText)
        // Stryker disable next-line ConditionalExpression,EqualityOperator:
        // equivalent — a parent's text includes its child's, and the parent was
        // already rejected at this same limit, so a child cannot reach it.
        && childText.length <= MAX_PURE_PRICE_LENGTH
        && !isNonPriceText(childText)
      ) {
        hasMatchingChild = true;
        break;
      }
    }

    if (!hasMatchingChild) {
      results.push({ node: element, text: trimmed });
      processedElements.add(element);
    } else {
      const directText = Array.from(element.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => textOf(n))
        .join(' ');
      const directTrimmed = directText.trim();
      if (
        // empty direct text fails the price pattern below.
        // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent, see above.
        directTrimmed
        // reaching here means a child holds a price too, so the direct text is strictly shorter
        // than the parent's, which was already checked against this limit.
        // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent, see above.
        // Stryker disable next-line ConditionalExpression,EqualityOperator:
        // equivalent — reaching here means a child holds a price too, so the
        // direct text is strictly shorter than the parent's, which was already
        // checked against this limit.
        && directTrimmed.length <= MAX_PURE_PRICE_LENGTH
        && QUICK_DETECT_PATTERN.test(directTrimmed)
        && !isNonPriceText(directTrimmed)
      ) {
        // Deliberately NOT added to processedElements: the matching children
        // must still be collected below.
        results.push({ node: element, text: directTrimmed, directTextOnly: true });
      }
    }
  }

  return results;
}

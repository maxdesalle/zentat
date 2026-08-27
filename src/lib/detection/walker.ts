import { SPAN_CLASS, spanOriginalText } from '../../entrypoints/content/markers';
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
  // BUTTON is deliberately NOT here. It was, which meant no price inside any
  // button ever converted — donation presets, plan pickers, Steam's clickable
  // price widgets — regardless of whether the button asked the user to commit
  // to anything. Whether a control keeps its fiat is isInteractiveControl's
  // question, and it now answers it by asking whether the button says
  // anything besides the price.
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
// The rule this serves is "never convert a price the user is about to commit
// to in fiat", and it was written for checkout CTAs: "Buy now — $9.99".
//
// A <label>, an <a> and a <summary> are not that. Choosing 48GB on Apple's
// configurator, or ticking a coupon box on Amazon, charges nobody anything —
// and skipping them left the option prices sitting in dollars beside every
// other price on the page already rendered in ZEC, which is the failure this
// whole extension exists to avoid. A price you cannot read in ZEC is worse
// than one you can, right up until the moment you pay.
//
// So a control is a BUTTON. Storefronts still wrap whole product tiles in
// role="button", so the size test stays for those: a checkout CTA is short, a
// product tile is not.
// The rule this serves is "never convert a price the user is about to commit
// to in fiat", and it was written for checkout CTAs: "Buy now — $9.99".
//
// A <label>, an <a> and a <summary> are not that. Choosing 48GB on Apple's
// configurator, or ticking a coupon box on Amazon, charges nobody anything —
// and skipping them left the option prices sitting in dollars beside every
// other price on the page already rendered in ZEC, which is the failure this
// whole extension exists to avoid. A price you cannot read in ZEC is worse
// than one you can, right up until the moment you pay.
//
// So a control is a BUTTON. Storefronts still wrap whole product tiles in
// role="button", so the size test stays for those: a checkout CTA is short, a
// product tile is not.
//
// The tag SHOULD decide for a literal <button> or <label>: NYT's subscribe
// page wraps each offer in a <button> carrying 125 characters of copy, so the
// size test reads it as a tile and converts the price the user is about to be
// charged in fiat. Making the tag decide is written and measured — it costs 31
// conversions across the whole corpus and fixes three pages — but it also
// shifts which container the walker offers, and on wise.com a container falls
// under the length cap only AFTER the prices inside it have been rewritten, so
// eligibility changes between passes. That fragility is older than this rule
// and has to be fixed first. Until then the defect is recorded on the fixtures
// rather than papered over: see controlsStayFiat, which no longer borrows this
// function's threshold and so can actually fail.
const CONTROL_SELECTOR = 'button, [role="button"]';
const MAX_CONTROL_DESCENDANTS = 12;
const MAX_CONTROL_TEXT = 40;

// A price, in the shapes a control is likely to render one.
const PRICE_LIKE = /[$€£¥₩₹][\s\u00A0]*[\d.,]+|[\d.,]+[\s\u00A0]*[A-Z]{3}\b/g;

/**
 * Whether a control asks the user to DO something, as opposed to merely
 * showing a price that happens to be clickable.
 *
 * Take the price out and see what is left. "Buy now — $49.99" still says "Buy
 * now"; Steam's price widget is a role="button" whose entire text is
 * "C$ 27.99", and once the price is gone there is nothing there. The first is
 * the commitment this rule exists to protect. The second is a price, and
 * leaving it in dollars beside a page of ZEC is the failure the product
 * exists to prevent.
 */
function isCallToAction(text: string): boolean {
  return /[A-Za-z]{2,}/.test(text.replace(PRICE_LIKE, ' '));
}

export function isInteractiveControl(el: Element): boolean {
  const control = el.closest(CONTROL_SELECTOR);
  if (!control) return false;
  const text = textOf(control);
  return text.length <= MAX_CONTROL_TEXT
    && control.getElementsByTagName('*').length <= MAX_CONTROL_DESCENDANTS
    && isCallToAction(text);
}

// One list, two uses: the selector that RECOGNISES an accessibility copy and
// the test that SKIPS one must name the same classes, and they had drifted.
// The selector matched `.sr-only` exactly while the skip test matched by
// substring, so BILLA's `d-sr-only` canonical price was skipped as
// accessibility text AND never offered as accessibility text — it fell into
// the hole between the two rules, and the visible superscript "80 €" converted
// as eighty euros for a €1,80 carton. Forty-four times the real price.
const A11Y_CLASS_PARTS = [
  'a-offscreen',
  'aok-offscreen',
  'sr-only',
  'visually-hidden',
  'visuallyhidden',
  'screen-reader',
  'screenreader',
];
const A11Y_TEXT_SELECTOR = A11Y_CLASS_PARTS.map((part) => `[class*="${part}" i]`).join(', ');
const A11Y_CLASS_PATTERN = new RegExp(A11Y_CLASS_PARTS.join('|'), 'i');

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
/**
 * An accessibility node's text as the PAGE wrote it, with our own conversions
 * put back to the prices they replaced.
 *
 * Reading it raw makes the copy stop covering its element the moment we
 * convert it: the node then reads "0.00252 ZEC", isNonPriceText rejects it as
 * our own output, the owning element is no longer collected — so it no longer
 * marks its children processed — and the aria-hidden fragments beside it
 * ("1", "80 €") are re-detected as prices of their own on the next pass. The
 * observer runs a pass per mutation batch, so that is a live regression, not a
 * test artefact.
 */
function withOwnOutputRestored(node: Element): string {
  const ours = Array.from(node.querySelectorAll(`.${SPAN_CLASS}`));
  if (ours.length === 0) return textOf(node);
  const clone = node.cloneNode(true) as Element;
  // querySelectorAll returns document order on both, so the indexes line up.
  Array.from(clone.querySelectorAll(`.${SPAN_CLASS}`)).forEach((copy, index) => {
    copy.replaceWith(node.ownerDocument.createTextNode(spanOriginalText(ours[index]) ?? ''));
  });
  return textOf(clone);
}

export function accessiblePriceText(el: Element): string | null {
  // The label is ON this element, so it describes this element whatever its
  // size. A hidden descendant is a different claim and is bounded below.
  const label = el.getAttribute('aria-label');
  if (label && QUICK_DETECT_PATTERN.test(label) && !isNonPriceText(label)) {
    return label.trim();
  }
  for (const node of el.querySelectorAll(A11Y_TEXT_SELECTOR)) {
    const text = withOwnOutputRestored(node);
    if (text && QUICK_DETECT_PATTERN.test(text) && !isNonPriceText(text)) return text;
  }
  return null;
}

/**
 * The element's text as the PAGE wrote it, with our own conversions put back
 * to the prices they replaced.
 *
 * Restored rather than deleted, because deleting is not stable: an element's
 * "page-authored" text then SHRINKS the moment we convert something inside it,
 * and eligibility rules keyed on its length change between passes. Amazon's
 * search-result containers sat just over the length cap on the first pass and
 * dropped under it on the second, converting only because we had already
 * converted something inside them. Restoring makes every pass see the page the
 * first one saw.
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
  return withOwnOutputRestored(el);
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

/**
 * An element's own text, without any belonging to its children — and with our
 * own conversions counted as the text they replaced.
 *
 * A price that was a direct text node on the first pass is inside a span child
 * on the second, so a plain reading of the direct text SHRINKS between passes
 * and the element is offered differently each time. Craigslist drifted on
 * exactly that.
 */
function directTextOf(element: Element): string {
  return Array.from(element.childNodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return textOf(node);
      const el = node as Element;
      if (el.nodeType === Node.ELEMENT_NODE && el.classList.contains(SPAN_CLASS)) {
        return spanOriginalText(el) ?? '';
      }
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

/**
 * How long this element's text is as the page wrote it.
 *
 * Our own spans are counted as the prices they replaced, so the number does
 * not move when we convert something inside the element. Cheaper than
 * pageAuthoredText, which clones the subtree; this only needs the length.
 */
function authoredTextLength(element: Element): number {
  let length = textLengthOf(element);
  for (const own of element.querySelectorAll(`.${SPAN_CLASS}`)) {
    length += (spanOriginalText(own)?.length ?? 0) - textLengthOf(own);
  }
  return length;
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
    if (A11Y_CLASS_PATTERN.test(classStr)) continue;

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
    // Measured as the PAGE wrote it. Our output is a different length from the
    // price it replaced, so a raw reading is a number WE moved: an element
    // sitting just over this cap on the first pass drops under it on the
    // second and becomes eligible purely because we converted inside it, which
    // is what Amazon's search-result containers did. Skipping the pre-filter
    // for such elements fixed that and broke the other direction — a
    // ten-thousand-character Craigslist posting became eligible on the second
    // pass for the same reason. Correcting the length costs no clone.
    if (authoredTextLength(element) > MAX_PURE_PRICE_LENGTH * 4) continue;

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

    // Long text cannot be treated as ONE price — "Price: $19.99 - Save 20%"
    // must not become a bare ZEC amount. But that is a rule about replacing an
    // element WHOLE, and it was refusing the element outright. Prices in prose
    // were the casualty: AWS states its worked examples inside a
    // 3,581-character paragraph ("Total monthly storage cost = 59 GB *
    // $0.06/GB"), Apple its subscription terms inside a 2,298-character
    // footnote. Neither was ever looked at.
    //
    // So a long element is offered for its own DIRECT text and nothing else,
    // and takes no further part: it is not collected as a whole, does not mark
    // its subtree processed, and does not spend the pass budget. Its children
    // are walked exactly as they were.
    if (trimmed.length > MAX_PURE_PRICE_LENGTH) {
      // No length cap on the direct text. The cap above is about refusing to
      // treat a blob as ONE price; replacing inside a text node touches only
      // the price's own characters, so a long paragraph is no more dangerous
      // than a short one. AWS's worked examples run to two thousand characters
      // of direct text in a single <p>, and capping this rejected them again.
      const proseText = directTextOf(element);
      if (proseText && QUICK_DETECT_PATTERN.test(proseText) && !isNonPriceText(proseText)) {
        results.push({ node: element, text: proseText, directTextOnly: true });
      }
      continue;
    }

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
      // No length cap on the child: this loop only runs when the element has
      // no accessible copy, so the text checked against the cap above WAS the
      // parent's, and a child's is part of it.
      const childText = pageAuthoredText(child);
      // A digit as well, because a child holding no number holds no price.
      // GitHub writes "<sup>$</sup> <span>21</span> <span>USD</span>", and the
      // quick pattern matches a bare "USD" — so the parent deferred to a child
      // that was only a currency label, while no child held a whole price and
      // the parent's own direct text was three spaces. The price was offered
      // to nobody. Every price on that page above the free tier, and the same
      // shape on Zoopla.
      if (
        childText && /\d/.test(childText) && QUICK_DETECT_PATTERN.test(childText)
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
      // textOf trims each node, so the pieces arrive tight and only the join
      // could add anything — and it only ever joins already-trimmed pieces.
      const directText = Array.from(element.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => textOf(n))
        .join(' ');
      // Same as the child above: no length cap, because this text is part of
      // the parent's, which was capped already.
      if (
        directText
        && QUICK_DETECT_PATTERN.test(directText)
        && !isNonPriceText(directText)
      ) {
        // Deliberately NOT added to processedElements: the matching children
        // must still be collected below.
        results.push({ node: element, text: directText, directTextOnly: true });
      }
    }
  }

  return results;
}

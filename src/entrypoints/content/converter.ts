import { compareToAnchors, formatComparisons } from '../../lib/anchors';
import { convertPrice } from '../../lib/conversion/convert';
import { clearPageScale, setPageScale } from '../../lib/conversion/format';
import { adapterFor, isWholeReplacement } from '../../lib/detection/adapters';
import { textOf } from '../../lib/detection/dom';
import type { ParsedPrice } from '../../lib/detection/parser';
import { isSkippedTag } from '../../lib/detection/walker';
import { divergence, type HeldRate } from '../../lib/rates/held';
import { isRatesUsable, type RatesData } from '../../lib/storage/rates';
import type { Settings } from '../../lib/storage/settings';
import { weanStage } from '../../lib/weaning';
import { detectPrices } from './detector';
import { flushObserverRecords } from './state';

import {
  CONVERTED_MARKER,
  PARTIAL_MARKER,
  rememberContainer,
  rememberSpan,
  SPAN_CLASS,
  spanOriginalText,
  takeContainer,
} from './markers';

interface Replacement {
  original: string;
  converted: string;
  /** Carried so the tooltip can express the price against the user's anchors. */
  zecAmount: number;
}

export function convertPricesInDocument(
  rates: RatesData,
  settings: Settings,
  held?: HeldRate | null,
): number {
  if (!settings.enabled) return 0;
  // Never convert with unusable rates: empty (nothing fetched yet) or older
  // than a day — silently converting at a wildly stale rate is worse than
  // showing the original fiat price.
  if (!isRatesUsable(rates)) return 0;
  if (!document.body) return 0;

  // A whole-document pass IS the page, so the decimal grid starts fresh here.
  // Later passes are mutation batches and add to what this one established,
  // rather than re-scaling the page around whatever loaded last.
  clearPageScale();
  return convertPricesInNode(document.body, rates, settings, held);
}

export function convertPricesInNode(
  root: Node,
  rates: RatesData,
  settings: Settings,
  held?: HeldRate | null,
): number {
  if (!settings.enabled) return 0;
  if (!isRatesUsable(rates)) return 0;

  const detections = detectPrices(root, settings.currencies);

  // One decimal grid for everything in this pass, so every price on the page
  // has the same shape and the eye can compare them without reading.
  setPageScale(
    detections.flatMap(({ prices }) =>
      prices
        .map((parsed) =>
          convertPrice(parsed, rates, settings.precision, settings.displayUnit, held)
        )
        .filter((result): result is NonNullable<typeof result> => result !== null)
        .map((result) => result.zecAmount)
    ),
  );

  let convertedCount = 0;

  try {
    for (const { node, text, prices, directTextOnly } of detections) {
      // THIS node, not any marked ancestor. Treating an ancestor as proof the
      // work is done meant one wrongly-marked container — in the worst case
      // <body> — silently disabled conversion for the whole rest of the page,
      // so a price Amazon re-rendered after the first pass stayed in dollars
      // beside its converted neighbours. Self-mutation is already guarded by
      // the span check below and by isNonPriceText rejecting our own output.
      if (node.classList.contains(CONVERTED_MARKER)) continue;
      if (node.closest(`.${SPAN_CLASS}`)) continue;

      // Captured BEFORE any mutation — this is what tooltips must show
      const originalText = text;

      let converted = false;

      // One lookup instead of a chain of per-site booleans, each of which had
      // its own hostname test and its own idea of what counted.
      const adapter = adapterFor(window.location.hostname);

      if (isWholeReplacement(adapter, node)) {
        // For structured price containers, replace entire content
        const convertedPrices: string[] = [];
        for (const parsed of prices) {
          const result = convertPrice(
            parsed,
            rates,
            settings.precision,
            settings.displayUnit,
            held,
          );
          if (result) {
            convertedPrices.push(displayText(parsed.original, result.formatted, settings));
            converted = true;
          }
        }
        if (converted) {
          const newText = convertedPrices.join(' ');
          rememberContainer(node, node.innerHTML, node.getAttribute('title'));

          // Wrap rather than assigning textContent, for three reasons: the
          // structured path gets the same underline, tooltip and precise
          // revert as everywhere else; and assigning textContent deleted
          // Amazon's .a-offscreen span, which is the only price a screen
          // reader ever saw — sighted users got ZEC and screen-reader users
          // got nothing. The accessible copy is rewritten, not removed.
          //
          // bol.com used to branch off here to hide its aria-hidden fragments
          // and rewrite the absolutely-positioned span in place. Clearing the
          // container does the same job and leaves one path to maintain, with
          // the accessible copy written by the same code as everywhere else.
          node.textContent = '';
          node.appendChild(makeSpan(originalText.trim(), newText));
          node.appendChild(makeAccessibleCopy(newText));

          // Tooltip carries the pre-conversion price (the old code read
          // textContent AFTER replacing it, labeling the ZEC value "Original")
          setOwnTitle(node, `Original: ${originalText.trim()}`);
        }
      } else {
        // For complex content (Wikipedia, etc.), replace within text nodes to preserve HTML
        converted = replacePricesInTextNodes(node, prices, rates, settings, held, directTextOnly);
      }

      if (converted) {
        node.classList.add(directTextOnly ? PARTIAL_MARKER : CONVERTED_MARKER);
        convertedCount++;
      }
    }
  } finally {
    // Synchronously drain the mutation records produced by our own writes so
    // the observer never re-processes them (see state.ts).
    flushObserverRecords();
  }

  return convertedCount;
}

function displayText(original: string, formatted: string, settings: Settings): string {
  return settings.displayMode === 'append' ? `${original} (${formatted})` : formatted;
}

// The tooltip is where a price stops being a number and starts being a
// quantity: the ratio line is what a person can actually remember, because it
// does not move when the ZEC price does.
function tooltipFor(original: string, zecAmount: number, ctx: ConvertContext): string {
  const stage = ctx.settings.weanFromFiat
    ? weanStage(ctx.settings.weanStartedAt)
    : 'always';
  // 'delayed' and 'on-demand' are handled by CSS and the Alt-hold peek; only
  // 'hidden' removes the number from the tooltip entirely.
  const showFiat = !ctx.settings.hideFiat && stage !== 'hidden';
  const lines = showFiat ? [`Original: ${original}`] : [];
  const comparison = formatComparisons(
    compareToAnchors(zecAmount, ctx.settings.anchors ?? [], ctx.rates),
  );
  if (comparison) lines.push(comparison);

  // Always present, never conditional. A warning that only appears sometimes
  // teaches people that its absence means "no divergence"; a line that is
  // always there teaches them that a held rate HAS a divergence, which is the
  // mental model we actually want installed.
  //
  // Expressed as a percentage and an age, with no fiat figure, so it survives
  // hideFiat — a user who has given up their fiat cross-check needs this more,
  // not less.
  if (ctx.held) {
    const gap = divergence(ctx.held, ctx.rates);
    if (gap !== null) {
      const sign = gap >= 0 ? '+' : '';
      lines.push(
        `Held rate · spot ${sign}${(gap * 100).toFixed(1)}% · set ${
          describeAge(Date.now() - ctx.held.pegged)
        }`,
      );
    }
  }

  return lines.join('\n');
}

function describeAge(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

interface ConvertContext {
  rates: RatesData;
  settings: Settings;
  held?: HeldRate | null;
}

function makeSpan(original: string, converted: string, title?: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = SPAN_CLASS;
  span.setAttribute('title', title ?? `Original: ${original}`);
  span.textContent = converted;
  // Styled inline rather than through an injected stylesheet: a stylesheet with
  // a known id is a one-selector extension detector. text-decoration (not
  // border-bottom) avoids a double underline inside links and adds no height;
  // nowrap keeps "0.42" from splitting off its "ZEC".
  span.style.textDecoration = 'underline dotted';
  span.style.textUnderlineOffset = '0.18em';
  span.style.whiteSpace = 'nowrap';
  span.style.cursor = 'help';
  rememberSpan(span, original);
  return span;
}

// A visually-hidden copy so the accessible name matches what is on screen.
function makeAccessibleCopy(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  // Marked as ours. Unmarked, it added a second "… ZEC" to every ancestor's
  // textContent, which then read as our own output and made the ancestor
  // ineligible forever — so a container whose child had converted could never
  // convert its own remaining text.
  span.className = SPAN_CLASS;
  span.textContent = text;
  span.style.cssText =
    'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
  return span;
}

// The page's own title is preserved in the WeakMap by rememberContainer.
function setOwnTitle(el: Element, title: string): void {
  el.setAttribute('title', title);
}

/**
 * Replace prices within text nodes of an element, wrapping each converted
 * price in a marked span. The span gives converted prices a visual affordance
 * (dotted underline), an accurate hover tooltip, and a precise revert path
 * that never round-trips innerHTML (so page event listeners survive).
 */
function replacePricesInTextNodes(
  element: Element,
  prices: ParsedPrice[],
  rates: RatesData,
  settings: Settings,
  held: HeldRate | null | undefined,
  directTextOnly?: boolean,
): boolean {
  const replacements: Replacement[] = [];
  for (const parsed of prices) {
    const result = convertPrice(parsed, rates, settings.precision, settings.displayUnit, held);
    if (result) {
      replacements.push({
        original: parsed.original,
        converted: displayText(parsed.original, result.formatted, settings),
        zecAmount: result.zecAmount,
      });
    }
  }

  if (replacements.length === 0) return false;

  // Deduplicate replacements by original text (keep first occurrence)
  const seen = new Set<string>();
  const uniqueReplacements = replacements.filter((r) => {
    if (seen.has(r.original)) return false;
    seen.add(r.original);
    return true;
  });

  // Sort by length descending - replace longest matches first
  uniqueReplacements.sort((a, b) => b.original.length - a.original.length);

  const textNodes = directTextOnly
    ? (Array.from(element.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE) as Text[])
    : collectTextNodes(element);

  let anyReplaced = false;
  for (const tNode of textNodes) {
    if (replaceInTextNode(tNode, uniqueReplacements, { rates, settings, held })) {
      anyReplaced = true;
    }
  }

  // Cross-node fallback: a price split across inline children
  // (<span>$</span><span>99</span>) is detected via concatenated textContent
  // but lives in no single text node. When the element's whole text IS the
  // price, replace at the element level.
  if (!anyReplaced && !directTextOnly) {
    const trimmed = textOf(element);
    const match = uniqueReplacements.find((r) => r.original === trimmed);
    if (match) {
      rememberContainer(element, element.innerHTML, element.getAttribute('title'));
      element.textContent = '';
      element.appendChild(
        makeSpan(
          match.original,
          match.converted,
          tooltipFor(match.original, match.zecAmount, { rates, settings, held }),
        ),
      );
      anyReplaced = true;
    }
  }

  return anyReplaced;
}

// Text nodes eligible for replacement: never inside script/style/etc.,
// contenteditable regions, or our own spans.
function collectTextNodes(element: Element): Text[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      // The walker is rooted at an Element, so every text node it reaches has
      // an element parent. Kept because the alternative is a non-null
      // assertion on a value the DOM types say can be null.
      /* v8 ignore next */
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (isSkippedTag(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`.${SPAN_CLASS}`)) return NodeFilter.FILTER_REJECT;
      // BUTTON is already a skipped tag; this catches the role attribute,
      // which storefronts use far more than the element.
      if (parent.closest('[role="button"]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    textNodes.push(textNode);
  }
  return textNodes;
}

function replaceInTextNode(
  tNode: Text,
  replacements: Replacement[],
  ctx: ConvertContext,
): boolean {
  // .data rather than textContent: a Text node's data is always a string,
  // where textContent is typed as nullable for nodes that are not.
  const content = tNode.data;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  let replacedAny = false;

  while (cursor < content.length) {
    let bestIdx = -1;
    let best: Replacement | null = null;
    for (const r of replacements) {
      const idx = content.indexOf(r.original, cursor);
      if (idx === -1) continue;
      // Earliest match wins. A tie needs no length rule: `replacements` is
      // sorted longest-first, so the longer of two matches at the same offset
      // has already been considered.
      if (bestIdx === -1 || idx < bestIdx) {
        bestIdx = idx;
        best = r;
      }
    }
    if (bestIdx === -1 || best === null) break;

    if (bestIdx > cursor) {
      fragment.appendChild(document.createTextNode(content.slice(cursor, bestIdx)));
    }
    fragment.appendChild(
      makeSpan(best.original, best.converted, tooltipFor(best.original, best.zecAmount, ctx)),
    );
    cursor = bestIdx + best.original.length;
    replacedAny = true;
  }

  if (!replacedAny) return false;

  if (cursor < content.length) {
    fragment.appendChild(document.createTextNode(content.slice(cursor)));
  }
  tNode.parentNode?.replaceChild(fragment, tNode);
  return true;
}

/**
 * Copy the fiat, not the ZEC.
 *
 * Read in ZEC, copy in fiat. That asymmetry is what makes replacing the price
 * safe as a default: the user thinks in ZEC while browsing, and the number that
 * lands in a payment field, a spreadsheet or a message is still the one the
 * merchant will actually charge.
 */
export function installCopyHandler(): () => void {
  const onCopy = (event: ClipboardEvent) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const fragment = range.cloneContents();
    const clones = fragment.querySelectorAll(`.${SPAN_CLASS}`);
    if (clones.length === 0) return;

    // cloneContents() produces new nodes, so the WeakMap cannot be consulted on
    // them. Both lists are in document order, so pair them positionally; if the
    // counts disagree, leave the clipboard alone rather than guess.
    const live = Array.from(document.querySelectorAll(`.${SPAN_CLASS}`))
      .filter((el) => range.intersectsNode(el));
    // Not reachable from happy-dom, whose cloneContents and intersectsNode
    // agree on every selection this suite can build. Kept because the two are
    // allowed to disagree at a range boundary in a real browser, and pairing
    // mismatched lists positionally puts the WRONG price on the clipboard —
    // which is the one failure here that costs the user money.
    /* v8 ignore next */
    if (live.length !== clones.length) return;

    let replaced = false;
    clones.forEach((clone, index) => {
      const original = spanOriginalText(live[index]);
      if (original === undefined) return;
      clone.replaceWith(document.createTextNode(original));
      replaced = true;
    });
    if (!replaced) return;

    event.clipboardData?.setData('text/plain', textOf(fragment));
    event.preventDefault();
  };

  document.addEventListener('copy', onCopy, true);
  return () => document.removeEventListener('copy', onCopy, true);
}

export function revertConversions(): void {
  revertWithin(document);
  flushObserverRecords();
}

// Revert a single previously-converted element (used by the observer when the
// page rewrites content under a converted element).
export function revertElement(el: Element): void {
  revertWithin(el);
  if (el instanceof Element) {
    revertContainer(el);
  }
  flushObserverRecords();
}

function revertWithin(root: ParentNode): void {
  // Span-level conversions: precise swap back to a text node — page listeners
  // on surrounding elements survive.
  for (const span of Array.from(root.querySelectorAll(`.${SPAN_CLASS}`))) {
    // A span we did not create has no WeakMap entry — leave the page's own
    // markup alone rather than rewriting it from an attribute it controls.
    const original = spanOriginalText(span);
    if (original === undefined) continue;
    span.parentNode?.replaceChild(document.createTextNode(original), span);
  }

  for (const el of Array.from(root.querySelectorAll(`.${CONVERTED_MARKER}, .${PARTIAL_MARKER}`))) {
    revertContainer(el);
  }
}

function revertContainer(el: Element): void {
  // Only a snapshot WE took is ever written back. The page cannot supply one.
  const state = takeContainer(el);
  if (state) {
    el.innerHTML = state.html;
    if (state.prevTitle !== null) {
      el.setAttribute('title', state.prevTitle);
    } else {
      el.removeAttribute('title');
    }
  }
  el.classList.remove(CONVERTED_MARKER);
  el.classList.remove(PARTIAL_MARKER);
}

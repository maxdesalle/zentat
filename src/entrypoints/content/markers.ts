// Marker names and revert bookkeeping.
//
// Two rules here, both security-relevant.
//
// 1. Revert state lives in WeakMaps in the isolated world, never in the DOM.
//    It used to live in a `data-zentat-original` attribute that `revertContainer`
//    fed straight back into `innerHTML`. Nothing verified we had written that
//    attribute, so any page could plant one — with `class="zentat-processed"` —
//    and have us inject it. On a site that renders user content through a
//    sanitizer that permits `class` and `data-*` (DOMPurify's defaults do),
//    that made this extension a working bypass of the site's own defense.
//    A WeakMap cannot be read or forged by the page, and entries die with
//    their element.
//
// 2. Marker names are randomized per page. A fixed class name let any page
//    detect Zentat with a CSS selector alone — no JavaScript — and report it
//    with a `background-image: url(...)`, which survives NoScript and script
//    blocking. For a Zcash-adjacent audience, "this browser runs a Zcash
//    extension" is exactly the fact worth not broadcasting.

const suffix = Array.from(crypto.getRandomValues(new Uint8Array(6)))
  .map((b) => b.toString(36).padStart(2, '0'))
  .join('')
  .slice(0, 8);

/** Element whose contents we replaced wholesale (structured price containers). */
export const CONVERTED_MARKER = `z${suffix}p`;
/** Element whose direct text we converted while its children convert separately. */
export const PARTIAL_MARKER = `z${suffix}q`;
/** Inline span wrapping a single converted price. */
export const SPAN_CLASS = `z${suffix}c`;

interface ContainerState {
  html: string;
  prevTitle: string | null;
}

const containerState = new WeakMap<Element, ContainerState>();
const spanOriginal = new WeakMap<Element, string>();

export function rememberContainer(el: Element, html: string, prevTitle: string | null): void {
  if (!containerState.has(el)) containerState.set(el, { html, prevTitle });
}

export function takeContainer(el: Element): ContainerState | undefined {
  const state = containerState.get(el);
  containerState.delete(el);
  return state;
}

export function rememberSpan(el: Element, original: string): void {
  spanOriginal.set(el, original);
}

/** The pre-conversion text, or undefined when we did not create this element. */
export function spanOriginalText(el: Element): string | undefined {
  return spanOriginal.get(el);
}

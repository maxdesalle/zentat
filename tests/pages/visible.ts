// An INDEPENDENT reading of what a page shows.
//
// Deliberately shares no code with src/. Every other check in this harness
// asks whether a CONVERTED price is right — its unit, its shape, its tooltip,
// its revert — so not one of them could fail for a price the extension never
// looked at. A page could convert one figure, leave the headline in dollars,
// and pass clean. Two releases did.
//
// So this counts prices the way a reader does: a currency glyph followed by a
// number, in text that is actually on screen. If it used the project's own
// patterns it would inherit the project's blind spots, and a symbol we do not
// know — "CDN$", which is Steam's, and which we did not know — would be
// invisible to the oracle for exactly the reason it was invisible to the code.

/** A currency glyph followed by a number. No cleverness on purpose. */
const PRICE = /[$€£¥₩₹]\s?\d[\d.,]*/g;

/** Classes the page itself uses to hide text from sighted readers. */
const HIDDEN_CLASS = /a-offscreen|sr-only|visually-hidden|screen-reader/i;

/** Text a sighted reader can actually see. */
export function visibleText(root: Element): string {
  const chunks: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent === null) return NodeFilter.FILTER_REJECT;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG)$/i.test(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest('[aria-hidden="true"]') !== null) return NodeFilter.FILTER_REJECT;
      if (HIDDEN_CLASS.test(parent.getAttribute('class') ?? '')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) chunks.push(node.textContent ?? '');
  return chunks.join(' ');
}

/** How many fiat prices a reader can still see. */
export function visibleFiatCount(root: Element): number {
  return (visibleText(root).match(PRICE) ?? []).length;
}

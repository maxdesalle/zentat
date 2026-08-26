/**
 * textContent is typed `string | null` because Document and DocumentType can
 * return null. Elements and text nodes never do. One helper rather than a
 * `?? ''` at every call site, each of which would be its own untested branch.
 */
export function textOf(node: Node | null | undefined): string {
  return node?.textContent?.trim() ?? '';
}

/**
 * How long a node's text is, without trimming or copying it.
 *
 * A cheap pre-filter: the walker uses it to reject a page-sized element before
 * paying to strip our own output out of a clone of it.
 */
export function textLengthOf(node: Node | null | undefined): number {
  return node?.textContent?.length ?? 0;
}

/**
 * textContent is typed `string | null` because Document and DocumentType can
 * return null. Elements and text nodes never do. One helper rather than a
 * `?? ''` at every call site, each of which would be its own untested branch.
 */
export function textOf(node: Node | null | undefined): string {
  return node?.textContent?.trim() ?? '';
}

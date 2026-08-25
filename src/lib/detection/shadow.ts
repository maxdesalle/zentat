/**
 * Shadow DOM traversal.
 *
 * `getElementsByTagName` and `querySelectorAll` do not cross a shadow
 * boundary, so every price inside a web component was invisible — and web
 * components are a growing share of the web, including checkout widgets, which
 * is exactly where being wrong costs the user money.
 *
 * The second half matters as much as the first: a MutationObserver on the light
 * DOM receives NO records for mutations inside a shadow tree. Traversing once
 * finds today's prices; a per-root observer is what keeps finding them.
 */

/** Open roots are reachable directly; closed roots need the extension API. */
export function shadowRootOf(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  // chrome.dom.openOrClosedShadowRoot is available to extensions and is the
  // only way to reach a closed root. Absent in Firefox and in tests.
  try {
    const dom = (globalThis as unknown as {
      chrome?: { dom?: { openOrClosedShadowRoot?: (e: Element) => ShadowRoot | null } };
    }).chrome?.dom;
    return dom?.openOrClosedShadowRoot?.(el) ?? null;
  } catch {
    return null;
  }
}

/**
 * `root` itself when it is an element, then everything under it.
 *
 * querySelectorAll only looks downwards, so probing a newly added component
 * missed the case where the added node IS the host — the component's shadow
 * tree was then never observed and its prices never converted.
 */
function selfAndDescendants(root: ParentNode): Element[] {
  const within = Array.from(root.querySelectorAll('*'));
  return root instanceof Element ? [root, ...within] : within;
}

/**
 * Every shadow root at or beneath `root`, depth-first.
 *
 * Bounded because a component tree can nest arbitrarily and this runs on every
 * mutation batch: cost has to stay proportional to what the user can see.
 */
export function collectShadowRoots(root: ParentNode, limit = 200): ShadowRoot[] {
  const found: ShadowRoot[] = [];
  const queue: ParentNode[] = [root];

  while (queue.length > 0 && found.length < limit) {
    const current = queue.shift()!;
    for (const host of selfAndDescendants(current)) {
      const shadow = shadowRootOf(host);
      if (!shadow) continue;
      found.push(shadow);
      queue.push(shadow);
      if (found.length >= limit) break;
    }
  }

  return found;
}

/**
 * Cheap probe so the expensive path only runs where it can pay off. Most pages
 * have no shadow DOM at all and should not pay for the walk.
 */
export function hasShadowDom(root: ParentNode): boolean {
  for (const el of selfAndDescendants(root)) {
    if (shadowRootOf(el)) return true;
  }
  return false;
}

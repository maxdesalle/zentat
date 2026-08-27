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

/**
 * Whether asking the extension API about this element can ever answer anything.
 *
 * Open roots are found by reading `el.shadowRoot`, which is free and works on
 * any element. Only a CLOSED root needs the API, and that call crosses an
 * extension binding — once per element, on every mutation batch, which measured
 * 13ms of a single pass on Amazon.
 *
 * Closed roots are attached by web components, and a web component is a custom
 * element. The narrowing is real: a closed root attached to a plain <div> would
 * not be found, and an open one still would. Nothing in the corpus does that,
 * and it is not something a component framework produces — closed mode on a
 * built-in element is a deliberate act of hiding.
 */
function mayHideAClosedRoot(el: Element): boolean {
  return el.tagName.includes('-');
}

/** Open roots are reachable directly; closed roots need the extension API. */
export function shadowRootOf(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  if (!mayHideAClosedRoot(el)) return null;
  // chrome.dom.openOrClosedShadowRoot is available to extensions and is the
  // only way to reach a closed root. Absent in Firefox and in tests.
  //
  // The guards below look redundant against the catch, and for the returned
  // value they are: an absent API throws and the catch answers null, which is
  // what the guards answer too. They are here for cost, not for correctness.
  // This runs once per element on every mutation batch, and on Firefox the API
  // is absent on every single one — a thrown-and-caught exception per element
  // is a price the host page pays on every batch, forever.
  try {
    // Stryker disable next-line OptionalChaining: absent chrome throws into the catch, same null
    const dom = (globalThis as unknown as {
      chrome?: { dom?: { openOrClosedShadowRoot?: (e: Element) => ShadowRoot | null } };
    }).chrome?.dom;
    // Stryker disable next-line OptionalChaining: absent API throws into the catch, same null
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
  return collectShadowRootsAmong(selfAndDescendants(root), limit);
}

/**
 * The same search over a list of elements the caller already has.
 *
 * The walker builds its own list of every element on the page moments later, so
 * having this collect a second identical one cost a full querySelectorAll and a
 * several-thousand-entry array on every pass, for nothing.
 */
export function collectShadowRootsAmong(elements: Element[], limit = 200): ShadowRoot[] {
  const found: ShadowRoot[] = [];
  const queue: Element[][] = [elements];

  while (queue.length > 0 && found.length < limit) {
    for (const host of queue.shift()!) {
      const shadow = shadowRootOf(host);
      if (!shadow) continue;
      found.push(shadow);
      queue.push(selfAndDescendants(shadow));
      if (found.length >= limit) break;
    }
  }

  return found;
}

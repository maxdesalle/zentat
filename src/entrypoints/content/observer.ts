import { collectShadowRoots } from '../../lib/detection/shadow';
import type { HeldRate } from '../../lib/rates/held';
import type { RatesData } from '../../lib/storage/rates';
import type { Settings } from '../../lib/storage/settings';
import {
  convertPricesInDocument,
  convertPricesInNode,
  revertConversions,
  revertElement,
} from './converter';
import { CONVERTED_MARKER, SPAN_CLASS } from './markers';
import { setActiveObserver } from './state';

interface ObserverConfig {
  rates: RatesData;
  settings: Settings;
  held?: HeldRate | null;
}

let observer: MutationObserver | null = null;
let config: ObserverConfig | null = null;
let pendingRoots: Set<Element> = new Set();
let rafId: number | null = null;
let fallbackId: number | null = null;
let uninstallRouteHooks: (() => void) | null = null;

// How long to wait before converting without a rendering frame.
const HIDDEN_FLUSH_MS = 250;
// Bound the queue so an infinite-scroll page cannot retain unbounded detached
// subtrees; past this we simply rescan the body once.
const MAX_PENDING_ROOTS = 200;

export function startObserver(
  rates: RatesData,
  settings: Settings,
  held?: HeldRate | null,
): void {
  config = { rates, settings, held };
  if (observer) return;
  if (!document.body) return; // No body element (e.g., API endpoints)

  observer = new MutationObserver(handleMutations);
  // A light-DOM observer receives no records for mutations inside a shadow
  // tree, so each root needs its own observation. Without this, components
  // convert once and then never again as they re-render.
  observeShadowRoots(observer, document.body);
  uninstallRouteHooks = installRouteHooks();

  observer.observe(document.body, OBSERVE_OPTIONS);
  // Registers this observer for the converter's takeRecords() self-mutation
  // guard. There is deliberately NO polling loop: the observer plus the
  // rAF-batched queue below covers dynamic content without a permanent
  // full-document rescan every 2 seconds.
  setActiveObserver(observer, {
    // Page mutations swept up by the drain are replayed rather than dropped.
    replay: handleMutations,
    isOwnWrite,
  });
}

/**
 * Whether a drained record describes one of our own DOM writes.
 *
 * Exported for tests: getting it wrong in either direction is invisible until
 * it is expensive — too loose and the page's own updates are dropped, too
 * tight and we re-detect the ZEC text we just wrote.
 */
export function isOwnWrite(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest(`.${SPAN_CLASS}, .${CONVERTED_MARKER}`) != null;
}

function handleMutations(mutations: MutationRecord[]): void {
  // A MutationObserver callback already scheduled when disconnect() is called
  // still runs in some browsers, so this can fire after teardown. happy-dom
  // does not model that, which is why it is not reachable from a test.
  /* v8 ignore next */
  if (!config) return;

  for (const mutation of mutations) {
    // Handle added nodes
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (!element.closest(`.${CONVERTED_MARKER}`) && !element.closest(`.${SPAN_CLASS}`)) {
          addPending(element);
        }
      }
      // Text node added inside a previously-converted element: the page
      // rewrote its content (e.g. a live price update) — revert our old
      // conversion and queue a fresh pass.
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (!parent || parent.closest(`.${SPAN_CLASS}`)) continue;
        const marked = parent.closest(`.${CONVERTED_MARKER}`);
        if (marked) {
          revertElement(marked);
          addPending(marked);
        } else {
          addPending(parent);
        }
      }
    }

    // Text changes: re-scan the affected element. Zentat's own writes never
    // reach this callback — the converter drains them with takeRecords()
    // while still inside its conversion pass.
    if (mutation.type === 'characterData') {
      // A characterData record always targets the text node itself, never an
      // element, so the owner is always its parent.
      const element = mutation.target.parentElement;
      if (!element || element.closest(`.${SPAN_CLASS}`)) continue;
      const marked = element.closest(`.${CONVERTED_MARKER}`);
      if (marked) {
        revertElement(marked);
        addPending(marked);
      } else {
        // Never touch attributes (like title) of elements Zentat didn't convert
        addPending(element);
      }
    }
  }

  schedule();
}

// rAF never fires in a document that is not being rendered — a display:none
// iframe or a background tab queues roots forever and drains none, so prices
// there stay fiat indefinitely and the queue grows without bound. The timer is
// the fallback that keeps those documents converting.
const OBSERVE_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
};

// Roots already under observation, so re-probing after a mutation is cheap and
// idempotent. Weak so a detached component does not pin its root.
const observedShadowRoots = new WeakSet<ShadowRoot>();

function observeShadowRoots(active: MutationObserver, root: ParentNode): void {
  for (const shadow of collectShadowRoots(root)) {
    if (observedShadowRoots.has(shadow)) continue;
    observedShadowRoots.add(shadow);
    active.observe(shadow, OBSERVE_OPTIONS);
  }
}

// document.body.contains() is false for anything inside a shadow tree, so the
// liveness check has to climb out through each host first — otherwise every
// shadow-hosted price is discarded as detached.
/** Exported for tests: three DOM concepts meet here and each one can be wrong. */
export function isStillInPage(node: Node): boolean {
  // Climb out through every shadow boundary first: a shadow tree is only live
  // if its host is, and document.contains() is false for anything inside one.
  let current: Node = node;
  let root = current.getRootNode();
  while (root instanceof ShadowRoot) {
    current = root.host;
    root = current.getRootNode();
  }
  return root === document && document.contains(current);
}

function addPending(el: Element): void {
  if (pendingRoots.size >= MAX_PENDING_ROOTS) {
    pendingRoots.clear();
    if (document.body) pendingRoots.add(document.body);
    return;
  }
  pendingRoots.add(el);
}

function schedule(): void {
  if (pendingRoots.size === 0) return;
  if (rafId === null) {
    rafId = requestAnimationFrame(() => {
      rafId = null;
      processPendingNodes();
    });
  }
  if (fallbackId === null) {
    fallbackId = setTimeout(() => {
      fallbackId = null;
      processPendingNodes();
    }, HIDDEN_FLUSH_MS) as unknown as number;
  }
}

function processPendingNodes(): void {
  if (!config) return;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (fallbackId !== null) {
    clearTimeout(fallbackId);
    fallbackId = null;
  }
  // A root that contains another queued root subsumes it; walking both is
  // wasted work on high-churn pages, where one batch can queue ~3x the roots
  // it needs to.
  const roots = Array.from(pendingRoots)
    .filter((root, _i, all) => !all.some((other) => other !== root && other.contains(root)));
  pendingRoots.clear();

  for (const root of roots) {
    // A newly-added component brings its own shadow root with it.
    if (observer) observeShadowRoots(observer, root);
    if (isStillInPage(root)) {
      convertPricesInNode(root, config.rates, config.settings, config.held);
    }
  }
}

/**
 * SPA route changes.
 *
 * A framework that recycles DOM nodes across routes replaces their content
 * without necessarily producing a mutation the observer acts on, leaving our
 * marker classes on nodes that no longer hold a converted price. Those nodes
 * are then skipped forever — this is the "prices stop converting after I click
 * around" report.
 *
 * history.pushState and replaceState are patched because neither fires an
 * event; popstate covers back/forward.
 */
function installRouteHooks(): () => void {
  const onRouteChange = () => {
    // Queued by a microtask from the patched history methods, so it can land
    // after stopObserver has already cleared the config. Same reason as
    // handleMutations: not reachable from happy-dom.
    /* v8 ignore next */
    if (!config) return;
    // Drop stale markers, then re-run over the new content.
    revertConversions();
    convertPricesInDocument(config.rates, config.settings, config.held);
    if (observer) observeShadowRoots(observer, document.body);
  };

  const { pushState, replaceState } = history;
  const wrap = (original: typeof history.pushState) =>
    function(this: History, ...args: Parameters<typeof history.pushState>) {
      const result = original.apply(this, args);
      queueMicrotask(onRouteChange);
      return result;
    };

  history.pushState = wrap(pushState);
  history.replaceState = wrap(replaceState);
  window.addEventListener('popstate', onRouteChange);

  return () => {
    history.pushState = pushState;
    history.replaceState = replaceState;
    window.removeEventListener('popstate', onRouteChange);
  };
}

export function stopObserver(): void {
  uninstallRouteHooks?.();
  uninstallRouteHooks = null;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  setActiveObserver(null);
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pendingRoots.clear();
  config = null;
}

// Swap the rates/settings the observer converts with — WITHOUT tearing the
// observer down (the old stop+start dropped any mutation batch queued at that
// moment).
export function updateObserverConfig(rates: RatesData, settings: Settings): void {
  if (config) {
    config.rates = rates;
    config.settings = settings;
  } else {
    startObserver(rates, settings);
  }
}

import type { RatesData } from '../../lib/storage/rates';
import type { Settings } from '../../lib/storage/settings';
import { convertPricesInNode, revertElement } from './converter';
import { CONVERTED_MARKER, SPAN_CLASS } from './markers';
import { setActiveObserver } from './state';

interface ObserverConfig {
  rates: RatesData;
  settings: Settings;
}

let observer: MutationObserver | null = null;
let config: ObserverConfig | null = null;
let pendingRoots: Set<Element> = new Set();
let rafId: number | null = null;
let fallbackId: number | null = null;

// How long to wait before converting without a rendering frame.
const HIDDEN_FLUSH_MS = 250;
// Bound the queue so an infinite-scroll page cannot retain unbounded detached
// subtrees; past this we simply rescan the body once.
const MAX_PENDING_ROOTS = 200;

export function startObserver(rates: RatesData, settings: Settings): void {
  config = { rates, settings };
  if (observer) return;
  if (!document.body) return; // No body element (e.g., API endpoints)

  observer = new MutationObserver(handleMutations);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  // Registers this observer for the converter's takeRecords() self-mutation
  // guard. There is deliberately NO polling loop: the observer plus the
  // rAF-batched queue below covers dynamic content without a permanent
  // full-document rescan every 2 seconds.
  setActiveObserver(observer, {
    // Page mutations swept up by the drain are replayed rather than dropped.
    replay: handleMutations,
    isOwnWrite: (node) => {
      const el = node instanceof Element ? node : node.parentElement;
      return el?.closest(`.${SPAN_CLASS}, .${CONVERTED_MARKER}`) !== null;
    },
  });
}

function handleMutations(mutations: MutationRecord[]): void {
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
      const target = mutation.target;
      const element = target instanceof Element ? target : target.parentElement;
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
    if (document.body?.contains(root)) {
      convertPricesInNode(root, config.rates, config.settings);
    }
  }
}

export function stopObserver(): void {
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

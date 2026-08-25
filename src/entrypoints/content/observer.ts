import type { RatesData } from '../../lib/storage/rates';
import type { Settings } from '../../lib/storage/settings';
import { convertPricesInNode, revertElement } from './converter';
import { setActiveObserver } from './state';

interface ObserverConfig {
  rates: RatesData;
  settings: Settings;
}

let observer: MutationObserver | null = null;
let config: ObserverConfig | null = null;
let pendingRoots: Set<Element> = new Set();
let rafId: number | null = null;

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
  setActiveObserver(observer);
}

function handleMutations(mutations: MutationRecord[]): void {
  if (!config) return;

  for (const mutation of mutations) {
    // Handle added nodes
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (!element.closest('.zentat-processed') && !element.closest('.zentat-converted')) {
          pendingRoots.add(element);
        }
      }
      // Text node added inside a previously-converted element: the page
      // rewrote its content (e.g. a live price update) — revert our old
      // conversion and queue a fresh pass.
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (!parent || parent.closest('.zentat-converted')) continue;
        const marked = parent.closest('.zentat-processed');
        if (marked) {
          revertElement(marked);
          pendingRoots.add(marked);
        } else {
          pendingRoots.add(parent);
        }
      }
    }

    // Text changes: re-scan the affected element. Zentat's own writes never
    // reach this callback — the converter drains them with takeRecords()
    // while still inside its conversion pass.
    if (mutation.type === 'characterData') {
      const target = mutation.target;
      const element = target instanceof Element ? target : target.parentElement;
      if (!element || element.closest('.zentat-converted')) continue;
      const marked = element.closest('.zentat-processed');
      if (marked) {
        revertElement(marked);
        pendingRoots.add(marked);
      } else {
        // Never touch attributes (like title) of elements Zentat didn't convert
        pendingRoots.add(element);
      }
    }
  }

  if (pendingRoots.size > 0 && rafId === null) {
    rafId = requestAnimationFrame(() => {
      rafId = null;
      processPendingNodes();
    });
  }
}

function processPendingNodes(): void {
  if (!config) return;
  const roots = Array.from(pendingRoots);
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

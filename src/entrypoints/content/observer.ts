import type { RatesData } from '../../lib/storage/rates';
import type { Settings } from '../../lib/storage/settings';
import { convertPricesInNode } from './converter';

let observer: MutationObserver | null = null;
let pendingRoots: Set<Element> = new Set();
let rafId: number | null = null;
let pollInterval: number | null = null;

export function startObserver(rates: RatesData, settings: Settings): void {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Handle added nodes
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (!element.closest('.zentat-processed')) {
            pendingRoots.add(element);
          }
        }
        // Handle text node added inside a processed element (e.g., textContent update)
        // Convert immediately for responsive slider updates
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentElement;
          if (parent?.classList.contains('zentat-processed')) {
            // Content changed - remove marker and convert immediately
            parent.classList.remove('zentat-processed');
            parent.removeAttribute('data-zentat-original');
            parent.removeAttribute('title');
            convertPricesInNode(parent, rates, settings);
          }
        }
      }

      // Handle text changes - re-scan and re-convert even if already processed
      if (mutation.type === 'characterData') {
        const target = mutation.target;
        const element = target instanceof Element ? target : target.parentElement;
        if (element) {
          // Remove processed marker so it can be re-converted
          element.classList.remove('zentat-processed');
          element.removeAttribute('data-zentat-original');
          element.removeAttribute('title');
          pendingRoots.add(element);
        }
      }

      // Handle attribute changes
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        const element = target instanceof Element ? target : target.parentElement;
        if (element && !element.closest('.zentat-processed')) {
          pendingRoots.add(element);
        }
      }
    }

    if (pendingRoots.size > 0 && rafId === null) {
      rafId = requestAnimationFrame(() => {
        processPendingNodes(rates, settings);
        rafId = null;
      });
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Polling fallback for slider updates and other dynamic content
  // that MutationObserver might miss (e.g., React state changes without DOM mutations)
  pollInterval = window.setInterval(() => {
    convertPricesInNode(document.body, rates, settings);
  }, 2000);
}

function processPendingNodes(rates: RatesData, settings: Settings): void {
  const roots = Array.from(pendingRoots);
  pendingRoots.clear();

  for (const root of roots) {
    if (document.body.contains(root)) {
      convertPricesInNode(root, rates, settings);
    }
  }
}

export function stopObserver(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (pollInterval !== null) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  pendingRoots.clear();
}

export function updateObserverConfig(rates: RatesData, settings: Settings): void {
  // Just update the closure variables for next processing
  // The observer will use these on next mutation
  stopObserver();
  startObserver(rates, settings);
}

// Shared state between the converter and the observer.
//
// The converter must discard the MutationObserver records its own DOM writes
// produce. A boolean "isConverting" flag cannot do this — observer callbacks
// are delivered in a microtask AFTER the synchronous conversion pass has
// already reset the flag — so the converter instead calls takeRecords() on the
// active observer while still inside the conversion pass, which synchronously
// drains exactly the records produced so far.

let activeObserver: MutationObserver | null = null;

export function setActiveObserver(observer: MutationObserver | null): void {
  activeObserver = observer;
}

export function flushObserverRecords(): void {
  activeObserver?.takeRecords();
}

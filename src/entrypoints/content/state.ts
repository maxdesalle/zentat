// Shared state between the converter and the observer.
//
// The converter must discard the MutationObserver records its own DOM writes
// produce. A boolean "isConverting" flag cannot do this — observer callbacks
// are delivered in a microtask AFTER the synchronous conversion pass has
// already reset the flag — so the converter instead calls takeRecords() on the
// active observer while still inside the conversion pass, which synchronously
// drains exactly the records produced so far.
//
// takeRecords() drains the WHOLE queue though, not just our own records, so
// discarding the result threw away any page mutation that happened to be
// queued in the same task — those nodes then never converted. The drained
// records are handed to a re-entrancy handler instead, which keeps ours and
// replays the page's.

let activeObserver: MutationObserver | null = null;
let replay: ((records: MutationRecord[]) => void) | null = null;
let ownWrite: ((node: Node) => boolean) | null = null;

export function setActiveObserver(
  observer: MutationObserver | null,
  handlers?: {
    replay: (records: MutationRecord[]) => void;
    isOwnWrite: (node: Node) => boolean;
  },
): void {
  activeObserver = observer;
  replay = handlers?.replay ?? null;
  ownWrite = handlers?.isOwnWrite ?? null;
}

export function flushObserverRecords(): void {
  const records = activeObserver?.takeRecords();
  if (!records?.length || !replay || !ownWrite) return;
  const pageRecords = records.filter((record) => !ownWrite!(record.target));
  if (pageRecords.length > 0) replay(pageRecords);
}

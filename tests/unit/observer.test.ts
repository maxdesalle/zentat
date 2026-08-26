// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Spec: tests/trees/observer.tree
//
// The observer is what makes conversion survive the modern web: SPAs that
// recycle nodes, infinite scroll, live price tickers, and web components whose
// shadow trees a light-DOM observer never hears about. Every one of those was a
// "prices stop converting after I click around" report.

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => null,
      setValue: async () => {},
      watch: () => () => {},
    }),
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    watch: () => () => {},
  },
}));

// The observer decides WHAT to walk and WHEN; the converter does the rest.
// Those decisions are invisible in the finished page — walking a subtree twice,
// or walking <body> because one paragraph changed, leaves identical markup — so
// the passes themselves have to be counted.
const passes = vi.hoisted(() => ({ roots: [] as Node[], wholePage: 0 }));

vi.mock('../../src/entrypoints/content/converter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/entrypoints/content/converter')>();
  return {
    ...actual,
    convertPricesInNode(root: Node, rates: RatesData, settings: Settings, held?: HeldRate | null) {
      passes.roots.push(root);
      return actual.convertPricesInNode(root, rates, settings, held);
    },
    convertPricesInDocument(rates: RatesData, settings: Settings, held?: HeldRate | null) {
      passes.wholePage++;
      return actual.convertPricesInDocument(rates, settings, held);
    },
  };
});

import { CONVERTED_MARKER, SPAN_CLASS } from '../../src/entrypoints/content/markers';
import {
  isOwnWrite,
  isStillInPage,
  startObserver,
  stopObserver,
  updateObserverConfig,
} from '../../src/entrypoints/content/observer';
import { flushObserverRecords } from '../../src/entrypoints/content/state';
import type { HeldRate } from '../../src/lib/rates/held';
import type { RatesData } from '../../src/lib/storage/rates';
import { DEFAULT_SETTINGS, type Settings } from '../../src/lib/storage/settings';

const RATE = 0.00125; // ZEC ≈ $800

const rates: RatesData = { rates: { USD: RATE }, updatedAt: Date.now(), source: 'test' };
const settings: Settings = { ...DEFAULT_SETTINGS, currencies: ['USD'] };

// The observer's own fallback delay. Timeouts at any other delay (the tests'
// own microtask hops) still run for real.
const HIDDEN_FLUSH_MS = 250;
// One past MAX_PENDING_ROOTS: the add that first trips the cap.
const OVER_CAP = 201;

const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
const realObserve = MutationObserver.prototype.observe;

/** Drive both the rAF and the timer path deterministically. */
let frames = new Map<number, () => void>();
let timers = new Map<number, () => void>();
let nextId = 1;
let framesRequested = 0;
let framesCancelled: unknown[] = [];
let timersSet = 0;
let timersCleared: unknown[] = [];
let observed: Node[] = [];

function flush() {
  const queued = Array.from(frames.values());
  frames.clear();
  for (const frame of queued) frame();
}

/** What a document nobody is painting gets instead of a frame. */
function fireFallback() {
  const queued = Array.from(timers.values());
  timers.clear();
  for (const timer of queued) timer();
}

/** Let the MutationObserver callback run, then flush the batch it queued. */
async function settle() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flush();
}

function converted() {
  return Array.from(document.querySelectorAll(`.${SPAN_CLASS}`)).map((el) => el.textContent);
}

function timesObserved(target: Node) {
  return observed.filter((node) => node === target).length;
}

/** Forget what has been recorded so far, so a later phase can be read alone. */
function reset() {
  passes.roots = [];
  passes.wholePage = 0;
  framesRequested = 0;
  framesCancelled = [];
  timersSet = 0;
  timersCleared = [];
  observed = [];
}

function priced(text: string) {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

beforeEach(() => {
  document.body.innerHTML = '';
  frames.clear();
  timers.clear();
  reset();
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
    framesRequested++;
    const id = nextId++;
    frames.set(id, fn);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    framesCancelled.push(id);
    frames.delete(id);
  });
  vi.stubGlobal('setTimeout', (fn: () => void, delay?: number) => {
    if (delay !== HIDDEN_FLUSH_MS) return realSetTimeout(fn, delay);
    timersSet++;
    const id = nextId++;
    timers.set(id, fn);
    return id;
  });
  vi.stubGlobal('clearTimeout', (id?: number) => {
    timersCleared.push(id);
    if (typeof id === 'number' && timers.delete(id)) return;
    realClearTimeout(id);
  });
  vi.spyOn(MutationObserver.prototype, 'observe').mockImplementation(
    function(this: MutationObserver, target: Node, options?: MutationObserverInit) {
      observed.push(target);
      realObserve.call(this, target, options);
    },
  );
});

afterEach(() => {
  stopObserver();
  // stopObserver leaves the fallback timer holding its id; run it out so the
  // next test starts able to arm a fresh one.
  fireFallback();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('startObserver', () => {
  describe('given a document with a body', () => {
    it('watches the body', async () => {
      startObserver(rates, settings);
      document.body.appendChild(document.createElement('p')).textContent = '$800';
      await settle();
      expect(converted()).toHaveLength(1);
    });

    it('watches shadow roots separately', async () => {
      // A light-DOM observer receives NO records for mutations inside a shadow
      // tree, so a component converts once and then never again as it
      // re-renders. Checkout widgets are very often exactly this.
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      startObserver(rates, settings);

      shadow.appendChild(document.createElement('span')).textContent = '$800';
      await settle();
      expect(shadow.querySelector(`.${SPAN_CLASS}`)).not.toBeNull();
    });
  });

  describe('given no body', () => {
    it('does not start', () => {
      const body = document.body;
      Object.defineProperty(document, 'body', { value: null, configurable: true });
      expect(() => startObserver(rates, settings)).not.toThrow();
      Object.defineProperty(document, 'body', { value: body, configurable: true });
    });
  });

  describe('given it is already running', () => {
    it('keeps the same observer and takes the new config', async () => {
      startObserver(rates, settings);
      startObserver({ ...rates, rates: { USD: RATE * 2 } }, settings);
      document.body.appendChild(document.createElement('p')).textContent = '$800';
      await settle();
      expect(converted()[0]).toContain('2.00');
    });
  });
});

describe('isOwnWrite', () => {
  describe('given an element inside our span', () => {
    it('is ours', () => {
      document.body.innerHTML = `<span class="${SPAN_CLASS}"><b id="b">1 ZEC</b></span>`;
      expect(isOwnWrite(document.getElementById('b')!)).toBe(true);
    });
  });

  describe('given a text node inside our span', () => {
    it('is ours', () => {
      // Our own conversion produces characterData records on the text inside
      // the span we wrote. Replaying them re-detects the ZEC we just wrote.
      document.body.innerHTML = `<span class="${SPAN_CLASS}">1 ZEC</span>`;
      expect(isOwnWrite(document.querySelector(`.${SPAN_CLASS}`)!.firstChild!)).toBe(true);
    });
  });

  describe('given an element the page owns', () => {
    it('is not ours', () => {
      // Too tight in this direction and the page's own update is dropped: the
      // node then never converts at all.
      document.body.innerHTML = '<p id="p">$19.99</p>';
      expect(isOwnWrite(document.getElementById('p')!)).toBe(false);
    });
  });

  describe('given a node with no parent element', () => {
    it('is not ours', () => {
      expect(isOwnWrite(document.createTextNode('$19.99'))).toBe(false);
    });
  });
});

describe('isStillInPage', () => {
  describe('given a node in the document', () => {
    it('is in the page', () => {
      document.body.innerHTML = '<p id="p">$19.99</p>';
      expect(isStillInPage(document.getElementById('p')!)).toBe(true);
    });
  });

  describe('given a node removed from the document', () => {
    it('is not in the page', () => {
      document.body.innerHTML = '<p id="p">$19.99</p>';
      const p = document.getElementById('p')!;
      p.remove();
      expect(isStillInPage(p)).toBe(false);
    });
  });

  describe('given a node inside a live shadow tree', () => {
    it('is in the page', () => {
      // document.contains() is false for anything in a shadow tree, so a
      // naive check discards every shadow-hosted price as detached.
      const host = document.createElement('div');
      document.body.appendChild(host);
      const span = document.createElement('span');
      host.attachShadow({ mode: 'open' }).appendChild(span);
      expect(isStillInPage(span)).toBe(true);
    });
  });

  describe('given a node inside a detached shadow tree', () => {
    it('is not in the page', () => {
      const host = document.createElement('div');
      const span = document.createElement('span');
      host.attachShadow({ mode: 'open' }).appendChild(span);
      expect(isStillInPage(span)).toBe(false);
    });
  });

  describe('given a node in a fragment', () => {
    it('is not in the page', () => {
      const fragment = document.createDocumentFragment();
      const p = document.createElement('p');
      fragment.appendChild(p);
      expect(isStillInPage(p)).toBe(false);
    });
  });
});

describe('reacting to mutations', () => {
  beforeEach(() => startObserver(rates, settings));

  describe('given an element is added', () => {
    it('converts prices inside it', async () => {
      const div = document.createElement('div');
      div.innerHTML = '<span>$800</span>';
      document.body.appendChild(div);
      await settle();
      expect(converted()).toHaveLength(1);
    });

    it('walks that element and nothing wider', async () => {
      // Widening one added paragraph into a whole-body walk is invisible in
      // the result and ruinous on a page that adds a row a second.
      const div = document.createElement('div');
      div.innerHTML = '<span>$800</span>';
      document.body.appendChild(div);
      await settle();
      expect(passes.roots).toEqual([div]);
    });
  });

  describe('given the added element is our own output', () => {
    it('is ignored', async () => {
      // Re-detecting our own ZEC text is how conversions used to compound.
      const div = document.createElement('div');
      div.className = SPAN_CLASS;
      div.textContent = '$800';
      document.body.appendChild(div);
      await settle();
      expect(div.textContent).toBe('$800');
      expect(passes.roots).toHaveLength(0);
    });
  });

  describe('given a converted element is put back into the page', () => {
    it('is not walked again', async () => {
      // An SPA moving a converted node around must not hand it back for a
      // second pass: the marker is the only thing that says "already priced".
      const div = document.createElement('div');
      div.className = CONVERTED_MARKER;
      div.textContent = '1.00 ZEC';
      document.body.appendChild(div);
      await settle();
      expect(passes.roots).toHaveLength(0);
    });
  });

  describe('given text is added inside a converted element', () => {
    async function livePriceUpdate() {
      const p = document.createElement('p');
      p.textContent = '$800';
      document.body.appendChild(p);
      await settle();
      // A ticker rewrites the price in place.
      p.textContent = '$1600';
      await settle();
      return p;
    }

    it('reverts the stale conversion', async () => {
      const p = await livePriceUpdate();
      expect(p.textContent).not.toContain('1.00 ZEC');
    });

    it('converts the new text', async () => {
      await livePriceUpdate();
      expect(converted()[0]).toContain('2.00');
    });
  });

  describe('given text is added outside any conversion', () => {
    it('converts the parent', async () => {
      const p = document.createElement('p');
      document.body.appendChild(p);
      await settle();
      p.appendChild(document.createTextNode('$800'));
      await settle();
      expect(converted()).toHaveLength(1);
    });
  });

  describe('given text is added inside our own span', () => {
    it('is ignored', async () => {
      const span = document.createElement('span');
      span.className = SPAN_CLASS;
      document.body.appendChild(span);
      await settle();
      reset();
      span.appendChild(document.createTextNode('$800'));
      await settle();
      expect(span.querySelector(`.${SPAN_CLASS}`)).toBeNull();
      expect(passes.roots).toHaveLength(0);
    });
  });

  describe('given text is added and taken away in the same batch', () => {
    it('converts the rest of the batch', async () => {
      // The record still names the text node, but by the time we read it the
      // node has no parent. One of those must not take the batch down with it.
      const orphan = document.createTextNode('$800');
      document.body.appendChild(orphan);
      orphan.remove();
      document.body.appendChild(priced('$1600'));
      await settle();
      expect(converted()).toHaveLength(1);
    });
  });

  describe('given text changes in a converted element', () => {
    async function tickerEdit() {
      const p = document.createElement('p');
      p.appendChild(document.createTextNode('$800'));
      document.body.appendChild(p);
      await settle();
      // A ticker writes into the element it owns; our span is a child of it.
      p.childNodes[0].nodeValue = '$1600';
      await settle();
      return p;
    }

    it('reverts the stale conversion', async () => {
      const p = await tickerEdit();
      expect(p.querySelectorAll(`.${SPAN_CLASS}`).length).toBeLessThanOrEqual(1);
    });

    it('converts the new text', async () => {
      await tickerEdit();
      expect(document.body.textContent).toContain('ZEC');
    });
  });

  describe('given text changes beside a converted price', () => {
    it('reverts and re-converts the whole element', async () => {
      // "Now $800 only" converts to "Now <span>1.00 ZEC</span> only". The page
      // then edits the surrounding words: the element is still marked, so the
      // stale conversion has to come out before the fresh pass.
      const p = document.createElement('p');
      p.textContent = 'Now $800 only';
      document.body.appendChild(p);
      await settle();
      expect(converted()).toHaveLength(1);

      const tail = Array.from(p.childNodes).find((n) => n.nodeType === Node.TEXT_NODE)!;
      tail.nodeValue = 'Today ';
      await settle();
      expect(p.querySelectorAll(`.${SPAN_CLASS}`)).toHaveLength(1);
      expect(p.textContent).toContain('Today');
    });
  });

  describe('given a second price appears beside a converted one', () => {
    async function secondPrice() {
      const p = document.createElement('p');
      p.textContent = 'Now $800 only';
      document.body.appendChild(p);
      await settle();
      const tail = Array.from(p.childNodes).find((n) => n.nodeValue?.includes('only'))!;
      tail.nodeValue = ' or $1600';
      await settle();
      return p;
    }

    it('clears the stale conversion', async () => {
      // The marker on the element is what makes the converter skip it. Left in
      // place, the new price stays in dollars beside a ZEC one — the mixed
      // page that makes someone read the wrong number.
      await secondPrice();
      expect(document.body.textContent).not.toContain('$1600');
    });

    it('converts both prices', async () => {
      await secondPrice();
      expect(converted()).toHaveLength(2);
    });
  });

  describe('given the page took our span but left the element marked', () => {
    it('converts the price the page wrote', async () => {
      // A framework reconciling its own children removes the span we injected
      // and leaves the marker class behind. The marker is what makes the
      // converter skip the element, so unless the mutation drops it and queues
      // the element again, that price never converts again.
      const p = document.createElement('p');
      p.textContent = 'Now $800 only';
      document.body.appendChild(p);
      await settle();
      document.querySelector(`.${SPAN_CLASS}`)!.remove();

      const tail = Array.from(p.childNodes).find((n) => n.nodeValue?.includes('only'))!;
      tail.nodeValue = ' now $1600';
      await settle();
      expect(converted()).toHaveLength(1);
    });
  });

  describe('given text changes outside any conversion', () => {
    it('converts the element', async () => {
      const p = document.createElement('p');
      p.appendChild(document.createTextNode('nothing yet'));
      document.body.appendChild(p);
      await settle();
      p.firstChild!.nodeValue = '$800';
      await settle();
      expect(converted()).toHaveLength(1);
    });
  });

  describe('given text changes inside our own span', () => {
    async function editOwnSpan() {
      const span = document.createElement('span');
      span.className = SPAN_CLASS;
      span.appendChild(document.createTextNode('1.00 ZEC'));
      document.body.appendChild(span);
      await settle();
      reset();
      span.firstChild!.nodeValue = '$800';
      return span;
    }

    it('is ignored', async () => {
      const span = await editOwnSpan();
      await settle();
      expect(span.querySelector(`.${SPAN_CLASS}`)).toBeNull();
    });

    it('does not ask for a frame', async () => {
      // A guest on someone else's page does not book a frame for work it has
      // already decided not to do.
      await editOwnSpan();
      await Promise.resolve();
      expect(framesRequested).toBe(0);
    });
  });

  describe('given text changes on a node the page then detaches', () => {
    it('converts the rest of the batch', async () => {
      const p = priced('soon');
      document.body.appendChild(p);
      await settle();
      const text = p.firstChild!;
      text.nodeValue = '$800';
      text.remove();
      document.body.appendChild(document.createElement('span')).textContent = '$1600';
      await settle();
      expect(converted()).toHaveLength(1);
    });
  });

  describe('given the converter drains the queue in the same task', () => {
    it('still converts what the page changed', async () => {
      // The converter drains the observer's queue mid-pass to discard its own
      // writes, and that queue is shared. A page mutation caught in the same
      // drain has to be handed back, or that content never converts at all.
      document.body.appendChild(priced('$800'));
      flushObserverRecords();
      await settle();
      expect(converted()).toHaveLength(1);
    });
  });

  describe('given a shadow root appears with new content', () => {
    it('is observed too', async () => {
      // A newly-added component brings its own shadow root with it, and it has
      // to be picked up on the same pass that converts it.
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      await settle();

      shadow.appendChild(document.createElement('span')).textContent = '$800';
      await settle();
      expect(shadow.querySelector(`.${SPAN_CLASS}`)).not.toBeNull();
    });

    describe('given the same root is probed again', () => {
      it('is not observed twice', async () => {
        // Re-probing after every mutation is the cheap way to catch new
        // components; observing the same root twice would double every record.
        const host = document.createElement('div');
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });
        await settle();

        // A route change re-probes the whole body, so this shadow root comes
        // back a second time.
        history.pushState({}, '', '/again');
        await settle();

        shadow.appendChild(document.createElement('span')).textContent = '$800';
        await settle();
        expect(shadow.querySelectorAll(`.${SPAN_CLASS}`)).toHaveLength(1);
        expect(timesObserved(shadow)).toBe(1);
      });
    });
  });
});

describe('given the observer was never started', () => {
  it('does nothing', () => {
    stopObserver();
    document.body.appendChild(document.createElement('p')).textContent = '$800';
    expect(converted()).toHaveLength(0);
  });
});

describe('batching', () => {
  beforeEach(() => startObserver(rates, settings));

  describe('given several roots in one batch', () => {
    it('converts once per frame', async () => {
      for (let i = 0; i < 3; i++) {
        document.body.appendChild(document.createElement('p')).textContent = '$800';
      }
      await settle();
      expect(converted()).toHaveLength(3);
    });
  });

  describe('given a second batch arrives before the frame runs', () => {
    async function twoBatches() {
      document.body.appendChild(priced('$800'));
      await Promise.resolve();
      document.body.appendChild(priced('$1600'));
      await Promise.resolve();
    }

    it('reuses the frame it already asked for', async () => {
      // One frame per batch would mean a page that mutates every task asks the
      // browser for a frame every task, and the ones it does not need still
      // wake the tab.
      await twoBatches();
      expect(framesRequested).toBe(1);
    });

    it('reuses the timer it already set', async () => {
      await twoBatches();
      expect(timersSet).toBe(1);
    });
  });

  describe('given one queued root contains another', () => {
    async function nestedRoots() {
      // Both are queued: the outer arrives in the body, the inner arrives in
      // the outer, and the batch closes before either is walked.
      const outer = document.createElement('div');
      const inner = document.createElement('div');
      inner.innerHTML = '<span>$800</span>';
      document.body.appendChild(outer);
      outer.appendChild(inner);
      await settle();
      return outer;
    }

    it('skips the one already covered', async () => {
      await nestedRoots();
      expect(converted()).toHaveLength(1);
    });

    it('walks the outer root only', async () => {
      // On a high-churn page one batch can queue about three times the roots
      // it needs; walking a subtree twice is pure waste.
      const outer = await nestedRoots();
      expect(passes.roots).toEqual([outer]);
    });
  });

  describe('given a second batch after the first flush', () => {
    it('walks only what changed', async () => {
      // A queue that is not emptied re-walks everything it has ever held, so
      // an infinite-scroll page gets quadratically slower as the user scrolls.
      document.body.appendChild(priced('$800'));
      await settle();
      reset();
      const second = priced('$1600');
      document.body.appendChild(second);
      await settle();
      expect(passes.roots).toEqual([second]);
    });
  });

  describe('given a root left the page before the flush', () => {
    it('is not converted', async () => {
      const p = document.createElement('p');
      p.textContent = '$800';
      document.body.appendChild(p);
      p.remove();
      await settle();
      expect(p.querySelector(`.${SPAN_CLASS}`)).toBeNull();
    });
  });

  describe('given a root inside a shadow tree', () => {
    it('is still considered part of the page', async () => {
      // document.body.contains() is false for anything in a shadow tree, so a
      // naive liveness check discards every shadow-hosted price as detached.
      stopObserver();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      startObserver(rates, settings);
      const span = document.createElement('span');
      span.textContent = '$800';
      shadow.appendChild(span);
      await settle();
      expect(shadow.querySelector(`.${SPAN_CLASS}`)).not.toBeNull();
    });
  });

  describe('given the document is never rendered', () => {
    it('flushes on a timer instead', async () => {
      // rAF never fires in a display:none iframe or a background tab, so the
      // queue would grow forever and those prices stay fiat indefinitely.
      vi.stubGlobal('requestAnimationFrame', () => 1);
      document.body.appendChild(document.createElement('p')).textContent = '$800';
      await Promise.resolve();
      fireFallback();
      expect(converted()).toHaveLength(1);
    });
  });

  describe('given an infinite-scroll page queues past the cap', () => {
    async function overflow() {
      // Built detached, so each one arrives as a single record and the cap
      // trips on the last of them exactly.
      for (let i = 0; i < OVER_CAP; i++) document.body.appendChild(priced('$800'));
      await settle();
    }

    it('falls back to rescanning the body once', async () => {
      // Past the cap the queue would retain unbounded detached subtrees.
      await overflow();
      expect(passes.roots).toEqual([document.body]);
    });

    it('still converts everything that was queued', async () => {
      // Dropping the queue without putting the body back would lose every
      // price the batch was holding.
      await overflow();
      expect(converted()).toHaveLength(OVER_CAP);
    });
  });

  describe('given the page has no body when the queue overflows', () => {
    it('drops the batch', async () => {
      // The extension runs on every URL, including documents with no body at
      // all. There is nothing to rescan, so the batch goes rather than a null.
      const body = document.body;
      Object.defineProperty(document, 'body', { value: null, configurable: true });
      try {
        for (let i = 0; i < OVER_CAP; i++) body.appendChild(priced('$800'));
        await settle();
      } finally {
        Object.defineProperty(document, 'body', { value: body, configurable: true });
      }
      expect(converted()).toHaveLength(0);
    });
  });
});

describe('flushing the queue', () => {
  beforeEach(() => startObserver(rates, settings));

  async function queueOneRoot() {
    document.body.appendChild(priced('$800'));
    await Promise.resolve();
  }

  describe('given the frame runs first', () => {
    it('drops the timer it no longer needs', async () => {
      await queueOneRoot();
      flush();
      expect(timers.size).toBe(0);
    });

    it('can set a timer again', async () => {
      // A timer left holding its id can never be re-armed, and the next batch
      // in a background tab then waits on a timer that has already run.
      await queueOneRoot();
      flush();
      reset();
      await queueOneRoot();
      expect(timersSet).toBe(1);
    });

    it('does not cancel a frame that already ran', async () => {
      await queueOneRoot();
      reset();
      flush();
      expect(framesCancelled).toHaveLength(0);
    });
  });

  describe('given the timer runs first', () => {
    it('drops the frame it no longer needs', async () => {
      await queueOneRoot();
      fireFallback();
      expect(frames.size).toBe(0);
    });

    it('can ask for a frame again', async () => {
      // A tab that comes back to the foreground has to go back to converting
      // on frames; stuck on the timer it is a quarter-second behind the page.
      await queueOneRoot();
      fireFallback();
      reset();
      await queueOneRoot();
      expect(framesRequested).toBe(1);
    });

    it('does not clear a timer that already fired', async () => {
      await queueOneRoot();
      reset();
      fireFallback();
      expect(timersCleared).toHaveLength(0);
    });
  });
});

describe('SPA route changes', () => {
  beforeEach(() => startObserver(rates, settings));

  async function afterRoute(navigate: () => void) {
    document.body.innerHTML = '<p>$800</p><div id="host"></div>';
    await settle();
    // Neither of the next two writes reaches the observer, by design: one
    // lands inside a span we wrote, which the self-mutation guard ignores, and
    // the other inside a shadow tree that did not exist when the observer last
    // looked, which produces no record at all. A framework recycling nodes
    // across routes does both, which is why the route itself is the signal.
    document.querySelector(`.${SPAN_CLASS}`)!.firstChild!.nodeValue = 'stale';
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<span>$1600</span>';
    navigate();
    await Promise.resolve();
    return shadow;
  }

  describe('given the page pushes a new route', () => {
    it('clears what the last route left behind', async () => {
      // A framework that recycles nodes across routes leaves our marker
      // classes on nodes that no longer hold a converted price, and those
      // nodes are then skipped forever.
      await afterRoute(() => history.pushState({}, '', '/next'));
      expect(document.body.textContent).not.toContain('stale');
    });

    it('converts what the new route brought in', async () => {
      const shadow = await afterRoute(() => history.pushState({}, '', '/next2'));
      expect(shadow.textContent).toContain('ZEC');
    });
  });

  describe('given the page replaces the route', () => {
    it('does the same', async () => {
      const shadow = await afterRoute(() => history.replaceState({}, '', '/same'));
      expect(shadow.textContent).toContain('ZEC');
    });
  });

  describe('given the user goes back', () => {
    it('does the same', async () => {
      const shadow = await afterRoute(() => window.dispatchEvent(new Event('popstate')));
      expect(shadow.textContent).toContain('ZEC');
    });
  });

  describe('given a component upgraded since the last pass', () => {
    it('watches the new shadow tree', async () => {
      // attachShadow produces no mutation record, so a component that upgrades
      // between passes is invisible until something re-probes the page.
      document.body.innerHTML = '<div id="host"></div>';
      await settle();
      const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
      history.pushState({}, '', '/upgraded');
      await settle();

      shadow.appendChild(document.createElement('span')).textContent = '$800';
      await settle();
      expect(shadow.querySelector(`.${SPAN_CLASS}`)).not.toBeNull();
    });
  });
});

describe('after stopping', () => {
  describe('given records are replayed anyway', () => {
    it('does nothing', () => {
      // The drain handler is held by the state module and can fire once more
      // after teardown; without the config guard it would convert at rates
      // that are no longer current.
      startObserver(rates, settings);
      const p = document.createElement('p');
      p.textContent = '$800';
      document.body.appendChild(p);
      stopObserver();
      flush();
      expect(converted()).toHaveLength(0);
    });
  });

  describe('given a route change fires anyway', () => {
    it('does nothing', () => {
      startObserver(rates, settings);
      stopObserver();
      document.body.innerHTML = '<p>$800</p>';
      window.dispatchEvent(new Event('popstate'));
      flush();
      expect(converted()).toHaveLength(0);
    });
  });

  describe('given a route change was already queued', () => {
    it('does nothing', async () => {
      // pushState hands the route hook to a microtask, so a teardown in
      // between lands it on an observer that has no rates left to convert at.
      startObserver(rates, settings);
      document.body.innerHTML = '<p>$800</p>';
      await settle();
      expect(converted()).toHaveLength(1);

      history.pushState({}, '', '/queued');
      stopObserver();
      await Promise.resolve();
      expect(converted()).toHaveLength(1);
    });
  });
});

describe('stopObserver', () => {
  it('disconnects the observer', async () => {
    startObserver(rates, settings);
    stopObserver();
    document.body.appendChild(document.createElement('p')).textContent = '$800';
    await settle();
    expect(converted()).toHaveLength(0);
  });

  it('restores the history methods it patched', () => {
    const before = history.pushState;
    startObserver(rates, settings);
    expect(history.pushState).not.toBe(before);
    stopObserver();
    expect(history.pushState).toBe(before);
  });

  it('stops listening for the back button', () => {
    // A listener left behind runs a whole-document pass of its own on every
    // route change, and gains another one with each restart.
    startObserver(rates, settings);
    stopObserver();
    startObserver(rates, settings);
    reset();
    window.dispatchEvent(new Event('popstate'));
    expect(passes.wholePage).toBe(1);
  });

  it('unregisters itself from the converter', () => {
    // The converter drains the active observer on every pass. Left registered,
    // a torn-down observer is what it reaches for.
    startObserver(rates, settings);
    stopObserver();
    const takeRecords = vi.spyOn(MutationObserver.prototype, 'takeRecords');
    flushObserverRecords();
    expect(takeRecords).not.toHaveBeenCalled();
  });

  it('cancels the frame it had queued', async () => {
    startObserver(rates, settings);
    document.body.appendChild(priced('$800'));
    await Promise.resolve();
    stopObserver();
    expect(frames.size).toBe(0);
  });

  describe('given nothing was queued', () => {
    it('cancels nothing', () => {
      startObserver(rates, settings);
      reset();
      stopObserver();
      expect(framesCancelled).toHaveLength(0);
    });
  });

  it('drops any queued work', async () => {
    startObserver(rates, settings);
    document.body.appendChild(document.createElement('p')).textContent = '$800';
    await Promise.resolve();
    stopObserver();
    flush();
    expect(converted()).toHaveLength(0);
  });

  it('does not carry queued work into the next session', async () => {
    // Whatever was pending belonged to the page as it was before teardown;
    // replaying it into the next session walks nodes nobody asked about.
    startObserver(rates, settings);
    document.body.appendChild(priced('$800'));
    await Promise.resolve();
    stopObserver();
    startObserver(rates, settings);
    reset();
    const fresh = priced('$1600');
    document.body.appendChild(fresh);
    await settle();
    expect(passes.roots).toEqual([fresh]);
  });
});

describe('updateObserverConfig', () => {
  describe('given the observer is running', () => {
    it('swaps the rates without tearing the observer down', async () => {
      // The old stop+start dropped whatever mutation batch was queued at that
      // moment, so a settings change could silently lose a page's worth of
      // pending conversions.
      startObserver(rates, settings);
      const before = history.pushState;
      updateObserverConfig({ ...rates, rates: { USD: RATE * 2 } }, settings);
      expect(history.pushState).toBe(before);
    });

    it('converts at the new rate', async () => {
      startObserver(rates, settings);
      updateObserverConfig({ ...rates, rates: { USD: RATE * 2 } }, settings);
      document.body.appendChild(document.createElement('p')).textContent = '$800';
      await settle();
      expect(converted()[0]).toContain('2.00');
    });

    it('keeps the held rate', async () => {
      // The held rate is the number the user has memorised. A settings change
      // that quietly re-prices the page at spot moves every figure on it with
      // nothing on screen to say that it moved.
      const held: HeldRate = { peg: RATE * 2, pegged: Date.now() };
      startObserver(rates, settings, held);
      updateObserverConfig(rates, settings);
      document.body.appendChild(priced('$800'));
      await settle();
      expect(converted()[0]).toContain('2.00');
    });
  });

  describe('given the observer is not running', () => {
    it('starts one', async () => {
      stopObserver();
      updateObserverConfig(rates, settings);
      document.body.appendChild(document.createElement('p')).textContent = '$800';
      await settle();
      expect(converted()).toHaveLength(1);
    });
  });
});

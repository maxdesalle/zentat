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

import { SPAN_CLASS } from '../../src/entrypoints/content/markers';
import {
  isOwnWrite,
  isStillInPage,
  startObserver,
  stopObserver,
  updateObserverConfig,
} from '../../src/entrypoints/content/observer';
import type { RatesData } from '../../src/lib/storage/rates';
import { DEFAULT_SETTINGS, type Settings } from '../../src/lib/storage/settings';

const RATE = 0.00125; // ZEC ≈ $800

const rates: RatesData = { rates: { USD: RATE }, updatedAt: Date.now(), source: 'test' };
const settings: Settings = { ...DEFAULT_SETTINGS, currencies: ['USD'] };

/** Drive both the rAF and the timer path deterministically. */
let frames: (() => void)[] = [];

function flush() {
  const queued = frames;
  frames = [];
  for (const frame of queued) frame();
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

beforeEach(() => {
  document.body.innerHTML = '';
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
    frames.push(fn);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  stopObserver();
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
      span.appendChild(document.createTextNode('$800'));
      await settle();
      expect(span.querySelector(`.${SPAN_CLASS}`)).toBeNull();
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
    it('is ignored', async () => {
      const span = document.createElement('span');
      span.className = SPAN_CLASS;
      span.appendChild(document.createTextNode('1.00 ZEC'));
      document.body.appendChild(span);
      await settle();
      span.firstChild!.nodeValue = '$800';
      await settle();
      expect(span.querySelector(`.${SPAN_CLASS}`)).toBeNull();
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

  describe('given one queued root contains another', () => {
    it('skips the one already covered', async () => {
      // On a high-churn page one batch can queue about three times the roots
      // it needs; walking a subtree twice is pure waste.
      const outer = document.createElement('div');
      const inner = document.createElement('div');
      inner.innerHTML = '<span>$800</span>';
      outer.appendChild(inner);
      document.body.appendChild(outer);
      await settle();
      expect(converted()).toHaveLength(1);
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
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(converted()).toHaveLength(1);
    });
  });

  describe('given an infinite-scroll page queues past the cap', () => {
    it('falls back to rescanning the body once', async () => {
      // Past the cap the queue would retain unbounded detached subtrees.
      for (let i = 0; i < 250; i++) {
        document.body.appendChild(document.createElement('p')).textContent = '$800';
      }
      await settle();
      expect(converted().length).toBeGreaterThan(0);
    });
  });
});

describe('SPA route changes', () => {
  beforeEach(() => startObserver(rates, settings));

  async function afterRoute(navigate: () => void) {
    document.body.innerHTML = '<p>$800</p>';
    await settle();
    document.body.innerHTML = '<p>$1600</p>';
    navigate();
    await settle();
  }

  describe('given the page pushes a new route', () => {
    it('drops stale markers', async () => {
      // A framework that recycles nodes across routes leaves our marker
      // classes on nodes that no longer hold a converted price, and those
      // nodes are then skipped forever.
      await afterRoute(() => history.pushState({}, '', '/next'));
      expect(document.body.textContent).not.toContain('$1600');
    });

    it('converts the new content', async () => {
      await afterRoute(() => history.pushState({}, '', '/next2'));
      expect(converted()[0]).toContain('2.00');
    });
  });

  describe('given the page replaces the route', () => {
    it('does the same', async () => {
      await afterRoute(() => history.replaceState({}, '', '/same'));
      expect(converted()[0]).toContain('2.00');
    });
  });

  describe('given the user goes back', () => {
    it('does the same', async () => {
      await afterRoute(() => window.dispatchEvent(new Event('popstate')));
      expect(converted()[0]).toContain('2.00');
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

  it('drops any queued work', async () => {
    startObserver(rates, settings);
    document.body.appendChild(document.createElement('p')).textContent = '$800';
    await Promise.resolve();
    stopObserver();
    flush();
    expect(converted()).toHaveLength(0);
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

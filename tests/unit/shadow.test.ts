// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectShadowRoots, shadowRootOf } from '../../src/lib/detection/shadow';

// Spec: tests/trees/shadow.tree

function host(
  id: string,
  mode: ShadowRootMode = 'open',
  // Closed roots are only looked for on custom elements, so a test about one
  // has to attach it where a component would.
  tag = mode === 'closed' ? 'price-widget' : 'div',
): { el: Element; shadow: ShadowRoot } {
  const el = document.createElement(tag);
  el.id = id;
  document.body.appendChild(el);
  return { el, shadow: el.attachShadow({ mode }) };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shadowRootOf', () => {
  describe('given the element has an open root', () => {
    it('returns that root', () => {
      const { el, shadow } = host('a');
      expect(shadowRootOf(el)).toBe(shadow);
    });
  });

  describe('given the element has a closed root', () => {
    describe('given the extension API is available', () => {
      it('reaches the root through the API', () => {
        // chrome.dom.openOrClosedShadowRoot is the only way in, and closed
        // roots are common in exactly the checkout widgets that matter most.
        const { el, shadow } = host('b', 'closed');
        vi.stubGlobal('chrome', { dom: { openOrClosedShadowRoot: () => shadow } });
        expect(shadowRootOf(el)).toBe(shadow);
      });
    });

    describe('given it is attached to a plain element', () => {
      it('does not go looking', () => {
        // The narrowing that keeps this off the critical path: the API call
        // crosses an extension binding and was made once per element on every
        // mutation batch. Closed roots belong to web components, and a web
        // component is a custom element. An OPEN root on a plain element is
        // still found, by reading the property directly.
        const { el, shadow } = host('plain', 'closed', 'div');
        vi.stubGlobal('chrome', { dom: { openOrClosedShadowRoot: () => shadow } });
        expect(shadowRootOf(el)).toBeNull();
      });
    });

    describe('given the API is not available', () => {
      it('reports no root', () => {
        // Firefox has no equivalent. Closed roots are simply out of reach
        // there, and the walk has to carry on regardless.
        const { el } = host('c', 'closed');
        vi.stubGlobal('chrome', {});
        expect(shadowRootOf(el)).toBeNull();
      });
    });
  });

  describe('given the API throws', () => {
    it('reports no root rather than failing the walk', () => {
      const { el } = host('d', 'closed');
      vi.stubGlobal('chrome', {
        get dom(): never {
          throw new Error('extension context invalidated');
        },
      });
      expect(shadowRootOf(el)).toBeNull();
    });
  });

  describe('given the element hosts nothing', () => {
    it('reports no root', () => {
      document.body.innerHTML = '<div id="plain"></div>';
      vi.stubGlobal('chrome', { dom: { openOrClosedShadowRoot: () => null } });
      expect(shadowRootOf(document.getElementById('plain')!)).toBeNull();
    });
  });
});

describe('collectShadowRoots', () => {
  describe('given no shadow roots', () => {
    it('finds nothing', () => {
      document.body.innerHTML = '<div><span>$19.99</span></div>';
      expect(collectShadowRoots(document.body)).toEqual([]);
    });
  });

  describe('given one shadow root', () => {
    it('finds it', () => {
      const { shadow } = host('a');
      expect(collectShadowRoots(document.body)).toEqual([shadow]);
    });
  });

  describe('given the root element is itself a host', () => {
    it('finds its shadow root', () => {
      // The observer probes each newly added element. When the added node IS
      // the component host, looking only downwards misses its whole tree —
      // the component then converts once and never again.
      const { el, shadow } = host('self');
      expect(collectShadowRoots(el)).toEqual([shadow]);
    });
  });

  describe('given a shadow root nested in another', () => {
    it('finds both', () => {
      // Component trees nest: a checkout widget inside a payment section
      // inside a page shell is three boundaries deep.
      const { shadow } = host('outer');
      const inner = document.createElement('div');
      shadow.appendChild(inner);
      const innerShadow = inner.attachShadow({ mode: 'open' });
      expect(collectShadowRoots(document.body)).toEqual([shadow, innerShadow]);
    });
  });

  describe('given more roots than the limit', () => {
    it('stops at the limit', () => {
      // This runs on every mutation batch, so the cost has to stay
      // proportional to what the user can actually see.
      for (let i = 0; i < 10; i++) host(`h${i}`);
      expect(collectShadowRoots(document.body, 4)).toHaveLength(4);
    });
  });

  describe('given the limit runs out before a nested root is reached', () => {
    it('stops without descending into it', () => {
      // The bound has to hold across the whole walk, not just within one level
      // of it. A deeply nested component tree is the case where an unbounded
      // walk would stall the tab, so the queue has to be abandoned too.
      const { shadow: outer } = host('outer');
      const { shadow: sibling } = host('sibling');
      const nested = document.createElement('div');
      outer.appendChild(nested);
      nested.attachShadow({ mode: 'open' });
      expect(collectShadowRoots(document.body, 2)).toEqual([outer, sibling]);
    });
  });
});

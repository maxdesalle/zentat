// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectShadowRoots, hasShadowDom, shadowRootOf } from '../../src/lib/detection/shadow';

// Spec: tests/trees/shadow.tree

function host(id: string, mode: ShadowRootMode = 'open'): { el: Element; shadow: ShadowRoot } {
  const el = document.createElement('div');
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
});

describe('hasShadowDom', () => {
  describe('given a page with no shadow root', () => {
    it('reports none', () => {
      document.body.innerHTML = '<div><span>$19.99</span></div>';
      expect(hasShadowDom(document.body)).toBe(false);
    });
  });

  describe('given a page with one', () => {
    it('reports one', () => {
      host('a');
      expect(hasShadowDom(document.body)).toBe(true);
    });
  });

  describe('given the root element is itself a host', () => {
    it('reports one', () => {
      const { el } = host('self');
      expect(hasShadowDom(el)).toBe(true);
    });
  });

  describe('given the root has no children', () => {
    it('reports none', () => {
      expect(hasShadowDom(document.body)).toBe(false);
    });
  });
});

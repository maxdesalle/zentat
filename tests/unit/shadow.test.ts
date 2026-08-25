// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { collectShadowRoots, hasShadowDom } from '../../src/lib/detection/shadow';
import { walkPriceElements } from '../../src/lib/detection/walker';

beforeEach(() => {
  document.body.innerHTML = '';
});

function component(id: string, html: string): HTMLElement {
  const host = document.createElement('div');
  host.id = id;
  document.body.appendChild(host);
  host.attachShadow({ mode: 'open' }).innerHTML = html;
  return host;
}

describe('prices inside web components', () => {
  it('used to be invisible: querySelectorAll does not cross a shadow boundary', () => {
    component('a', '<p>$19.99</p>');
    // Establishes the premise this module exists for.
    expect(document.querySelectorAll('p')).toHaveLength(0);
  });

  it('finds a price inside an open shadow root', () => {
    component('a', '<p>$19.99</p>');
    expect(walkPriceElements(document.body).map((r) => r.text).join(' ')).toContain('$19.99');
  });

  it('finds prices nested several components deep', () => {
    const outer = component('outer', '<div id="mid"></div>');
    const mid = outer.shadowRoot!.getElementById('mid')!;
    mid.attachShadow({ mode: 'open' }).innerHTML = '<span>$42.00</span>';
    expect(walkPriceElements(document.body).map((r) => r.text).join(' ')).toContain('$42.00');
  });

  it('still finds light-DOM prices alongside shadow ones', () => {
    document.body.innerHTML = '<p>$5.00</p>';
    component('a', '<p>$7.00</p>');
    const text = walkPriceElements(document.body).map((r) => r.text).join(' ');
    expect(text).toContain('$5.00');
    expect(text).toContain('$7.00');
  });

  it('probes cheaply and reports nothing on an ordinary page', () => {
    document.body.innerHTML = '<p>$5.00</p><div><span>hello</span></div>';
    expect(hasShadowDom(document.body)).toBe(false);
    expect(collectShadowRoots(document.body)).toEqual([]);
  });

  it('bounds how many roots it will walk', () => {
    for (let i = 0; i < 60; i++) component(`c${i}`, '<p>$1.00</p>');
    expect(collectShadowRoots(document.body, 10)).toHaveLength(10);
  });
});

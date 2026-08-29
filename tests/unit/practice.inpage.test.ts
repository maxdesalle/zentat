// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => null,
      setValue: async () => {},
      watch: () => () => {},
    }),
  },
}));

import { SPAN_CLASS } from '../../src/entrypoints/content/markers';
import {
  askInPlace,
  type AskResult,
  closeInPlacePrompt,
  shouldAsk,
} from '../../src/entrypoints/content/practice';

/** A converted price sitting in ordinary page prose. */
function priceSpan(text = '0.025 ZEC'): HTMLElement {
  document.body.innerHTML = `<p>A thing for <span id="p">${text}</span></p>`;
  return document.getElementById('p')!;
}

function panel(): HTMLElement {
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
}

function buttons(): HTMLButtonElement[] {
  return Array.from(panel().querySelectorAll('button'));
}

/** Opens a question and hands back the pieces every DOM test needs. */
function ask(span: HTMLElement, answer = 0.025) {
  const results: AskResult[] = [];
  askInPlace(span, answer, { original: '$19.99', onFinish: (r) => results.push(r) });
  return { results };
}

beforeEach(() => {
  closeInPlacePrompt();
  document.body.innerHTML = '';
});

describe('practice where the user actually is', () => {
  describe('deciding whether to interrupt', () => {
    describe('given the user has not begun weaning', () => {
      it('never asks', () => {
        // The fiat original is still one hover away at this stage, so there is
        // nothing to recall — the question would be pure friction imposed on
        // someone who never stepped onto the ladder.
        expect(shouldAsk({ stage: 'always', askedThisPage: 0, converted: 50, roll: 0 }))
          .toBe(false);
      });
    });

    describe('given the page has already asked its one question', () => {
      it('does not ask again', () => {
        // A second quiz on a page someone is still trying to read is nagging,
        // and nagging is what gets an extension uninstalled.
        expect(shouldAsk({ stage: 'delayed', askedThisPage: 1, converted: 50, roll: 0 }))
          .toBe(false);
      });
    });

    describe('given one of the first prices on the page', () => {
      it('leaves the page alone', () => {
        // The price someone opened the page FOR is usually among the first ones
        // they see. Hiding that one to run a drill is actively obstructive.
        for (const converted of [1, 2, 3]) {
          expect(shouldAsk({ stage: 'delayed', askedThisPage: 0, converted, roll: 0 }))
            .toBe(false);
        }
      });
    });

    describe('given a price past the warm-up', () => {
      it('asks when the roll falls under the rate', () => {
        expect(shouldAsk({ stage: 'delayed', askedThisPage: 0, converted: 4, roll: 0.009 }))
          .toBe(true);
        // Every stage past 'always' is on the ladder and gets asked.
        expect(shouldAsk({ stage: 'hidden', askedThisPage: 0, converted: 4, roll: 0.009 }))
          .toBe(true);
      });

      it('stays quiet when the roll does not', () => {
        // 0.04 / 4 is a one-in-a-hundred chance, and the overwhelming majority
        // of prices must fall on this side of it.
        expect(shouldAsk({ stage: 'delayed', askedThisPage: 0, converted: 4, roll: 0.011 }))
          .toBe(false);
      });
    });

    describe('as a page piles up more prices', () => {
      it('asks less often per price', () => {
        // A flat per-price chance would make a sixty-price search page twenty
        // times likelier to interrupt than the article you are reading, for a
        // reason that has nothing to do with the user. Dividing by the running
        // count leaves the expected questions per page growing logarithmically.
        const roll = 0.009;
        expect(shouldAsk({ stage: 'delayed', askedThisPage: 0, converted: 4, roll })).toBe(true);
        expect(shouldAsk({ stage: 'delayed', askedThisPage: 0, converted: 40, roll })).toBe(false);
      });
    });
  });

  describe('asking in place', () => {
    describe('given an ordinary converted price', () => {
      it('hides the value and asks for the fiat it came from', () => {
        const span = priceSpan();
        ask(span);
        expect(span.textContent).toBe('? ZEC');
        // No digits, so our own detector cannot read the placeholder back as a
        // price and compound a second conversion onto it.
        expect(span.textContent).not.toMatch(/\d/);
        expect(panel().textContent).toContain('What is $19.99 in ZEC?');
      });

      it('opens a named panel without taking focus from the page', () => {
        const span = priceSpan();
        const search = document.createElement('input');
        document.body.appendChild(search);
        search.focus();

        ask(span);
        // Nobody asked for this question. Pulling the caret out of whatever the
        // user was typing into, to run a drill, is hostile.
        expect(document.activeElement).toBe(search);
        expect(panel().getAttribute('aria-label')).toBe('Guess this price in ZEC');
        // Not modal: the page underneath stays scrollable and clickable, and
        // claiming otherwise lies to a screen reader.
        expect(panel().hasAttribute('aria-modal')).toBe(false);
        expect(panel().querySelector('[aria-live="polite"]')).not.toBeNull();
        expect(panel().querySelector('input')!.getAttribute('aria-label'))
          .toBe('Your guess in ZEC');
        // A bare <button> submits. Inserted into a page we do not control, one
        // stray submit navigates the user off what they were reading.
        for (const control of buttons()) expect(control.type).toBe('button');
      });

      it('pins the panel to a corner without covering the page', () => {
        const style = (ask(priceSpan()), panel().style);
        expect(style.position).toBe('fixed');
        expect(style.zIndex).toBe('2147483647');
        // The opposite corner from the payment panel: two boxes in one corner
        // is one box.
        expect(style.insetBlockEnd).toBe('24px');
        expect(style.insetInlineStart).toBe('24px');
        expect(style.maxInlineSize).toBe('260px');
        // Host pages set colour and type we have no say in, so the panel brings
        // its own or a page with white text decides how the question reads.
        expect(style.background).toBe('#ffffff');
        expect(style.color).toBe('#17171a');
        expect(style.fontFamily).toBe('system-ui, sans-serif');
        // No backdrop and no lock on the page's scrolling. This is an aside,
        // not a modal, and the user is mid-task.
        expect(document.body.style.overflow).toBe('');
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      });

      it('keeps the converter out of its own question', () => {
        ask(priceSpan());
        // Without our own span marker the extension converts the fiat inside
        // its own question and hands over the answer: "What is $19.99 in ZEC?"
        // becomes "What is 0.025 ZEC in ZEC?".
        expect(panel().className).toBe(SPAN_CLASS);
      });

      it("scores a guess and restores the converter's own text", () => {
        const span = priceSpan();
        const { results } = ask(span);
        panel().querySelector('input')!.value = '0.025';
        buttons()[0].click();

        // Restored from what the converter rendered, never reformatted from the
        // answer: precision, decimal mark and unit all stay as the page had it.
        expect(span.textContent).toBe('0.025 ZEC');
        expect(results).toEqual([
          { outcome: 'answered', score: { points: 100, error: 0, verdict: 'spot on' } },
        ]);
        expect(panel().textContent).toContain('Spot on. It was 0.025 ZEC.');
        // The question is over, so the things that asked it go away.
        expect(panel().querySelector('input')).toBeNull();
        expect(buttons().map((b) => b.textContent)).toEqual(['Close']);
      });

      it('names which side of the answer the guess fell on', () => {
        // Direction is the actionable half: "20% low" says which way someone's
        // intuition leans, where "20% out" says only that they missed.
        const high = priceSpan();
        ask(high);
        panel().querySelector('input')!.value = '0.03';
        buttons()[0].click();
        expect(panel().textContent).toContain('Close, 20% high.');

        const low = priceSpan();
        ask(low);
        panel().querySelector('input')!.value = '0.02';
        buttons()[0].click();
        expect(panel().textContent).toContain('Close, 20% low.');
      });

      it('accepts the guess from the keyboard', () => {
        const span = priceSpan();
        ask(span);
        const input = panel().querySelector('input')!;

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        expect(span.textContent).toBe('? ZEC');

        input.value = '0.025';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(span.textContent).toBe('0.025 ZEC');
      });

      it('reveals without a verdict when the guess is blank', () => {
        const span = priceSpan();
        const { results } = ask(span);
        buttons()[0].click();

        // Someone who pressed Check just to see the answer asked a fair
        // question and gets one. Nothing was guessed, so nothing is scored.
        expect(results[0]).toEqual({ outcome: 'answered', score: null });
        expect(panel().textContent).toContain('It was 0.025 ZEC.');
        expect(span.textContent).toBe('0.025 ZEC');
      });

      it('reports the result once, not again on close', () => {
        const span = priceSpan();
        const { results } = ask(span);
        panel().querySelector('input')!.value = '0.025';
        buttons()[0].click();
        buttons()[0].click();

        // A second callback would double-count the attempt in progress, which
        // is a statistic the user is shown and expects to be true.
        expect(results).toHaveLength(1);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(span.textContent).toBe('0.025 ZEC');
      });
    });

    describe('when the question is dismissed', () => {
      it('restores the price on skip', () => {
        const span = priceSpan();
        // No callback: a caller that does not care must not crash the question.
        askInPlace(span, 0.025, { original: '$19.99' });
        buttons()[1].click();
        expect(span.textContent).toBe('0.025 ZEC');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      });

      it('restores the price on Escape and leaves other keys to the page', () => {
        const span = priceSpan();
        ask(span);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();

        const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        document.dispatchEvent(escape);
        // Escape belongs to the host page too. Swallowing it breaks the page's
        // own dialogs, so we listen without consuming.
        expect(escape.defaultPrevented).toBe(false);
        expect(span.textContent).toBe('0.025 ZEC');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      });

      it('restores the price when closed from outside', () => {
        const span = priceSpan();
        const { results } = ask(span);
        // What the content script calls when the user switches the extension
        // off, or when the page navigates under a single-page app.
        closeInPlacePrompt();
        expect(results).toEqual([{ outcome: 'skipped', score: null }]);
        expect(span.textContent).toBe('0.025 ZEC');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      });
    });

    describe('when the page removes the price', () => {
      it('tears down on the next click and not before', () => {
        const span = priceSpan();
        const { results } = ask(span);

        document.dispatchEvent(new MouseEvent('click'));
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();

        span.remove();
        document.dispatchEvent(new MouseEvent('click'));
        // Cheaper than a subtree observer running for the whole life of a quiz
        // on a page we are only a guest on.
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(results).toEqual([{ outcome: 'gone', score: null }]);
        // Restored even detached: a page that pulls a node out and puts it back
        // must not get "? ZEC" back with it.
        expect(span.textContent).toBe('0.025 ZEC');
      });
    });

    describe('given a price inside a checkout control', () => {
      it('refuses to ask', () => {
        document.body.innerHTML = '<button>Buy now <span id="p">0.025 ZEC</span></button>';
        const span = document.getElementById('p')!;
        const { results } = ask(span);
        // The user is trying to buy something. A quiz inside a Buy button costs
        // real money, and no amount of practice is worth that.
        expect(results).toEqual([{ outcome: 'refused', score: null }]);
        expect(span.textContent).toBe('0.025 ZEC');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      });
    });

    describe('given an element with markup of its own', () => {
      it('refuses to ask', () => {
        document.body.innerHTML = '<span id="p"><b>0.025</b> ZEC</span>';
        const span = document.getElementById('p')!;
        const { results } = ask(span);
        // Writing textContent into this would flatten the page's structure, and
        // a guest does not get to destroy the markup it was handed.
        expect(results).toEqual([{ outcome: 'refused', score: null }]);
        expect(span.querySelector('b')).not.toBeNull();
      });
    });

    describe('given a price the page has already detached', () => {
      it('refuses to ask', () => {
        const span = priceSpan();
        span.remove();
        const { results } = ask(span);
        // A price the page has moved on from is not one to interrupt over.
        expect(results).toEqual([{ outcome: 'refused', score: null }]);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      });
    });

    describe('given a value that cannot be scored', () => {
      it('refuses to ask', () => {
        const span = priceSpan();
        // A question with no honest answer. A wrong number is worse than none.
        expect(ask(span, 0).results).toEqual([{ outcome: 'refused', score: null }]);
        expect(ask(span, Number.NaN).results).toEqual([{ outcome: 'refused', score: null }]);
        expect(span.textContent).toBe('0.025 ZEC');
      });
    });

    describe('given a question already open', () => {
      it('replaces it rather than stacking', () => {
        document.body.innerHTML = '<span id="a">0.025 ZEC</span><span id="b">0.050 ZEC</span>';
        const first = document.getElementById('a')!;
        const second = document.getElementById('b')!;
        askInPlace(first, 0.025, { original: '$19.99' });
        askInPlace(second, 0.05, { original: '$39.99' });

        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        expect(first.textContent).toBe('0.025 ZEC');
        expect(second.textContent).toBe('? ZEC');
      });
    });
  });
});

import { isInteractiveControl } from '../../lib/detection/walker';
import { type Score, scoreGuess } from '../../lib/practice/types';
import type { WeanStage } from '../../lib/weaning';
import { SPAN_CLASS } from './markers';

/**
 * Practice where the user actually is.
 *
 * The dedicated practice page is somewhere you have to decide to visit, and the
 * people who most need the reps are exactly the ones who never decide to. This
 * asks in the flow of ordinary browsing instead: once in a long while a
 * converted price arrives as a question rather than as an answer. It is the
 * `delayed` rung of the weaning ladder made real — "try to guess first", asked
 * out loud, in the place the price actually appeared.
 *
 * Every decision below is about asking LESS. This runs on pages the user is
 * trying to use — reading, comparing, paying — and a quiz on every price is not
 * a feature, it is an extension that gets uninstalled by Friday. The default
 * behaviour of this module is silence; the question is the exception.
 */

/** How a question ended, so the caller can count it and record progress. */
export type Outcome = 'answered' | 'skipped' | 'gone' | 'refused';

export interface AskResult {
  outcome: Outcome;
  /** Null whenever there was nothing to score: a refusal, a dismissal, a blank guess. */
  score: Score | null;
}

export interface AskDeps {
  /**
   * The fiat the page printed. Not a capability but data, and required rather
   * than read back off the span: the span's title is a display string we chose,
   * and re-parsing our own prose to recover a price is how a 100x error starts.
   */
  original: string;
  /** Fires exactly once per question, at whatever ends it. */
  onFinish?: (result: AskResult) => void;
}

export interface AskDecision {
  stage: WeanStage;
  /** Questions already asked on this page. */
  askedThisPage: number;
  /** Prices converted on this page so far, counting the one being offered now. */
  converted: number;
  /**
   * Uniform in [0, 1). Injected because `Math.random()` in here would make the
   * frequency — the single most important property of this feature — something
   * no test can pin down.
   */
  roll: number;
}

/**
 * One question per page, ever.
 *
 * A second question on a page the user is still trying to read is nagging, and
 * nagging is the failure mode that gets an extension removed. Kept as a count
 * rather than a flag so the cap is a number someone can argue with.
 */
const MAX_PER_PAGE = 1;

/**
 * The first prices on a page are left strictly alone.
 *
 * Two reasons, and both are about the user's task rather than ours. The price
 * someone opened a page FOR is usually among the first they see — the headline
 * price on a product page, the fare on a booking — and hiding that one to run a
 * drill is actively obstructive. And the first prices are how someone orients
 * on a page they have just landed on; a question there arrives before they know
 * what they are looking at.
 */
const WARM_UP = 3;

/**
 * The rate is divided by the number of prices converted so far, not applied
 * flat.
 *
 * A flat per-price chance makes the odds of being quizzed proportional to how
 * many prices a page happens to contain, which is backwards: a search results
 * page with sixty prices would be twenty times more likely to interrupt than
 * the article you are reading, for no reason connected to the user at all.
 * Dividing by the running count makes the expected questions per page grow with
 * the LOGARITHM of the page's size instead — a 20-price page asks on roughly 8%
 * of visits, a 200-price page on roughly 17%, rather than 8% and 80%.
 */
const BASE_RATE = 0.04;

/**
 * Whether to turn this one conversion into a question.
 *
 * Pure, so the frequency is a thing that can be argued about in a test rather
 * than a thing discovered in the wild by an annoyed user.
 */
export function shouldAsk(options: AskDecision): boolean {
  // At `always` the user has not begun weaning: the fiat original is still one
  // hover away, so there is nothing to recall and the question is pure friction
  // imposed on someone who never opted into the ladder.
  if (options.stage === 'always') return false;
  if (options.askedThisPage >= MAX_PER_PAGE) return false;
  if (options.converted <= WARM_UP) return false;
  return options.roll < BASE_RATE / options.converted;
}

interface OpenPrompt {
  close(fallback: AskResult): void;
}

let open: OpenPrompt | null = null;

/** Dismiss any open question, restoring the price it was hiding. */
export function closeInPlacePrompt(): void {
  open?.close({ outcome: 'skipped', score: null });
}

const PANEL_STYLE = [
  'position:fixed',
  'z-index:2147483647',
  // The opposite corner from the payment panel, which is the only other thing
  // this extension puts on a page. Two boxes in one corner is one box.
  'inset-block-end:24px',
  'inset-inline-start:24px',
  'max-inline-size:260px',
  'padding:14px',
  'border-radius:14px',
  // Host pages set global colour and type we have no say in. Everything this
  // panel needs to be legible it states for itself.
  'background:#ffffff',
  'color:#17171a',
  'box-shadow:0 8px 32px rgba(0,0,0,0.32)',
  'font:13px/1.5 system-ui,sans-serif',
  'text-align:start',
].join(';');

const INPUT_STYLE = [
  'inline-size:100%',
  'box-sizing:border-box',
  'margin-block-start:8px',
  'padding:6px 8px',
  'border:1px solid #d8d6d0',
  'border-radius:8px',
  'font:inherit',
  'color:inherit',
  'background:#ffffff',
].join(';');

const BUTTON_STYLE = 'padding:6px 12px;border:0;border-radius:8px;font:inherit;cursor:pointer';

function button(label: string, background: string): HTMLButtonElement {
  const element = document.createElement('button');
  // A button defaults to submit, and this one is inserted into pages we do not
  // control. A stray submit navigates the user off the page they were reading.
  element.type = 'button';
  element.textContent = label;
  element.style.cssText = `${BUTTON_STYLE};background:${background};color:#17171a`;
  return element;
}

/**
 * How far off, in words, for someone who is not going to do the division.
 *
 * The direction is named because it is the actionable half: "20% low" tells you
 * which way your intuition leans, where "20% off" tells you only that you
 * missed.
 */
function describeMiss(score: Score): string {
  const off = Math.round(Math.abs(score.error) * 100);
  // A miss that rounds away is not worth a percentage; naming "0% high" reads
  // as a defect rather than as a compliment.
  if (off === 0) return score.verdict;
  return `${score.verdict}, ${off}% ${score.error > 0 ? 'high' : 'low'}`;
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Hide the converted value, ask for it, then reveal it.
 *
 * The span keeps its place in the page and simply stops saying the number; the
 * question itself lives in a small panel pinned to the viewport, because an
 * `<input>` grown inside a price in someone's table cell reflows their layout,
 * and reflowing a page to run a drill on it is not something a guest does.
 *
 * The converted text is restored on EVERY exit — answered, skipped, dismissed
 * with the keyboard, or abandoned because the page tore the price out from
 * under us. A price left permanently reading "? ZEC" is a worse bug than any
 * this feature could fix.
 */
export function askInPlace(span: HTMLElement, answer: number, deps: AskDeps): void {
  const notify = deps.onFinish ?? (() => {});
  // Defence in depth: the caller decides WHETHER to ask, these decide whether
  // the element it picked can be asked about without damaging the page.
  //
  // - A detached span is a price the page has already moved on from.
  // - An element with children of its own is markup we would flatten by writing
  //   textContent into it, and we do not get to destroy a page's structure.
  // - A non-positive or NaN answer is a question with no honest answer, and a
  //   wrong number is worse than no number.
  // - A checkout control is the one place this is unacceptable: the user is
  //   trying to buy something, and a quiz inside a Buy button costs real money.
  if (
    !span.isConnected || span.children.length > 0 || !(answer > 0)
    || isInteractiveControl(span)
  ) {
    notify({ outcome: 'refused', score: null });
    return;
  }

  // Never two at once. A previous question is dismissed, not stacked on.
  closeInPlacePrompt();

  // Restoring the converter's exact output, rather than reformatting from
  // `answer`, keeps the page identical to how it was before we interrupted it:
  // precision, locale decimal mark, unit choice and all.
  const saved = span.textContent as string;
  // No digits, so this cannot be read back as a price by our own detector on
  // the next pass, and nothing here can compound into a second conversion.
  span.textContent = '? ZEC';

  const panel = document.createElement('div');
  // Wearing our own span marker keeps the converter and the observer out of the
  // panel. Without it the extension converts the fiat in its own question and
  // hands over the answer: "What is $19.99 in ZEC?" becomes "What is 0.025 ZEC
  // in ZEC?". The class carries no revert state, so revert leaves it alone.
  panel.className = SPAN_CLASS;
  panel.setAttribute('role', 'dialog');
  // Deliberately not aria-modal: the page underneath stays scrollable and
  // clickable, and claiming otherwise lies to a screen reader.
  panel.setAttribute('aria-label', 'Guess this price in ZEC');
  panel.style.cssText = PANEL_STYLE;

  const question = document.createElement('div');
  question.textContent = `What is ${deps.original} in ZEC?`;
  panel.appendChild(question);

  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.placeholder = '0.00';
  input.setAttribute('aria-label', 'Your guess in ZEC');
  input.style.cssText = INPUT_STYLE;
  panel.appendChild(input);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;margin-block-start:10px';
  const check = button('Check', '#f5c451');
  const dismiss = button('Skip', '#f2f1ee');
  row.append(check, dismiss);
  panel.appendChild(row);

  const result = document.createElement('div');
  // Announced when it fills in, for anyone who did tab into the panel. Polite,
  // because nothing here is urgent enough to cut across what they were reading.
  result.setAttribute('aria-live', 'polite');
  result.style.cssText = 'margin-block-start:10px;font-weight:600';
  panel.appendChild(result);

  let reported = false;
  function report(outcome: AskResult): void {
    if (reported) return;
    reported = true;
    notify(outcome);
  }

  function close(fallback: AskResult): void {
    open = null;
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('click', onPageClick, true);
    panel.remove();
    // Written even when the span is detached: a page that pulls a node out and
    // puts it back must not get "? ZEC" back with it.
    span.textContent = saved;
    report(fallback);
  }

  function reveal(): void {
    // Blank or nonsense scores as nothing rather than as a failure. Someone who
    // pressed Check to see the answer asked a fair question and gets one.
    const score = scoreGuess(Number(input.value), answer);
    span.textContent = saved;
    input.remove();
    check.remove();
    result.textContent = score
      ? `${sentence(describeMiss(score))}. It was ${saved}.`
      : `It was ${saved}.`;
    // The one remaining control now does the only thing left to do.
    dismiss.textContent = 'Close';
    report({ outcome: 'answered', score });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    // Not prevented and not stopped: Escape belongs to the page too, and
    // swallowing it breaks the host's own dialogs.
    close({ outcome: 'skipped', score: null });
  }

  function onPageClick(): void {
    if (span.isConnected) return;
    // The page rewrote itself out from under the question. Cheaper than
    // watching the DOM for it, which is a subtree observer running for the
    // whole life of a quiz on a page we are only a guest on.
    close({ outcome: 'gone', score: null });
  }

  check.addEventListener('click', reveal);
  dismiss.addEventListener('click', () => close({ outcome: 'skipped', score: null }));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') reveal();
  });
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('click', onPageClick, true);

  document.body.appendChild(panel);
  // Deliberately NOT focused. This question was not asked for; taking the caret
  // out of whatever the user was typing into to run a drill is hostile, and the
  // panel is dismissable from the keyboard without ever being focused.
  open = { close };
}

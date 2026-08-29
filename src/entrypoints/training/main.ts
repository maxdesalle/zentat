import { storage } from 'wxt/utils/storage';
import { localizeDocument } from '../../lib/i18n';
import type { Liability } from '../../lib/liabilities';
import { CATALOGUE } from '../../lib/practice/catalogue';
import { MODES } from '../../lib/practice/modes';
import { buildPool, MAX_RECENT } from '../../lib/practice/pool';
import {
  bandAccuracy,
  dueItems,
  EMPTY_PRACTICE_PROGRESS,
  type PracticeProgress,
  record,
  type Tally,
  weakestBand,
} from '../../lib/practice/progress';
import { seenItems } from '../../lib/practice/seen';
import {
  type AskContext,
  type Band,
  type Mode,
  type ModeId,
  type PracticeItem,
  type Question,
  type Score,
  scoreAnswer,
} from '../../lib/practice/types';
import type { HeldRate } from '../../lib/rates/held';
import { getSeenPrices } from '../../lib/storage/practice';
import { getHeldRate, getRates, type RatesData } from '../../lib/storage/rates';
import { getSettings } from '../../lib/storage/settings';

/**
 * Everything the modes need, gathered in one place.
 *
 * This is the seam the rest of the page is built around: the renderer below
 * knows how to draw a `Question` and nothing about where one comes from, so
 * changing what gets asked about is a change to this function alone.
 */
async function gatherAskInputs(): Promise<{
  items: PracticeItem[];
  rates: RatesData;
  held: HeldRate | null;
  currency: string;
  liabilities: Liability[];
  due: string[];
}> {
  const [settings, rates, heldRate, seen] = await Promise.all([
    getSettings(),
    getRates(),
    getHeldRate(),
    getSeenPrices(),
  ]);

  const liabilities = settings.liabilities ?? [];

  return {
    // The user's own prices first, generic ones last — `buildPool` enforces
    // that ordering, so it is handed the raw sources rather than a list this
    // page has already flattened in some other order.
    items: buildPool({
      catalogue: CATALOGUE,
      anchors: settings.anchors ?? [],
      liabilities,
      // Only when the user asked for it. The store is emptied when the
      // setting goes off, so reading it unconditionally would be harmless
      // today and wrong the moment that stops being true — and this is the
      // one place where "harmless today" is not a good enough reason.
      seen: settings.practiceFromSeen ? seenItems(seen) : [],
    }),
    rates,
    // 'spot' means the user asked to see live prices, so practising against a
    // held rate would train them on a number their pages never show.
    held: settings.rateMode === 'spot' ? null : heldRate,
    currency: settings.displayCurrency,
    liabilities,
    // Items missed lately, oldest first. Nothing consumes this yet: `chooseItem`
    // is the function that weights them, and every mode selects its own item
    // straight out of `AskContext.items` instead of calling it. Gathered here
    // anyway so wiring it is one line rather than an archaeology exercise.
    due: dueItems(progress),
  };
}

/**
 * The pool as one question should see it.
 *
 * Recency is enforced by REMOVING what was asked lately, not by reordering:
 * modes index into the list with `pick`, uniformly, so position buys nothing.
 * Only the tail is honoured and an empty result falls back to the whole pool,
 * matching `chooseItem` — a page that refuses to ask is indistinguishable from
 * a broken one.
 */
function askPool(): PracticeItem[] {
  const avoid = new Set(recent.slice(-MAX_RECENT));
  const fresh = items.filter((item) => !avoid.has(item.id));
  return fresh.length > 0 ? fresh : items;
}

/**
 * Eight questions to a round.
 *
 * The number is doing real work. It has to be long enough that the round is a
 * fair sample of what the user can do rather than one lucky question, and it
 * has to END: the page this replaces never did, and an exercise with no finish
 * line is not one people complete, they just stop. Eight lands at about a
 * minute and gives every magnitude band a fair chance of turning up.
 */
const ROUND_LENGTH = 8;

/** How many draws to spend dodging a question already asked this round. */
const REDRAW_LIMIT = 4;

type Selection = ModeId | 'mixed';
type View = 'question' | 'result' | 'summary' | 'stuck';

// Progress is local and never leaves the machine — it exists to show the user
// their own improvement, not to be a metric. Same for the chosen mode and for
// the prices seen while browsing.
const progressItem = storage.defineItem<PracticeProgress>('local:practiceProgress', {
  fallback: EMPTY_PRACTICE_PROGRESS,
});
const selectionItem = storage.defineItem<Selection>('local:practiceMode', {
  fallback: 'mixed',
});

const modeOptions = document.getElementById('mode-options')!;
const modeBlurb = document.getElementById('mode-blurb')!;
const sessionBar = document.getElementById('session-bar')!;
const sessionCount = document.getElementById('session-count')!;
const sessionFill = document.getElementById('session-fill')!;
const questionView = document.getElementById('question-view')!;
const itemEmoji = document.getElementById('item-emoji')!;
const promptLine = document.getElementById('prompt')!;
const guessForm = document.getElementById('guess-form') as HTMLFormElement;
const guessInput = document.getElementById('guess') as HTMLInputElement;
const guessHint = document.getElementById('guess-hint')!;
const choicesBox = document.getElementById('choices')!;
const choiceHint = document.getElementById('choice-hint')!;
const resultView = document.getElementById('result-view')!;
const verdictLine = document.getElementById('verdict')!;
const truthLine = document.getElementById('truth')!;
const nextButton = document.getElementById('next') as HTMLButtonElement;
const summaryView = document.getElementById('summary-view')!;
const summaryLine = document.getElementById('summary-line')!;
const summaryWeak = document.getElementById('summary-weak')!;
const againButton = document.getElementById('again') as HTMLButtonElement;
const stuckView = document.getElementById('stuck-view')!;
const stuckWhy = document.getElementById('stuck-why')!;
const retryButton = document.getElementById('retry') as HTMLButtonElement;
const scoreline = document.getElementById('scoreline')!;
const statAccuracy = document.getElementById('stat-accuracy')!;
const statStreak = document.getElementById('stat-streak')!;
const statAttempts = document.getElementById('stat-attempts')!;
const bandsSection = document.getElementById('bands')!;
const bandList = document.getElementById('band-list')!;
const rateNote = document.getElementById('rate-note')!;

let items: PracticeItem[] = [];
let rates: RatesData | null = null;
let held: HeldRate | null = null;
let liabilities: Liability[] = [];
let currency = 'USD';

let selection: Selection = 'mixed';
let progress = EMPTY_PRACTICE_PROGRESS;
/** The same shape, reset each round, so the summary talks about THIS round. */
let round = EMPTY_PRACTICE_PROGRESS;
let question: Question | null = null;
let view: View = 'question';
let asked = 0;
/**
 * Item ids asked lately, oldest last, kept ACROSS rounds. Per-round would let
 * the first question of a new round repeat the last question of the old one,
 * which is the moment a repeat is most obvious.
 */
const recent: string[] = [];
/**
 * Prompts already used this round. The page this replaces drew from eleven
 * items excluding only the previous one, so a repeat arrived every third or
 * fourth question and eleven items felt like three. A `Question` carries no
 * item id when it asks about no item (rate recall), so the prompt string is the
 * identity that always exists — good enough, since two different items never
 * phrase identically.
 */
const askedPrompts = new Set<string>();

const BAND_ORDER: Band[] = ['tiny', 'small', 'everyday', 'large', 'huge'];

/** Named by what the user sees, not by the enum: 'everyday' means nothing yet. */
const BAND_LABELS: Record<Band, string> = {
  tiny: 'Under 0.01 ZEC',
  small: '0.01 to 0.1 ZEC',
  everyday: '0.1 to 1 ZEC',
  large: '1 to 10 ZEC',
  huge: 'Over 10 ZEC',
};

const MIXED_BLURB = 'A bit of everything — the way a converted page actually comes at you.';

/** Injected into modes so their branches stay reachable from a test. */
const pick = (upperExclusive: number): number =>
  upperExclusive > 0 ? Math.floor(Math.random() * upperExclusive) : 0;

function shuffled<T>(list: readonly T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * The pool keeps the order `buildPool` produced — the user's own prices first —
 * and is deliberately not shuffled: modes index into it with `pick`, so
 * reshuffling buys no variety and would throw that ordering away.
 */
function buildContext(): AskContext | null {
  if (!rates) return null;
  return { items: askPool(), rates, currency, held, liabilities, pick };
}

/** The chosen mode first, then the others, as fallbacks in random order. */
function orderedModes(): Mode[] {
  if (selection === 'mixed') return shuffled(MODES);
  const chosen = MODES.filter((mode) => mode.id === selection);
  return [...chosen, ...shuffled(MODES.filter((mode) => mode.id !== selection))];
}

/**
 * A question, or null when nothing can be asked honestly.
 *
 * A mode returning null is a structural refusal — no rate for the currency, too
 * few items to compare, no obligations to budget against — so the next mode is
 * tried rather than the round dying. Retrying the SAME mode after a null is
 * pointless for the same reason: nothing about the context changed.
 */
function drawQuestion(): Question | null {
  let repeat: Question | null = null;

  for (const mode of orderedModes()) {
    for (let attempt = 0; attempt < REDRAW_LIMIT; attempt++) {
      const context = buildContext();
      if (!context) return null;
      const drawn = mode.ask(context);
      if (!drawn) break;
      if (!askedPrompts.has(drawn.prompt)) return drawn;
      repeat ??= drawn;
    }
  }

  // Everything askable right now has already come up. A repeat beats cutting
  // the round short with nothing to show for it.
  return repeat;
}

/**
 * Why the page has nothing to ask, in the user's terms.
 *
 * Almost always the rate: a mode cannot price an item without one, and a wrong
 * price is worse than no price, so it declines rather than inventing a number.
 */
function whyStuck(): string {
  const rate = rates?.rates[currency.toUpperCase()];
  if (!(typeof rate === 'number' && rate > 0)) {
    return `No ${currency} rate yet, so every answer here would be made up. `
      + 'It arrives with the next refresh — usually within a few minutes.';
  }
  if (MODES.length === 0) return 'No practice exercises are available in this build.';
  if (items.length === 0) return 'Nothing to practise on yet. Add an anchor or a bill in Options.';
  return 'None of the exercises can ask a fair question with what is on file right now.';
}

function showView(next: View): void {
  view = next;
  questionView.hidden = next !== 'question';
  resultView.hidden = next !== 'result';
  summaryView.hidden = next !== 'summary';
  stuckView.hidden = next !== 'stuck';
  sessionBar.hidden = next !== 'question' && next !== 'result';
}

function renderChoices(choices: Question['choices']): void {
  choicesBox.replaceChildren();
  if (!choices) return;

  choices.forEach((choice, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    // The digit is shown because it is also the keyboard shortcut, and a
    // shortcut nobody can see is one nobody uses.
    const key = document.createElement('span');
    key.className = 'choice-key';
    key.textContent = String(index + 1);
    const label = document.createElement('span');
    label.textContent = choice.label;
    button.append(key, label);
    button.addEventListener('click', () => void answer(choice.id));
    choicesBox.appendChild(button);
  });
}

function renderQuestion(drawn: Question): void {
  question = drawn;
  askedPrompts.add(drawn.prompt);
  // Let it grow to twice what is honoured, then cut back to it. Amortised, and
  // it stops a long sitting from growing an array nobody reads the head of.
  if (drawn.itemId !== undefined) recent.push(drawn.itemId);
  if (recent.length > MAX_RECENT * 2) recent.splice(0, recent.length - MAX_RECENT);
  asked += 1;

  itemEmoji.textContent = drawn.emoji;
  promptLine.textContent = drawn.prompt;

  sessionCount.textContent = `Question ${asked} of ${ROUND_LENGTH}`;
  sessionFill.style.width = `${(asked / ROUND_LENGTH) * 100}%`;

  const isChoice = drawn.input === 'choice' && (drawn.choices?.length ?? 0) > 0;
  guessForm.hidden = isChoice;
  choicesBox.hidden = !isChoice;
  choiceHint.hidden = !isChoice;
  guessHint.hidden = true;

  if (isChoice) {
    renderChoices(drawn.choices);
    // Written from the actual count: a hint promising keys that do nothing is
    // worse than no hint.
    choiceHint.textContent = `Press 1–${drawn.choices?.length ?? 0} to answer.`;
    // The prompt lives outside the button group, so without this the group
    // announces as an unlabelled set of four numbers.
    choicesBox.setAttribute('aria-label', drawn.prompt);
  } else {
    guessInput.value = '';
  }

  showView('question');
  // Focus follows the question so the keyboard is already where the answer
  // goes; without this every single question costs a Tab.
  if (isChoice) (choicesBox.firstElementChild as HTMLElement | null)?.focus();
  else guessInput.focus();
}

function ask(): void {
  if (asked >= ROUND_LENGTH) {
    showSummary();
    return;
  }

  const drawn = drawQuestion();
  if (!drawn) {
    stuckWhy.textContent = whyStuck();
    showView('stuck');
    stuckView.focus();
    return;
  }

  // Said plainly rather than silently substituted: the user picked an exercise
  // and is about to be handed a different one.
  if (selection !== 'mixed' && drawn.mode !== selection) {
    const wanted = MODES.find((mode) => mode.id === selection)?.title ?? 'That exercise';
    modeBlurb.textContent = `${wanted} has nothing to ask right now, so here is another.`;
  } else {
    modeBlurb.textContent = blurbFor(selection);
  }

  renderQuestion(drawn);
}

function verdictText(drawn: Question, score: Score): string {
  // A choice is right or it is not, so the relative-error phrasing a numeric
  // answer gets would read here as the nonsense "0% high".
  if (drawn.input === 'choice') {
    return score.points > 0 ? `Right — ${score.points} points` : 'Not that one';
  }
  if (score.verdict === 'spot on') return `Spot on — ${score.points} points`;
  const direction = score.error > 0 ? 'high' : 'low';
  const off = Math.abs(Math.round(score.error * 100));
  const verdict = `${score.verdict[0].toUpperCase()}${score.verdict.slice(1)}`;
  return `${verdict} — ${off}% ${direction}, ${score.points} points`;
}

async function answer(response: number | string): Promise<void> {
  if (!question || view !== 'question') return;

  const score = scoreAnswer(question, response);
  // Unscoreable means the box was empty, zero or negative. The user's turn is
  // not over, and recording it would charge them for a typo.
  if (!score) {
    guessHint.textContent = 'Enter a number greater than zero.';
    guessHint.hidden = false;
    guessInput.focus();
    return;
  }

  verdictLine.textContent = verdictText(question, score);
  // The explanation is the point of the exercise: the user should leave with
  // the right number in mind, not just a score.
  truthLine.textContent = question.explain;

  showView('result');
  // Focus the panel, not the button: a screen reader landing on "Next" would
  // announce the button and skip the verdict and the explanation, which are
  // the whole reason for answering.
  resultView.focus();

  // Rate recall asks about no item and leaves `itemId` undefined. The empty
  // string is deliberate rather than a guess: it matches no pool item, so the
  // miss queue holds nothing it cannot honour. A made-up id would resurface the
  // WRONG item, which is worse than resurfacing none.
  const attempt = {
    band: question.band,
    mode: question.mode,
    itemId: question.itemId ?? '',
    score,
  };
  progress = record(progress, attempt);
  round = record(round, attempt);
  renderProgress();
  await progressItem.setValue(progress);
}

function advance(): void {
  if (asked >= ROUND_LENGTH) showSummary();
  else ask();
}

/**
 * Attempts and points across every band.
 *
 * `PracticeProgress` keeps no running total on purpose — per-band is what can
 * be acted on — so the headline figures are summed here rather than stored
 * twice and allowed to disagree.
 */
function totals(of: PracticeProgress): Tally {
  let attempts = 0;
  let points = 0;
  for (const band of BAND_ORDER) {
    attempts += of.bands[band].attempts;
    points += of.bands[band].points;
  }
  return { attempts, points };
}

function meanPoints(tally: Tally): number | null {
  if (tally.attempts === 0) return null;
  return tally.points / tally.attempts;
}

function showSummary(): void {
  const tally = totals(round);
  const mean = meanPoints(tally);
  summaryLine.textContent = `${tally.attempts} questions · `
    + `${mean === null ? '--' : Math.round(mean)}% average · `
    + `best run of ${round.bestStreak}`;

  // Lifetime, not this round. A round is eight questions across five bands, so
  // no band clears `weakestBand`'s attempt floor — and naming a "weakest band"
  // off one or two answers is noise dressed as a finding, which is exactly what
  // that floor exists to prevent. Silence until there is something true to say.
  const weak = weakestBand(progress);
  summaryWeak.textContent = weak === null
    ? 'Keep going — a few more rounds and this will tell you what to practise.'
    : `Worth practising: prices ${BAND_LABELS[weak].toLowerCase()}.`;

  showView('summary');
  summaryView.focus();
}

function startRound(): void {
  round = EMPTY_PRACTICE_PROGRESS;
  asked = 0;
  askedPrompts.clear();
  question = null;
  ask();
}

function renderProgress(): void {
  const tally = totals(progress);
  scoreline.hidden = tally.attempts === 0;
  const mean = meanPoints(tally);
  statAccuracy.textContent = mean === null ? '--' : `${Math.round(mean)}%`;
  statStreak.textContent = String(progress.streak);
  statAttempts.textContent = String(tally.attempts);
  renderBands(tally.attempts);
}

/**
 * Per-band mastery, which is the actionable readout: "you place coffees well
 * and rent badly" tells someone what to go and practise, where one average
 * tells them only that they are mediocre.
 */
function renderBands(attempts: number): void {
  bandsSection.hidden = attempts === 0;
  bandList.replaceChildren();

  for (const band of BAND_ORDER) {
    const value = bandAccuracy(progress, band);

    const row = document.createElement('li');
    row.className = 'band-row';

    const name = document.createElement('span');
    name.className = 'band-name';
    name.textContent = BAND_LABELS[band];

    // The bar is decoration over the number beside it, so it is hidden from
    // assistive tech rather than announced twice.
    const track = document.createElement('span');
    track.className = 'band-track';
    track.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('span');
    fill.className = 'band-fill';
    fill.style.width = `${value === null ? 0 : Math.max(0, Math.min(100, value))}%`;
    track.appendChild(fill);

    const score = document.createElement('span');
    score.className = 'band-score';
    // An untried band reads as "not yet", never as 0% — the user has not failed
    // at something nobody ever asked them.
    score.textContent = value === null ? 'not yet' : `${Math.round(value)}%`;

    row.append(name, track, score);
    bandList.appendChild(row);
  }
}

function blurbFor(value: Selection): string {
  if (value === 'mixed') return MIXED_BLURB;
  return MODES.find((mode) => mode.id === value)?.blurb ?? '';
}

function buildModePicker(): void {
  const options: Array<{ value: Selection; title: string }> = [
    { value: 'mixed', title: 'Mixed' },
    ...MODES.map((mode) => ({ value: mode.id as Selection, title: mode.title })),
  ];

  // A mode remembered from a build that has since dropped it would leave every
  // radio unchecked and the picker looking broken.
  if (!options.some((option) => option.value === selection)) selection = 'mixed';

  modeOptions.replaceChildren();
  for (const option of options) {
    const label = document.createElement('label');
    label.className = 'mode-pill';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'mode';
    input.value = option.value;
    input.checked = option.value === selection;

    const text = document.createElement('span');
    text.textContent = option.title;

    label.append(input, text);
    input.addEventListener('change', () => {
      selection = option.value;
      modeBlurb.textContent = blurbFor(selection);
      void selectionItem.setValue(selection);
      // Switching exercise starts a fresh round: half a round of one mode
      // scored against half of another is a summary about nothing.
      startRound();
    });
    modeOptions.appendChild(label);
  }

  modeBlurb.textContent = blurbFor(selection);
}

guessForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void answer(guessInput.value);
});

nextButton.addEventListener('click', advance);
againButton.addEventListener('click', startRound);
retryButton.addEventListener('click', () => {
  void reload();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    // A focused button already handles Enter itself; without these guards the
    // key would fire the handler AND the click, skipping a whole question.
    if (view === 'result' && event.target !== nextButton) {
      event.preventDefault();
      advance();
    } else if (view === 'summary' && event.target !== againButton) {
      event.preventDefault();
      startRound();
    }
    return;
  }

  if (view !== 'question' || choicesBox.hidden) return;
  if (event.key < '1' || event.key > '9') return;
  const button = choicesBox.children[Number(event.key) - 1] as HTMLElement | undefined;
  if (button) {
    event.preventDefault();
    button.click();
  }
});

/** Re-reads settings and rates, then starts a round. Also the retry path. */
async function reload(): Promise<void> {
  const gathered = await gatherAskInputs();
  items = gathered.items;
  rates = gathered.rates;
  held = gathered.held;
  currency = gathered.currency;
  liabilities = gathered.liabilities;

  // Practising against a rate that moves between questions would be teaching
  // noise, so say which rate is in play.
  rateNote.textContent = held
    ? 'Practising at the held rate — the same one you see on pages.'
    : 'Practising at the current market rate.';

  startRound();
}

async function init(): Promise<void> {
  const [saved, savedSelection] = await Promise.all([
    progressItem.getValue(),
    selectionItem.getValue(),
  ]);
  progress = saved;
  selection = savedSelection;

  buildModePicker();
  renderProgress();
  await reload();
}

void init();

// Applied once at load: browser.i18n resolves synchronously, so there is no
// flash of untranslated text.
localizeDocument();

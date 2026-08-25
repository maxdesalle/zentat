import { storage } from 'wxt/utils/storage';
import { formatZecWithSymbol } from '../../lib/conversion/format';
import { localizeDocument } from '../../lib/i18n';
import type { HeldRate } from '../../lib/rates/held';
import { getHeldRate, getRates, type RatesData } from '../../lib/storage/rates';
import { getSettings } from '../../lib/storage/settings';
import {
  accuracy,
  EMPTY_PROGRESS,
  nextQuestion,
  type Question,
  recordAttempt,
  scoreGuess,
  type TrainingProgress,
} from '../../lib/training';

// Progress is local and never leaves the machine — it exists to show the user
// their own improvement, not to be a metric.
const progressItem = storage.defineItem<TrainingProgress>('local:trainingProgress', {
  fallback: EMPTY_PROGRESS,
});

const itemEmoji = document.getElementById('item-emoji')!;
const itemLabel = document.getElementById('item-label')!;
const itemPrice = document.getElementById('item-price')!;
const guessForm = document.getElementById('guess-form') as HTMLFormElement;
const guessInput = document.getElementById('guess') as HTMLInputElement;
const result = document.getElementById('result')!;
const verdict = document.getElementById('verdict')!;
const truth = document.getElementById('truth')!;
const nextButton = document.getElementById('next')!;
const scoreline = document.getElementById('scoreline')!;
const statAccuracy = document.getElementById('stat-accuracy')!;
const statStreak = document.getElementById('stat-streak')!;
const statAttempts = document.getElementById('stat-attempts')!;
const rateNote = document.getElementById('rate-note')!;

let rates: RatesData | null = null;
let held: HeldRate | null = null;
let currency = 'USD';
let question: Question | null = null;
let progress = EMPTY_PROGRESS;

function ask(): void {
  if (!rates) return;
  question = nextQuestion(rates, currency, held, question?.item.id);
  if (!question) {
    rateNote.textContent = `No ${currency} rate available — try again once rates load.`;
    return;
  }

  itemEmoji.textContent = question.item.emoji;
  itemLabel.textContent = question.item.label;
  itemPrice.textContent = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: question.currency,
  }).format(question.item.amount);

  result.hidden = true;
  guessForm.hidden = false;
  guessInput.value = '';
  guessInput.focus();
}

function renderProgress(): void {
  scoreline.hidden = progress.attempts === 0;
  const mean = accuracy(progress);
  statAccuracy.textContent = mean === null ? '--' : `${Math.round(mean)}%`;
  statStreak.textContent = String(progress.streak);
  statAttempts.textContent = String(progress.attempts);
}

guessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!question) return;

  const score = scoreGuess(Number(guessInput.value), question.answer);
  if (!score) return;

  // The real answer, always — the point is to leave with the right number in
  // mind, not just a score.
  const direction = score.error > 0 ? 'high' : 'low';
  verdict.textContent = score.verdict === 'spot on'
    ? `Spot on — ${score.points} points`
    : `${score.verdict[0].toUpperCase()}${score.verdict.slice(1)} — ${
      Math.abs(Math.round(score.error * 100))
    }% ${direction}, ${score.points} points`;
  truth.textContent = `${question.item.label} is ${formatZecWithSymbol(question.answer)}`;

  guessForm.hidden = true;
  result.hidden = false;
  nextButton.focus();

  progress = recordAttempt(progress, score);
  renderProgress();
  await progressItem.setValue(progress);
});

nextButton.addEventListener('click', ask);

async function init(): Promise<void> {
  const [settings, loadedRates, loadedHeld, saved] = await Promise.all([
    getSettings(),
    getRates(),
    getHeldRate(),
    progressItem.getValue(),
  ]);

  currency = settings.displayCurrency;
  rates = loadedRates;
  held = settings.rateMode === 'spot' ? null : loadedHeld;
  progress = saved;

  // Practising against a rate that moves between questions would be teaching
  // noise, so say which rate is in play.
  rateNote.textContent = held
    ? 'Practising at the held rate — the same one you see on pages.'
    : 'Practising at the current market rate.';

  renderProgress();
  ask();
}

void init();

// Applied once at load: browser.i18n resolves synchronously, so there is no
// flash of untranslated text.
localizeDocument();

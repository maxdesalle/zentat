import { type HeldRate, heldRateFor } from './rates/held';
import type { RatesData } from './storage/rates';

/**
 * Estimate-first practice.
 *
 * Passive exposure to converted prices does not teach a unit — it is a subtitle
 * track, and the crutch removes every occasion to recall. Active recall is what
 * builds the intuition, so this asks the user for a number BEFORE showing one.
 *
 * Scoring is on relative error and is deliberately generous: the skill being
 * trained is order-of-magnitude judgement ("about half a ZEC", "a few ZEC"),
 * not arithmetic. Someone who can place a price within a quarter of its value
 * has the thing that matters; someone off by 10x does not.
 */

export interface TrainingItem {
  id: string;
  label: string;
  /** A recognisable price in the user's reference currency. */
  amount: number;
  emoji: string;
}

/**
 * Deliberately everyday objects with prices people already hold in their heads.
 * The point is to bind a ZEC quantity to an existing anchor, not to teach the
 * price of the object.
 */
export const TRAINING_ITEMS: TrainingItem[] = [
  { id: 'coffee', label: 'a coffee', amount: 4, emoji: '☕' },
  { id: 'lunch', label: 'lunch out', amount: 15, emoji: '🥪' },
  { id: 'book', label: 'a paperback', amount: 12, emoji: '📕' },
  { id: 'shirt', label: 'a t-shirt', amount: 25, emoji: '👕' },
  { id: 'tank', label: 'a tank of fuel', amount: 70, emoji: '⛽' },
  { id: 'shoes', label: 'running shoes', amount: 130, emoji: '👟' },
  { id: 'headphones', label: 'headphones', amount: 350, emoji: '🎧' },
  { id: 'phone', label: 'a new phone', amount: 900, emoji: '📱' },
  { id: 'laptop', label: 'a laptop', amount: 1600, emoji: '💻' },
  { id: 'rent', label: 'a month of rent', amount: 1800, emoji: '🏠' },
  { id: 'car', label: 'a used car', amount: 9000, emoji: '🚗' },
];

export interface Question {
  item: TrainingItem;
  currency: string;
  /** The ZEC value being guessed at. */
  answer: number;
}

export function nextQuestion(
  rates: RatesData,
  currency: string,
  held?: HeldRate | null,
  exclude?: string,
): Question | null {
  const rate = held
    ? heldRateFor(held, rates, currency)
    : rates.rates[currency.toUpperCase()];
  if (!rate || !(rate > 0)) return null;

  const pool = TRAINING_ITEMS.filter((item) => item.id !== exclude);
  const item = pool[Math.floor(Math.random() * pool.length)];
  return { item, currency: currency.toUpperCase(), answer: item.amount * rate };
}

export interface Score {
  /** 0-100. */
  points: number;
  /** Signed relative error: +0.5 means the guess was 50% high. */
  error: number;
  verdict: 'spot on' | 'close' | 'in the region' | 'way off';
}

/**
 * Score a guess.
 *
 * Relative error, not absolute, because being 0.1 ZEC out on a coffee and on a
 * car are completely different achievements. Scored on a log scale so that
 * "twice as much" and "half as much" are penalised equally — a linear scale
 * would treat overestimates as far worse than underestimates, which is an
 * artifact of the arithmetic rather than a real difference in skill.
 */
export function scoreGuess(guess: number, answer: number): Score | null {
  if (!(guess > 0) || !(answer > 0)) return null;

  const ratio = guess / answer;
  const error = ratio - 1;
  // A factor of 4 in either direction scores zero.
  const logError = Math.abs(Math.log(ratio)) / Math.log(4);
  const points = Math.max(0, Math.round((1 - logError) * 100));

  const off = Math.abs(error);
  const verdict = off <= 0.1
    ? 'spot on'
    : off <= 0.25
    ? 'close'
    : off <= 0.6
    ? 'in the region'
    : 'way off';

  return { points, error, verdict };
}

export interface TrainingProgress {
  attempts: number;
  totalPoints: number;
  /** Consecutive answers scoring 'close' or better. */
  streak: number;
  bestStreak: number;
}

export const EMPTY_PROGRESS: TrainingProgress = {
  attempts: 0,
  totalPoints: 0,
  streak: 0,
  bestStreak: 0,
};

export function recordAttempt(progress: TrainingProgress, score: Score): TrainingProgress {
  const good = score.verdict === 'spot on' || score.verdict === 'close';
  const streak = good ? progress.streak + 1 : 0;
  return {
    attempts: progress.attempts + 1,
    totalPoints: progress.totalPoints + score.points,
    streak,
    bestStreak: Math.max(progress.bestStreak, streak),
  };
}

/** Mean points per attempt — the number that actually shows improvement. */
export function accuracy(progress: TrainingProgress): number | null {
  if (progress.attempts === 0) return null;
  return progress.totalPoints / progress.attempts;
}

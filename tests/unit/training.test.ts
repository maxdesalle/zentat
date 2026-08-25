import { describe, expect, it } from 'vitest';
import type { RatesData } from '../../src/lib/storage/rates';
import {
  accuracy,
  EMPTY_PROGRESS,
  nextQuestion,
  recordAttempt,
  scoreGuess,
  TRAINING_ITEMS,
} from '../../src/lib/training';

const rates: RatesData = {
  rates: { USD: 0.00125 },
  updatedAt: Date.now(),
  source: 'test',
};

describe('scoring rewards judgement, not arithmetic', () => {
  it('gives full marks for an exact guess', () => {
    expect(scoreGuess(1, 1)!.points).toBe(100);
    expect(scoreGuess(1, 1)!.verdict).toBe('spot on');
  });

  it('treats double and half as equally wrong', () => {
    // On a linear scale, overestimates look far worse than underestimates —
    // an artifact of the arithmetic, not a real difference in skill.
    expect(scoreGuess(2, 1)!.points).toBe(scoreGuess(0.5, 1)!.points);
    expect(scoreGuess(4, 1)!.points).toBe(scoreGuess(0.25, 1)!.points);
  });

  it('scores zero at a factor of four out, and never negative', () => {
    expect(scoreGuess(4, 1)!.points).toBe(0);
    expect(scoreGuess(1000, 1)!.points).toBe(0);
    expect(scoreGuess(0.0001, 1)!.points).toBe(0);
  });

  it('grades the verdict by how far off, in either direction', () => {
    expect(scoreGuess(1.05, 1)!.verdict).toBe('spot on');
    expect(scoreGuess(1.2, 1)!.verdict).toBe('close');
    expect(scoreGuess(0.8, 1)!.verdict).toBe('close');
    expect(scoreGuess(1.5, 1)!.verdict).toBe('in the region');
    expect(scoreGuess(3, 1)!.verdict).toBe('way off');
  });

  it('reports the signed error so the user learns which way they lean', () => {
    expect(scoreGuess(1.5, 1)!.error).toBeCloseTo(0.5, 10);
    expect(scoreGuess(0.5, 1)!.error).toBeCloseTo(-0.5, 10);
  });

  it('refuses nonsense input', () => {
    expect(scoreGuess(0, 1)).toBeNull();
    expect(scoreGuess(-1, 1)).toBeNull();
    expect(scoreGuess(1, 0)).toBeNull();
  });
});

describe('questions', () => {
  it('asks about a real item at the current rate', () => {
    const question = nextQuestion(rates, 'USD')!;
    expect(TRAINING_ITEMS).toContainEqual(question.item);
    expect(question.answer).toBeCloseTo(question.item.amount * 0.00125, 12);
  });

  it('does not repeat the item just asked', () => {
    const first = nextQuestion(rates, 'USD')!;
    for (let i = 0; i < 40; i++) {
      expect(nextQuestion(rates, 'USD', null, first.item.id)!.item.id).not.toBe(first.item.id);
    }
  });

  it('returns nothing when it has no rate to ask about', () => {
    expect(nextQuestion(rates, 'JPY')).toBeNull();
  });
});

describe('progress', () => {
  it('builds a streak on good answers and breaks it on a bad one', () => {
    let progress = EMPTY_PROGRESS;
    progress = recordAttempt(progress, scoreGuess(1, 1)!);
    progress = recordAttempt(progress, scoreGuess(1.1, 1)!);
    expect(progress.streak).toBe(2);

    progress = recordAttempt(progress, scoreGuess(3, 1)!);
    expect(progress.streak).toBe(0);
    expect(progress.bestStreak).toBe(2);
    expect(progress.attempts).toBe(3);
  });

  it('reports mean accuracy, which is what shows improvement', () => {
    let progress = EMPTY_PROGRESS;
    expect(accuracy(progress)).toBeNull();
    progress = recordAttempt(progress, scoreGuess(1, 1)!);
    progress = recordAttempt(progress, scoreGuess(4, 1)!);
    expect(accuracy(progress)).toBeCloseTo(50, 10);
  });
});

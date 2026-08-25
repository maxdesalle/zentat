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

// Spec: tests/trees/training.tree

const rates: RatesData = {
  rates: { USD: 0.00125 },
  updatedAt: Date.now(),
  source: 'test',
};

describe('scoreGuess', () => {
  describe('given an exact guess', () => {
    it('gives full marks', () => {
      expect(scoreGuess(1, 1)!.points).toBe(100);
      expect(scoreGuess(1, 1)!.verdict).toBe('spot on');
    });
  });

  describe('given a guess off by a factor', () => {
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

    it('reports the signed error so the user learns which way they lean', () => {
      expect(scoreGuess(1.5, 1)!.error).toBeCloseTo(0.5, 10);
      expect(scoreGuess(0.5, 1)!.error).toBeCloseTo(-0.5, 10);
    });
  });

  it('grades the verdict by how far off, in either direction', () => {
    expect(scoreGuess(1.05, 1)!.verdict).toBe('spot on');
    expect(scoreGuess(1.2, 1)!.verdict).toBe('close');
    expect(scoreGuess(0.8, 1)!.verdict).toBe('close');
    expect(scoreGuess(1.5, 1)!.verdict).toBe('in the region');
    expect(scoreGuess(3, 1)!.verdict).toBe('way off');
  });

  describe('given nonsense input', () => {
    it('refuses a non-positive guess', () => {
      expect(scoreGuess(0, 1)).toBeNull();
      expect(scoreGuess(-1, 1)).toBeNull();
    });

    it('refuses a non-positive answer', () => {
      expect(scoreGuess(1, 0)).toBeNull();
    });
  });
});

describe('nextQuestion', () => {
  describe('given a spot rate', () => {
    it('asks about a real item at the current rate', () => {
      const question = nextQuestion(rates, 'USD')!;
      expect(TRAINING_ITEMS).toContainEqual(question.item);
      expect(question.answer).toBeCloseTo(question.item.amount * 0.00125, 12);
    });
  });

  describe('given a held rate', () => {
    it('asks at the rate the pages are showing', () => {
      // Training the user on a number no page displays would teach them the
      // wrong level.
      const held = { peg: 0.00125, pegged: Date.now() };
      const moved: RatesData = { ...rates, rates: { USD: 0.002 } };
      const question = nextQuestion(moved, 'USD', held)!;
      expect(question.answer).toBeCloseTo(question.item.amount * 0.00125, 12);
    });
  });

  describe('when an item is excluded', () => {
    it('does not repeat the item just asked', () => {
      const first = nextQuestion(rates, 'USD')!;
      for (let i = 0; i < 40; i++) {
        expect(nextQuestion(rates, 'USD', null, first.item.id)!.item.id).not.toBe(first.item.id);
      }
    });
  });

  describe('given no rate to ask about', () => {
    it('returns nothing', () => {
      expect(nextQuestion(rates, 'JPY')).toBeNull();
    });
  });

  describe('given a held rate that cannot cover the currency', () => {
    it('returns nothing', () => {
      const held = { peg: 0.00125, pegged: Date.now() };
      expect(nextQuestion(rates, 'JPY', held)).toBeNull();
    });
  });
});

describe('recordAttempt', () => {
  it('builds a streak on good answers and breaks it on a bad one', () => {
    let progress = EMPTY_PROGRESS;
    progress = recordAttempt(progress, scoreGuess(1, 1)!);
    progress = recordAttempt(progress, scoreGuess(1.1, 1)!);
    expect(progress.streak).toBe(2);

    progress = recordAttempt(progress, scoreGuess(3, 1)!);
    expect(progress.streak).toBe(0);
    expect(progress.attempts).toBe(3);
  });

  it('remembers the best streak reached', () => {
    let progress = EMPTY_PROGRESS;
    for (const guess of [1, 1.1, 3]) progress = recordAttempt(progress, scoreGuess(guess, 1)!);
    expect(progress.bestStreak).toBe(2);
  });
});

describe('accuracy', () => {
  it('reports mean accuracy, which is what shows improvement', () => {
    let progress = EMPTY_PROGRESS;
    progress = recordAttempt(progress, scoreGuess(1, 1)!);
    progress = recordAttempt(progress, scoreGuess(4, 1)!);
    expect(accuracy(progress)).toBeCloseTo(50, 10);
  });

  describe('given no attempts yet', () => {
    it('reports nothing', () => {
      // Zero would read as "you are getting everything wrong".
      expect(accuracy(EMPTY_PROGRESS)).toBeNull();
    });
  });
});

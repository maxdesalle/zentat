import { describe, expect, it } from 'vitest';
import { bandOf, type Question, scoreAnswer } from '../../src/lib/practice/types';

// Spec: tests/trees/practice.types.tree

const numeric: Question = {
  mode: 'to-zec',
  prompt: 'how many ZEC?',
  emoji: '☕',
  input: 'number',
  answer: 0.5,
  explain: 'half a ZEC',
  band: 'everyday',
};

const choice: Question = {
  mode: 'from-zec',
  prompt: 'which one?',
  emoji: '❓',
  input: 'choice',
  choices: [{ id: 'a', label: 'a coffee' }, { id: 'b', label: 'a laptop' }],
  answer: 0.5,
  correct: 'b',
  explain: 'a laptop',
  band: 'everyday',
};

describe('bandOf', () => {
  describe('given amounts across the range', () => {
    it('names the band each falls in', () => {
      expect(bandOf(0.001)).toBe('tiny');
      expect(bandOf(0.05)).toBe('small');
      expect(bandOf(0.5)).toBe('everyday');
      expect(bandOf(5)).toBe('large');
      expect(bandOf(500)).toBe('huge');
    });
  });

  describe('given an amount exactly on a boundary', () => {
    it('puts it in the higher band', () => {
      // One comparison decides every edge, so the boundaries cannot drift
      // apart as bands are added.
      expect(bandOf(0.01)).toBe('small');
      expect(bandOf(0.1)).toBe('everyday');
      expect(bandOf(1)).toBe('large');
      expect(bandOf(10)).toBe('huge');
    });
  });
});

describe('scoreAnswer', () => {
  describe('given a numeric question', () => {
    it('scores it on relative error', () => {
      expect(scoreAnswer(numeric, 0.5)?.verdict).toBe('spot on');
      expect(scoreAnswer(numeric, 5)?.verdict).toBe('way off');
    });

    it('reads a numeric answer given as text', () => {
      // The DOM hands back strings, and a string that parses is a real answer.
      expect(scoreAnswer(numeric, '0.5')?.points).toBe(100);
    });

    it('refuses an answer that is not a number', () => {
      expect(scoreAnswer(numeric, 'nonsense')).toBeNull();
    });
  });

  describe('given a choice question', () => {
    it('awards everything for the right choice', () => {
      expect(scoreAnswer(choice, 'b')).toEqual({ points: 100, error: 0, verdict: 'spot on' });
    });

    it('awards nothing for a wrong one', () => {
      // No partial credit in picking one of four: there is no near miss.
      expect(scoreAnswer(choice, 'a')).toEqual({ points: 0, error: 0, verdict: 'way off' });
    });

    it('refuses to score one with no answer recorded', () => {
      // Scoring it as wrong would blame the user for our own omission.
      expect(scoreAnswer({ ...choice, correct: undefined }, 'a')).toBeNull();
    });
  });
});

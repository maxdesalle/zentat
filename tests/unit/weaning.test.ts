import { describe, expect, it } from 'vitest';
import { daysToNextStage, describeStage, weanStage } from '../../src/lib/weaning';

const DAY = 24 * 60 * 60 * 1000;
const start = 1_000_000_000_000;
const after = (days: number) => start + days * DAY;

// Spec: tests/trees/weaning.tree

describe('weanStage', () => {
  describe('given the first week', () => {
    it('starts by changing nothing', () => {
      // Withdrawing the fiat price on day one just breaks the page for
      // someone who cannot yet read the ZEC number.
      expect(weanStage(start, after(0))).toBe('always');
      expect(weanStage(start, after(6))).toBe('always');
    });
  });

  describe('given later weeks', () => {
    it('moves through the stages on schedule', () => {
      expect(weanStage(start, after(7))).toBe('delayed');
      expect(weanStage(start, after(20))).toBe('delayed');
      expect(weanStage(start, after(21))).toBe('on-demand');
      expect(weanStage(start, after(44))).toBe('on-demand');
      expect(weanStage(start, after(45))).toBe('hidden');
      expect(weanStage(start, after(400))).toBe('hidden');
    });
  });

  describe('given weaning was never started', () => {
    it('does nothing', () => {
      expect(weanStage(0)).toBe('always');
    });
  });

  describe('given a clock that went backwards', () => {
    it('is not fooled', () => {
      // A timezone change or a corrected system clock must not jump the user
      // to a stage they have not earned.
      expect(weanStage(after(10), start)).toBe('always');
    });
  });
});

describe('daysToNextStage', () => {
  describe('given a stage still ahead', () => {
    it('says how long until the next step', () => {
      expect(daysToNextStage(start, after(0))).toBe(7);
      expect(daysToNextStage(start, after(6.5))).toBe(1);
    });
  });

  describe('given the last stage is reached', () => {
    it('stops counting', () => {
      expect(daysToNextStage(start, after(45))).toBeNull();
    });
  });

  describe('given weaning was never started', () => {
    it('says nothing', () => {
      expect(daysToNextStage(0)).toBeNull();
      // A device whose clock has not synced yet sits near the epoch, which is
      // only days away from a countdown for weaning that never began.
      expect(daysToNextStage(0, 3 * DAY)).toBeNull();
    });
  });

  describe('given the start is still ahead', () => {
    it('counts down to the day weaning begins', () => {
      expect(daysToNextStage(after(10), start)).toBe(10);
    });
  });
});

const STAGES = ['always', 'delayed', 'on-demand', 'hidden'] as const;

describe('describeStage', () => {
  it('describes every stage', () => {
    for (const stage of STAGES) {
      expect(describeStage(stage).length).toBeGreaterThan(0);
    }
  });

  it('gives each stage its own wording', () => {
    // This line is the only thing telling the user how to reach the fiat price,
    // and it changes at every stage. Repeating a neighbour's wording tells them
    // to reach for a crutch that is no longer there.
    const wordings = STAGES.map(describeStage);
    expect(new Set(wordings).size).toBe(STAGES.length);
  });
});

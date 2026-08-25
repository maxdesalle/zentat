import { describe, expect, it } from 'vitest';
import { daysToNextStage, describeStage, weanStage } from '../../src/lib/weaning';

const DAY = 24 * 60 * 60 * 1000;
const start = 1_000_000_000_000;
const after = (days: number) => start + days * DAY;

describe('the fiat crutch is withdrawn gradually', () => {
  it('starts by changing nothing', () => {
    expect(weanStage(start, after(0))).toBe('always');
    expect(weanStage(start, after(6))).toBe('always');
  });

  it('moves through the stages on schedule', () => {
    expect(weanStage(start, after(7))).toBe('delayed');
    expect(weanStage(start, after(20))).toBe('delayed');
    expect(weanStage(start, after(21))).toBe('on-demand');
    expect(weanStage(start, after(44))).toBe('on-demand');
    expect(weanStage(start, after(45))).toBe('hidden');
    expect(weanStage(start, after(400))).toBe('hidden');
  });

  it('does nothing until weaning has actually started', () => {
    expect(weanStage(0)).toBe('always');
  });

  it('is not fooled by a clock that went backwards', () => {
    expect(weanStage(after(10), start)).toBe('always');
  });

  it('says how long until the next step, and stops once finished', () => {
    expect(daysToNextStage(start, after(0))).toBe(7);
    expect(daysToNextStage(start, after(6.5))).toBe(1);
    expect(daysToNextStage(start, after(45))).toBeNull();
    expect(daysToNextStage(0)).toBeNull();
  });

  it('describes every stage', () => {
    for (const stage of ['always', 'delayed', 'on-demand', 'hidden'] as const) {
      expect(describeStage(stage).length).toBeGreaterThan(0);
    }
  });
});

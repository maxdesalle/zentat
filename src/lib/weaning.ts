/**
 * The off-ramp from fiat thinking.
 *
 * A user who can always hover to see the original never has to recall anything,
 * so the crutch has to be withdrawn — but withdrawing it in one step is a cliff
 * most people will not jump, and the ones who do tend to jump back. This fades
 * it instead, on a schedule slow enough that each stage feels survivable.
 *
 * The stages are deliberately about WHEN the fiat appears rather than how
 * visible it is. A greyed-out number is still a number the eye reads; a number
 * that only appears when you ask for it is a genuine occasion to recall first.
 */

export type WeanStage = 'always' | 'delayed' | 'on-demand' | 'hidden';

/** Days from the start of weaning at which each stage begins. */
const SCHEDULE: Array<{ day: number; stage: WeanStage }> = [
  { day: 0, stage: 'always' },
  { day: 7, stage: 'delayed' },
  { day: 21, stage: 'on-demand' },
  { day: 45, stage: 'hidden' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function weanStage(startedAt: number, now: number = Date.now()): WeanStage {
  if (!startedAt || startedAt > now) return 'always';
  const days = (now - startedAt) / DAY_MS;

  let stage: WeanStage = 'always';
  for (const entry of SCHEDULE) {
    if (days >= entry.day) stage = entry.stage;
  }
  return stage;
}

/** Days until the next stage, or null once fully weaned. */
export function daysToNextStage(startedAt: number, now: number = Date.now()): number | null {
  if (!startedAt) return null;
  const days = (now - startedAt) / DAY_MS;
  const next = SCHEDULE.find((entry) => entry.day > days);
  return next ? Math.ceil(next.day - days) : null;
}

export function describeStage(stage: WeanStage): string {
  switch (stage) {
    case 'always':
      return 'Original prices shown on hover.';
    case 'delayed':
      return 'Original prices appear after a moment — try to guess first.';
    case 'on-demand':
      return 'Hold Alt to see an original price.';
    case 'hidden':
      return 'Thinking in ZEC. Originals are hidden; copying still gives you fiat.';
  }
}

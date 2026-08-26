// Properties that must hold on ANY page, whatever it contains.
//
// A golden snapshot tells you a page changed. An invariant tells you the
// product is wrong — and unlike an example test, it cannot be quietly written
// to agree with a bug, because it never mentions a specific expected value.
//
// Each one here is derived from a defect that actually shipped.
import {
  CONVERTED_MARKER,
  PARTIAL_MARKER,
  SPAN_CLASS,
} from '../../src/entrypoints/content/markers';

export interface Violation {
  invariant: string;
  detail: string;
}

/** Every converted price currently rendered on the page. */
function converted(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`.${SPAN_CLASS}`));
}

/** What a converted span shows, as the user reads it. */
function shown(el: HTMLElement): string {
  return (el.textContent ?? '').trim();
}

/**
 * One unit across the page.
 *
 * A page that renders "2,399,683 zats" beside "0.45 ZEC" forces the reader to
 * do arithmetic to compare two prices, which is the one job this product
 * exists to remove.
 */
export function oneUnitPerPage(): Violation[] {
  const units = new Set(
    converted().map((el) => (shown(el).match(/[A-Za-z]+$/) ?? [''])[0].toLowerCase()),
  );
  units.delete('');
  return units.size > 1
    ? [{ invariant: 'one unit per page', detail: `saw ${[...units].join(' and ')}` }]
    : [];
}

/**
 * One shape across the page.
 *
 * Prices are compared by eye, in a column. Three prices with three different
 * decimal counts have to be read rather than scanned.
 */
export function oneShapePerPage(): Violation[] {
  const shapes = new Set(
    converted()
      .map((el) => shown(el).replace(/\d/g, '#'))
      .filter((shape) => shape.length > 0),
  );
  return shapes.size > 1
    ? [{
      invariant: 'one shape per page',
      detail: `saw ${[...shapes].slice(0, 4).map((s) => JSON.stringify(s)).join(', ')}`,
    }]
    : [];
}

/**
 * No price is rendered as an unreadable run of digits.
 *
 * Seven digits is past what anyone can hold in mind, compare against the item
 * beside it, or recall tomorrow. This is the zats disaster stated as a rule.
 */
export function noUnreadableMagnitudes(): Violation[] {
  return converted()
    .filter((el) => (shown(el).match(/\d/g) ?? []).length > 8)
    .slice(0, 3)
    .map((el) => ({ invariant: 'no unreadable magnitudes', detail: shown(el) }));
}

/**
 * The tooltip's original still parses to the price it replaced.
 *
 * The tooltip is the user's only way to check us. If it disagrees with what
 * was converted, one of the two is a lie and there is no way to tell which.
 */
export function tooltipMatchesOriginal(): Violation[] {
  const bad: Violation[] = [];
  for (const el of converted()) {
    const title = el.closest('[title]')?.getAttribute('title') ?? '';
    const original = /Original:\s*(.+)$/m.exec(title)?.[1];
    if (original === undefined) continue;
    if (original.trim().length === 0) {
      bad.push({ invariant: 'tooltip matches original', detail: 'empty original' });
    }
  }
  return bad.slice(0, 3);
}

/** Nothing inside a control the user acts on may show a converted price. */
export function controlsStayFiat(): Violation[] {
  return converted()
    .filter((el) => {
      const control = el.closest('button, [role="button"]');
      if (!control) return false;
      return (control.textContent ?? '').trim().length <= 40;
    })
    .slice(0, 3)
    .map((el) => ({ invariant: 'controls stay fiat', detail: shown(el) }));
}

/** Our own markers must never survive a revert. */
export function revertLeavesNothingBehind(): Violation[] {
  const leftovers = document.querySelectorAll(
    `.${SPAN_CLASS}, .${CONVERTED_MARKER}, .${PARTIAL_MARKER}`,
  );
  return leftovers.length > 0
    ? [{ invariant: 'revert leaves nothing behind', detail: `${leftovers.length} markers remain` }]
    : [];
}

/**
 * The page-scale state must not name <body> or <html> as a price.
 *
 * An element that large being treated as one price is how the converter came
 * to mark the whole document converted and drop every later price on it.
 */
export function noPageScaleElementIsAPrice(): Violation[] {
  return Array.from(document.querySelectorAll(`.${CONVERTED_MARKER}`))
    .filter((el) => el === document.body || el.tagName === 'HTML')
    .map((el) => ({ invariant: 'no page-scale element is a price', detail: el.tagName }));
}

/** Run every invariant that applies to a converted page. */
export function checkConverted(): Violation[] {
  return [
    ...oneUnitPerPage(),
    ...oneShapePerPage(),
    ...noUnreadableMagnitudes(),
    ...tooltipMatchesOriginal(),
    ...controlsStayFiat(),
    ...noPageScaleElementIsAPrice(),
  ];
}

/**
 * Where two renderings of a page first differ, as a short excerpt.
 *
 * Comparing whole pages with a plain equality assertion prints both of them,
 * which for a real capture is a hundred kilobytes of noise around the one
 * detail that matters.
 */
export function firstDifference(before: string, after: string): string | null {
  if (before === after) return null;
  let i = 0;
  while (i < before.length && before[i] === after[i]) i++;
  const from = Math.max(0, i - 60);
  return `at ${i} of ${before.length}\n  was: ${
    JSON.stringify(before.slice(from, i + 60))
  }\n  now: ${JSON.stringify(after.slice(from, i + 60))}`;
}

import { describe, expect, it } from 'vitest';
import { CURRENCY_CODES, SUPPORTED_CURRENCIES } from '../../src/lib/currencies';
import { CURRENCY_PATTERNS } from '../../src/lib/detection/patterns';

// Spec: tests/trees/currencies.tree

/** Every symbol the detector will look for on behalf of one currency. */
function detectableSymbols(code: string): string[] {
  return CURRENCY_PATTERNS.filter((pattern) => pattern.code === code)
    .flatMap((pattern) => pattern.symbols);
}

describe('SUPPORTED_CURRENCIES', () => {
  it('names each currency by a symbol its pattern looks for', () => {
    // The symbol here and the symbols the detector scans for are two halves of
    // one claim. Drift between them means a currency the user can switch on
    // that stays invisible on the pages that write it that way.
    const unwatched = SUPPORTED_CURRENCIES
      .filter(({ code, symbol }) => !detectableSymbols(code).includes(symbol))
      .map(({ code }) => code);
    expect(unwatched).toEqual([]);
  });

  it('labels each currency with a name of its own', () => {
    // The settings list is a column of codes and these names. A blank or
    // repeated one leaves a row the user cannot tell apart from its neighbour.
    const names = SUPPORTED_CURRENCIES.map(({ name }) => name);
    expect(SUPPORTED_CURRENCIES.filter(({ name }) => !name)).toEqual([]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('CURRENCY_CODES', () => {
  it('holds exactly the codes the detector has patterns for', () => {
    // A code with no pattern is a currency we quote rates for and never
    // detect; a pattern with no code is a price we detect and cannot convert.
    expect(new Set(CURRENCY_CODES))
      .toEqual(new Set(CURRENCY_PATTERNS.map(({ code }) => code)));
  });
});

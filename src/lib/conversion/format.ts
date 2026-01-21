export type Precision = 'auto' | number;

/**
 * Format ZEC amount with adaptive precision.
 *
 * Rules for 'auto':
 * - Minimum 2 decimals always shown
 * - Expand until 4 significant figures are visible
 *
 * Examples:
 * - 100      → "100.00"
 * - 1.234    → "1.2340"
 * - 0.001234 → "0.001234"
 * - 0.00001  → "0.00001000"
 */
export function formatZec(amount: number, precision: Precision = 'auto'): string {
  if (precision !== 'auto') {
    return amount.toFixed(precision);
  }

  // Auto precision: minimum 2 decimals, expand for 4 significant figures
  const minDecimals = 2;
  const targetSigFigs = 4;

  // Handle zero
  if (amount === 0) {
    return '0.00';
  }

  const absAmount = Math.abs(amount);

  // Count leading zeros after decimal
  let decimalsNeeded = minDecimals;

  if (absAmount < 1) {
    // For numbers < 1, we need to show enough decimals to get significant figures
    const log10 = Math.floor(Math.log10(absAmount));
    // log10 of 0.001 is -3, so we need 3 leading zeros
    const leadingZeros = -log10 - 1;
    // We need leadingZeros + targetSigFigs decimals
    decimalsNeeded = Math.max(minDecimals, leadingZeros + targetSigFigs);
  } else {
    // For numbers >= 1, check if we need more than 2 decimals
    // Count digits before decimal
    const intPart = Math.floor(absAmount);
    const intDigits = intPart === 0 ? 0 : Math.floor(Math.log10(intPart)) + 1;
    const sigFigsNeeded = Math.max(0, targetSigFigs - intDigits);
    decimalsNeeded = Math.max(minDecimals, sigFigsNeeded);
  }

  // Cap at reasonable max
  decimalsNeeded = Math.min(decimalsNeeded, 8);

  return amount.toFixed(decimalsNeeded);
}

export function formatZecWithSymbol(amount: number, precision: Precision = 'auto'): string {
  return `${formatZec(amount, precision)} ZEC`;
}

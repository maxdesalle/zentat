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

/**
 * Format ZEC amount with symbol, using human-readable units for large amounts.
 *
 * Examples:
 * - 1.234              → "1.2340 ZEC"
 * - 27150              → "27.15 thousand ZEC"
 * - 1234567            → "1.235 million ZEC"
 * - 1234567890         → "1.235 billion ZEC"
 * - 1234567890000      → "1.235 trillion ZEC"
 */
export function formatZecWithSymbol(amount: number, precision: Precision = 'auto'): string {
  const absAmount = Math.abs(amount);

  // Use units for large amounts to improve readability
  if (absAmount >= 1_000_000_000_000) {
    // Trillion
    const scaled = amount / 1_000_000_000_000;
    return `${formatScaledNumber(scaled)} trillion ZEC`;
  } else if (absAmount >= 1_000_000_000) {
    // Billion
    const scaled = amount / 1_000_000_000;
    return `${formatScaledNumber(scaled)} billion ZEC`;
  } else if (absAmount >= 1_000_000) {
    // Million
    const scaled = amount / 1_000_000;
    return `${formatScaledNumber(scaled)} million ZEC`;
  } else if (absAmount >= 1_000) {
    // Thousand - use this for amounts >= 1000 for better readability
    const scaled = amount / 1_000;
    return `${formatScaledNumber(scaled)} thousand ZEC`;
  }

  // Standard format for smaller amounts
  return `${formatZec(amount, precision)} ZEC`;
}

/**
 * Format scaled number with appropriate precision (3-4 significant figures).
 */
function formatScaledNumber(num: number): string {
  const absNum = Math.abs(num);

  if (absNum >= 100) {
    // 100+ → show 1 decimal (e.g., 123.4)
    return num.toFixed(1);
  } else if (absNum >= 10) {
    // 10-99 → show 2 decimals (e.g., 12.34)
    return num.toFixed(2);
  } else {
    // 1-9 → show 3 decimals (e.g., 1.234)
    return num.toFixed(3);
  }
}

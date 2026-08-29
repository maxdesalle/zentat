import { storage } from 'wxt/utils/storage';
import type { SeenPrice } from '../practice/seen';

/**
 * Where the opt-in practice material lives.
 *
 * Local storage, never sync: the whole point of keeping this off the sync area
 * is that a list of prices someone has looked at should not be uploaded to
 * Google or Mozilla on their behalf. See PRIVACY.md, which promises exactly
 * that, and src/lib/practice/seen.ts, where the shape of the data is what
 * enforces the rest.
 */
const seenItem = storage.defineItem<SeenPrice[]>('local:practiceSeen', {
  fallback: [],
});

export async function getSeenPrices(): Promise<SeenPrice[]> {
  return seenItem.getValue();
}

export async function setSeenPrices(prices: SeenPrice[]): Promise<void> {
  await seenItem.setValue(prices);
}

/**
 * Empty it.
 *
 * Called both by the Clear button and by turning the setting off, because
 * PRIVACY.md says turning it off clears it — and a promise in that file has to
 * be literally true of the code.
 */
export async function clearSeenPrices(): Promise<void> {
  await seenItem.setValue([]);
}

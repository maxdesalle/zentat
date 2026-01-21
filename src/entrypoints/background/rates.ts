import { fetchRatesWithRetry } from '../../lib/rates/provider';
import { setRates, getRates, isRatesStale } from '../../lib/storage/rates';

export async function refreshRates(force: boolean = false): Promise<boolean> {
  try {
    // Check if refresh is needed
    if (!force) {
      const current = await getRates();
      if (!isRatesStale(current)) {
        return true;
      }
    }

    const result = await fetchRatesWithRetry();

    if (result.success && result.data) {
      await setRates(result.data);
      return true;
    }

    console.error('Zentat: Failed to fetch rates', result.errors);
    return false;
  } catch (error) {
    console.error('Zentat: Rate refresh error', error);
    return false;
  }
}

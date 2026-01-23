import { createFetcher } from '../../lib/fetch';
import { fetchRatesWithRetry } from '../../lib/rates/provider';
import { setRates, getRates, isRatesStale } from '../../lib/storage/rates';
import { getSettings } from '../../lib/storage/settings';

export async function refreshRates(force: boolean = false): Promise<boolean> {
  try {
    // Check if refresh is needed
    if (!force) {
      const current = await getRates();
      if (!isRatesStale(current)) {
        return true;
      }
    }

    const settings = await getSettings();
    const fetcher = createFetcher({
      nymEnabled: settings.nymEnabled,
      nymTimeoutMs: settings.nymTimeoutMs,
    });

    const result = await fetchRatesWithRetry(fetcher, { isNym: settings.nymEnabled });

    if (result.success && result.data) {
      await setRates(result.data);
      return true;
    }

    return false;
  } catch (error) {
    console.error('Zentat: Rate refresh error', error);
    return false;
  }
}

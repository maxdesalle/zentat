import { createFetcher } from '../../lib/fetch';
import { destroyNymConnection } from '../../lib/fetch/nym';
import { fetchRatesWithRetry } from '../../lib/rates/provider';
import { setRates, getRates, isRatesStale } from '../../lib/storage/rates';
import { getSettings } from '../../lib/storage/settings';

// Max retries per refresh cycle when Nym fails (each retry gets a new gateway)
const NYM_MAX_RETRIES = 5;

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

    // If Nym is enabled, retry aggressively with different gateways
    if (settings.nymEnabled) {
      for (let attempt = 1; attempt <= NYM_MAX_RETRIES; attempt++) {
        console.log(`Zentat: Nym fetch attempt ${attempt}/${NYM_MAX_RETRIES}`);

        const fetcher = createFetcher({
          nymEnabled: true,
          nymTimeoutMs: settings.nymTimeoutMs,
        });

        const result = await fetchRatesWithRetry(fetcher, { isNym: true });

        if (result.success && result.data) {
          await setRates(result.data);
          console.log('Zentat: Nym fetch succeeded');
          return true;
        }

        // Failed - destroy and recreate for new gateway on next attempt
        if (attempt < NYM_MAX_RETRIES) {
          console.log('Zentat: Nym failed, destroying for new gateway...');
          await destroyNymConnection();
          // Small delay before retry
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      console.log('Zentat: All Nym attempts failed, will retry next cycle');
      return false;
    }

    // Direct fetch (Nym disabled)
    const fetcher = createFetcher({
      nymEnabled: false,
    });

    const result = await fetchRatesWithRetry(fetcher, { isNym: false });

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

import { storage } from 'wxt/utils/storage';
import { createFetcher } from '../../lib/fetch';
import { destroyNymConnection } from '../../lib/fetch/nym';
import { debug } from '../../lib/log';
import { updateHeldRate } from '../../lib/rates/held';
import { fetchRatesWithRetry } from '../../lib/rates/provider';
import { validateRates } from '../../lib/rates/validate';
import {
  getHeldRate,
  getRates,
  isRatesStale,
  mergeRates,
  setFetchStatus,
  setHeldRate,
  setRates,
} from '../../lib/storage/rates';
import { getSettings } from '../../lib/storage/settings';

// Max Nym attempts per refresh cycle (each retry gets a new gateway). Kept low
// and combined with a cross-cycle backoff so a broken mixnet connection doesn't
// burn a distinctive stream of fresh gateway registrations every alarm cycle.
// Nym's own client retries one gateway ten times before giving up on it, so
// churning to a new gateway is a last resort rather than a first response.
const NYM_MAX_RETRIES = 2;
const NYM_BACKOFF_MS = 15 * 60 * 1000;

// Small random delay before each scheduled fetch so the extension's network
// cadence is not a machine-precise fingerprint.
const MAX_JITTER_MS = 90 * 1000;

// The fallback is read at exactly one place, the `Date.now() <` comparison
// below, and 'local:nymBackoffUntil' is not read anywhere else in the codebase.
// Both 0 and the fallback-less undefined make that comparison false, so no
// stored state and no argument can tell the two apart.
// Stryker disable next-line ObjectLiteral: no input distinguishes it from {}
const nymBackoffItem = storage.defineItem<number>('local:nymBackoffUntil', { fallback: 0 });

let inFlight: Promise<boolean> | null = null;
let cutJitterShort: (() => void) | null = null;

// Serialized: overlapping triggers (alarm, worker cold start, popup refresh)
// join the running cycle instead of racing it — concurrent cycles used to
// destroy the Nym offscreen document out from under each other. The module
// variable dies with the service worker, which is exactly the re-entrancy
// we want after a mid-cycle termination.
export function refreshRates(force: boolean = false): Promise<boolean> {
  if (inFlight) {
    // A forced caller joins the running cycle rather than starting a second
    // one, but it does NOT inherit its patience. This used to swallow `force`
    // whole: the background body kicks off an unforced cycle during script
    // evaluation, that cycle goes to sleep in the privacy jitter, and the
    // install's forced fetch then joined it — so the welcome page sat on
    // "waiting for the rate…" for up to ninety seconds while the first thing
    // a new user ever saw was the product failing to do its one job.
    if (force) cutJitterShort?.();
    return inFlight;
  }
  inFlight = doRefresh(force).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(force: boolean): Promise<boolean> {
  // Keep the MV3 service worker alive during long (Nym) fetches: any
  // extension-API call resets Chrome's ~30s idle timer.
  const keepalive = setInterval(() => {
    void browser.runtime.getPlatformInfo?.().catch(() => {});
  }, 20_000);

  // Cleared on both paths explicitly rather than in a `finally`. A leaked
  // interval holds the service worker awake forever, which is the opposite of
  // what it is for — and the explicit form makes that impossible to lose in a
  // refactor.
  try {
    const ok = await attemptRefresh(force);
    clearInterval(keepalive);
    return ok;
  } catch (error) {
    clearInterval(keepalive);
    console.error('Zentat: Rate refresh error', error);
    await setFetchStatus('error', error instanceof Error ? error.message : String(error)).catch(
      () => {},
    );
    return false;
  }
}

async function attemptRefresh(force: boolean): Promise<boolean> {
  // Check if refresh is needed
  if (!force) {
    const current = await getRates();
    if (!isRatesStale(current)) {
      return true;
    }
    // Nothing cached at all means this is the first run. The jitter blurs a
    // RECURRING cadence into something that is not a fingerprint; a cold cache
    // has no cadence to blur yet, and its timing is already correlated with
    // the install event whatever we do here.
    if (current.updatedAt) {
      // Written before the wait, not after, so the UI can tell "waiting" from
      // "idle". A Nym fetch can legitimately take a minute and the user is
      // owed an explanation for it.
      await setFetchStatus('fetching');
      await jitterSleep(Math.random() * MAX_JITTER_MS);
    }
  }

  const settings = await getSettings();
  await setFetchStatus('fetching');

  // If Nym is enabled, retry with different gateways — never fall back to a
  // direct fetch, which would leak the user's IP to the rate API.
  if (settings.nymEnabled) {
    if (!force && Date.now() < (await nymBackoffItem.getValue())) {
      debug('Nym in backoff window, skipping this cycle');
      await setFetchStatus('error', 'Nym unavailable, backing off');
      return false;
    }

    for (let attempt = 1; attempt <= NYM_MAX_RETRIES; attempt++) {
      debug(`Nym fetch attempt ${attempt}/${NYM_MAX_RETRIES}`);

      const fetcher = createFetcher({
        nymEnabled: true,
        nymTimeoutMs: settings.nymTimeoutMs,
      });

      const result = await fetchRatesWithRetry(fetcher, {
        isNym: true,
        source: settings.rateSource,
      });

      if (result.success && result.data) {
        await storeRates(result.data);
        await nymBackoffItem.setValue(0);
        debug('Nym fetch succeeded');
        return true;
      }

      // Failed - destroy and recreate for new gateway on next attempt
      if (attempt < NYM_MAX_RETRIES) {
        debug('Nym failed, destroying for new gateway...');
        await destroyNymConnection();
        // Matches the gateway client's own 5s backoff ladder; 2s just retries the
        // same congested state.
        await sleep(15_000);
      }
    }

    debug('All Nym attempts failed, backing off before next cycle');
    await nymBackoffItem.setValue(Date.now() + NYM_BACKOFF_MS);
    await setFetchStatus('error', 'Could not reach rate API through Nym');
    return false;
  }

  // Direct fetch (Nym disabled)
  const fetcher = createFetcher({
    nymEnabled: false,
  });

  const result = await fetchRatesWithRetry(fetcher, { source: settings.rateSource });

  if (result.success && result.data) {
    await storeRates(result.data);
    return true;
  }

  await setFetchStatus('error', result.errors.join('; ') || 'Rate fetch failed');
  return false;
}

// Merge over the existing cache so a partial provider result (Kraken only
// serves USD/EUR) never wipes the other currencies' recent rates.
async function storeRates(data: Awaited<ReturnType<typeof getRates>>): Promise<void> {
  const current = await getRates();
  const { rates, rejected } = validateRates(data, current);

  if (rejected.length > 0) {
    debug(`Rejected implausible rates: ${rejected.join(', ')}`);
  }
  if (Object.keys(rates).length === 0) {
    await setFetchStatus('error', 'Rates failed a plausibility check');
    return;
  }

  const merged = mergeRates(current, { ...data, rates });
  await setRates(merged);

  // The held rate is derived here, once, so every surface reads the same peg
  // rather than each re-deriving it and drifting.
  const settings = await getSettings();
  const previous = await getHeldRate();
  const { held, repegged } = updateHeldRate(previous, merged, settings.heldBand);
  if (held && held !== previous) await setHeldRate(held);
  if (repegged) {
    debug(`Held rate re-pegged: ZEC moved past ${Math.round(settings.heldBand * 100)}%`);
  }

  await setFetchStatus('ok');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A jitter wait that a forced refresh can cut short. */
function jitterSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      cutJitterShort = null;
      resolve();
    };
    const timer = setTimeout(finish, ms);
    cutJitterShort = finish;
  });
}

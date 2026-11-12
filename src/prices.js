import { ALLOWED_IDS } from './validate.js';

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';

export class PricesUnavailableError extends Error {
  constructor(reason) {
    super(`Prices are not available yet: ${reason}`);
    this.name = 'PricesUnavailableError';
  }
}

export async function fetchPrices(ids, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const url = new URL(COINGECKO_URL);
  url.searchParams.set('ids', ids.join(','));
  url.searchParams.set('vs_currencies', 'usd');
  url.searchParams.set('include_24hr_change', 'true');

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`CoinGecko timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`CoinGecko responded with status ${response.status}`);
    }

    const body = await response.json();
    const prices = {};

    for (const id of ids) {
      const coin = body?.[id];
      if (typeof coin?.usd !== 'number') {
        throw new Error(`CoinGecko returned no USD price for ${id}`);
      }
      prices[id] = {
        usd: coin.usd,
        change24h: typeof coin.usd_24h_change === 'number' ? coin.usd_24h_change : null,
      };
    }

    return prices;
  } catch (err) {
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function createPriceCache({
  fetcher = fetchPrices,
  ids = ALLOWED_IDS,
  ttlMs = 60_000,
  now = Date.now,
} = {}) {
  let prices = null;
  let fetchedAt = null;
  let stale = false;
  let lastError = null;
  let lastAttemptAt = null;
  let inflight = null;

  function current() {
    if (!prices) {
      throw new PricesUnavailableError(lastError);
    }
    return { prices, fetchedAt, stale, error: stale ? lastError : null };
  }

  async function refresh() {
    lastAttemptAt = now();
    try {
      prices = await fetcher(ids);
      fetchedAt = now();
      stale = false;
      lastError = null;
    } catch (err) {
      stale = true;
      lastError = err?.message ?? String(err);
    }
    return current();
  }

  function get() {
    if (inflight) {
      return inflight;
    }

    if (lastAttemptAt !== null && now() - lastAttemptAt < ttlMs) {
      return Promise.resolve().then(current);
    }

    inflight = refresh().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return { get };
}

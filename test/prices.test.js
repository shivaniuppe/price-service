import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPrices, createPriceCache, PricesUnavailableError } from '../src/prices.js';

const COINGECKO_BODY = {
  bitcoin: { usd: 65000, usd_24h_change: -1.5 },
  ethereum: { usd: 3200, usd_24h_change: 2.25 },
};

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeClock(start = 1_000_000) {
  const clock = { time: start, now: () => clock.time };
  return clock;
}

function countingFetcher(results) {
  const fetcher = async () => {
    fetcher.calls += 1;
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fetcher.calls = 0;
  return fetcher;
}

const FIRST = { bitcoin: { usd: 65000, change24h: -1.5 } };
const SECOND = { bitcoin: { usd: 66000, change24h: 0.5 } };

describe('fetchPrices', () => {
  test('calls CoinGecko and returns USD price and 24h change', async () => {
    let requestedUrl;
    const fetchImpl = async (url) => {
      requestedUrl = new URL(url);
      return jsonResponse(COINGECKO_BODY);
    };

    const prices = await fetchPrices(['bitcoin', 'ethereum'], { fetchImpl });

    assert.equal(requestedUrl.origin + requestedUrl.pathname, 'https://api.coingecko.com/api/v3/simple/price');
    assert.equal(requestedUrl.searchParams.get('ids'), 'bitcoin,ethereum');
    assert.equal(requestedUrl.searchParams.get('vs_currencies'), 'usd');
    assert.equal(requestedUrl.searchParams.get('include_24hr_change'), 'true');
    assert.deepEqual(prices, {
      bitcoin: { usd: 65000, change24h: -1.5 },
      ethereum: { usd: 3200, change24h: 2.25 },
    });
  });

  test('throws when CoinGecko returns an error status', async () => {
    const fetchImpl = async () => jsonResponse({ error: 'rate limited' }, 429);
    await assert.rejects(fetchPrices(['bitcoin'], { fetchImpl }), /status 429/);
  });

  test('throws when a coin is missing from the response', async () => {
    const fetchImpl = async () => jsonResponse({ bitcoin: { usd: 65000 } });
    await assert.rejects(fetchPrices(['bitcoin', 'ethereum'], { fetchImpl }), /no USD price for ethereum/);
  });

  test('times out instead of hanging', async () => {
    const fetchImpl = (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });

    const started = Date.now();
    await assert.rejects(fetchPrices(['bitcoin'], { fetchImpl, timeoutMs: 50 }), /timed out after 50ms/);
    assert.ok(Date.now() - started < 1000);
  });
});

describe('createPriceCache', () => {
  test('serves cached prices for a minute without calling CoinGecko again', async () => {
    const clock = fakeClock();
    const fetcher = countingFetcher([FIRST]);
    const cache = createPriceCache({ fetcher, now: clock.now });

    const first = await cache.get();
    clock.time += 59_999;
    const second = await cache.get();

    assert.equal(fetcher.calls, 1);
    assert.deepEqual(second, first);
    assert.equal(second.stale, false);
  });

  test('fetches again once the minute is up', async () => {
    const clock = fakeClock();
    const fetcher = countingFetcher([FIRST, SECOND]);
    const cache = createPriceCache({ fetcher, now: clock.now });

    await cache.get();
    clock.time += 60_000;
    const result = await cache.get();

    assert.equal(fetcher.calls, 2);
    assert.deepEqual(result.prices, SECOND);
    assert.equal(result.fetchedAt, clock.time);
  });

  test('many requests at the same time share one CoinGecko call', async () => {
    let release;
    const fetcher = async () => {
      fetcher.calls += 1;
      await new Promise((resolve) => {
        release = resolve;
      });
      return FIRST;
    };
    fetcher.calls = 0;
    const cache = createPriceCache({ fetcher });

    const pending = Array.from({ length: 50 }, () => cache.get());
    release();
    const results = await Promise.all(pending);

    assert.equal(fetcher.calls, 1);
    assert.ok(results.every((result) => result.prices === FIRST));
  });

  test('when CoinGecko fails, returns the old prices marked as stale', async () => {
    const clock = fakeClock();
    const fetcher = countingFetcher([FIRST, new Error('CoinGecko is down')]);
    const cache = createPriceCache({ fetcher, now: clock.now });

    const fresh = await cache.get();
    clock.time += 60_000;
    const result = await cache.get();

    assert.equal(fetcher.calls, 2);
    assert.equal(result.stale, true);
    assert.deepEqual(result.prices, FIRST);
    assert.equal(result.fetchedAt, fresh.fetchedAt);
    assert.equal(result.error, 'CoinGecko is down');
  });

  test('after a failure, waits a minute before trying CoinGecko again', async () => {
    const clock = fakeClock();
    const fetcher = countingFetcher([FIRST, new Error('down'), SECOND]);
    const cache = createPriceCache({ fetcher, now: clock.now });

    await cache.get();
    clock.time += 60_000;
    await cache.get();
    clock.time += 30_000;
    const stillStale = await cache.get();

    assert.equal(fetcher.calls, 2);
    assert.equal(stillStale.stale, true);

    clock.time += 30_000;
    const recovered = await cache.get();

    assert.equal(fetcher.calls, 3);
    assert.equal(recovered.stale, false);
    assert.deepEqual(recovered.prices, SECOND);
  });

  test('throws a clear error when CoinGecko fails and there are no old prices', async () => {
    const clock = fakeClock();
    const fetcher = countingFetcher([new Error('down'), new Error('down')]);
    const cache = createPriceCache({ fetcher, now: clock.now });

    await assert.rejects(cache.get(), PricesUnavailableError);
    clock.time += 10_000;
    await assert.rejects(cache.get(), /Prices are not available yet: down/);
    assert.equal(fetcher.calls, 1);
  });
});

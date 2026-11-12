import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/main.js';
import { createPriceCache } from '../src/prices.js';

const PRICES = {
  bitcoin: { usd: 65000, change24h: -1.5 },
  ethereum: { usd: 3200, change24h: 2.25 },
  solana: { usd: 150, change24h: 4 },
  dogecoin: { usd: 0.15, change24h: 0 },
  cardano: { usd: 0.45, change24h: -0.75 },
  ripple: { usd: 0.6, change24h: 1 },
};

function setup(results) {
  const clock = { time: Date.UTC(2026, 10, 12, 15, 0, 0) };
  const fetcher = async () => {
    fetcher.calls += 1;
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fetcher.calls = 0;
  const cache = createPriceCache({ fetcher, now: () => clock.time });
  return { clock, fetcher, handler: createHandler(cache) };
}

function context({ method = 'GET', query = {} } = {}) {
  const logs = [];
  const errors = [];
  return {
    req: { method, query },
    res: {
      json: (body, statusCode = 200, headers = {}) => ({ body, statusCode, headers }),
    },
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    logs,
    errors,
  };
}

test('returns USD price, 24h change and fetch time for each requested coin', async () => {
  const { handler } = setup([PRICES]);

  const response = await handler(context({ query: { ids: 'bitcoin,ethereum' } }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    stale: false,
    fetchedAt: '2026-11-12T15:00:00.000Z',
    prices: {
      bitcoin: { usd: 65000, change24h: -1.5, fetchedAt: '2026-11-12T15:00:00.000Z' },
      ethereum: { usd: 3200, change24h: 2.25, fetchedAt: '2026-11-12T15:00:00.000Z' },
    },
  });
});

test('when CoinGecko fails, returns the old prices marked as stale', async () => {
  const { clock, handler } = setup([PRICES, new Error('CoinGecko is down')]);

  await handler(context({ query: { ids: 'bitcoin' } }));
  clock.time += 5 * 60_000;
  const ctx = context({ query: { ids: 'bitcoin' } });
  const response = await handler(ctx);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.stale, true);
  assert.equal(response.body.fetchedAt, '2026-11-12T15:00:00.000Z');
  assert.deepEqual(response.body.prices.bitcoin, {
    usd: 65000,
    change24h: -1.5,
    fetchedAt: '2026-11-12T15:00:00.000Z',
  });
  assert.match(ctx.errors[0], /CoinGecko is down/);
});

test('returns 503 when CoinGecko fails and there are no old prices', async () => {
  const { handler } = setup([new Error('CoinGecko is down')]);

  const response = await handler(context({ query: { ids: 'bitcoin' } }));

  assert.equal(response.statusCode, 503);
  assert.match(response.body.error, /temporarily unavailable/);
});

test('rejects unknown coin ids with 400 without calling CoinGecko', async () => {
  const { fetcher, handler } = setup([PRICES]);

  const response = await handler(context({ query: { ids: 'bitcoin,notacoin' } }));

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /Unknown ids: notacoin/);
  assert.equal(fetcher.calls, 0);
});

test('rejects more than 10 ids with 400', async () => {
  const { handler } = setup([PRICES]);

  const response = await handler(context({ query: { ids: Array(11).fill('bitcoin').join(',') } }));

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /Too many ids/);
});

test('rejects a request with no ids with 400', async () => {
  const { handler } = setup([PRICES]);

  const response = await handler(context());

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /Missing ids/);
});

test('rejects methods other than GET with 405', async () => {
  const { handler } = setup([PRICES]);

  const response = await handler(context({ method: 'POST', query: { ids: 'bitcoin' } }));

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, 'GET');
});

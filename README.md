# price-service

An Appwrite function (Node 18+, ES modules, no dependencies) that returns USD prices and 24-hour change from CoinGecko, fetching at most once a minute and serving the last good prices when CoinGecko is down.

```
GET ?ids=bitcoin,ethereum
200 { "stale": false, "fetchedAt": "...", "prices": { "bitcoin": { "usd": 71572, "change24h": -3.7, "fetchedAt": "..." } } }
200 { "stale": true, ... }   CoinGecko failed, these are the last good prices from fetchedAt
400 { "error": "..." }       missing ids, unknown ids, empty entries or more than 10 ids
405 { "error": "..." }       anything other than GET
503 { "error": "..." }       CoinGecko failed and there are no good prices yet
```

Allowed ids: `bitcoin`, `ethereum`, `solana`, `dogecoin`, `cardano`, `ripple`.

## Running the tests

```
npm test
```

This uses Node's built-in test runner. CoinGecko is always faked, so the tests need no network.

## Layout

- `src/validate.js` checks the `ids` against the allow-list and the 10-id limit.
- `src/prices.js` makes the CoinGecko call (5 second timeout) and holds the one-minute cache.
- `src/main.js` is the Appwrite entry point and turns results into HTTP responses.

## Where the cache lives, and what happens on a fresh copy

The cache is a plain variable in memory inside one running copy of the function (created at module load in `src/main.js`). It lasts only as long as Appwrite keeps that copy warm.

- **Concurrent requests** to the same copy share one CoinGecko call, because they all wait on the same promise.
- **CoinGecko attempts** happen at most once a minute per copy, whether they succeed or fail. During an outage, users get the stale prices straight away instead of waiting on a timeout.
- **A fresh copy** (cold start, redeploy, scale-out, or Appwrite recycling an idle container) starts with an empty cache. Its first request calls CoinGecko again. If CoinGecko is down at that moment, there are no old prices to fall back on, so it returns a 503, even though another copy may be holding good prices.
- **Several copies** running at once each have their own cache, so "once a minute" is really "once a minute per copy". On the free CoinGecko tier that can hit the rate limit (429).

So this cache makes requests fast while one copy is warm. It does **not** guarantee one fetch a minute across the whole app, and it does not survive restarts.

## What I'd fix next

1. **Move the cache somewhere shared and durable.** An Appwrite database document or a Redis key holding `{ prices, fetchedAt }` would work. Every copy reads from it, so a cold start can still serve stale prices.
2. **Fetch on a schedule instead of on request.** A separate scheduled Appwrite function (cron, every minute) would fetch from CoinGecko and write to that shared store. `price-service` then only reads. That makes "once a minute" true globally, and no user ever waits on CoinGecko.
3. **Use a CoinGecko API key, kept in an Appwrite environment variable and never in code.** The free public API's rate limit is tight for a production app.
4. **Add a `Cache-Control: max-age=60` header**, so phones and any CDN in front of the function avoid repeat calls.
5. **Rethink how a single missing coin is handled.** If CoinGecko leaves one coin out, the whole fetch is treated as failed. That's safe today, but as the list grows it may be better to keep the good coins and mark only the missing one as stale.
6. **Rethink the plan's reliance on a free third-party API for a core screen.** A second price source to fall back on would make that screen more reliable.

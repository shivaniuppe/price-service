import { parseIds } from './validate.js';
import { createPriceCache, PricesUnavailableError } from './prices.js';

export function createHandler(cache) {
  return async ({ req, res, log, error }) => {
    if (req.method !== 'GET') {
      return res.json({ error: 'Only GET requests are supported.' }, 405, { allow: 'GET' });
    }

    const parsed = parseIds(req.query?.ids);
    if (!parsed.ok) {
      return res.json({ error: parsed.error }, 400);
    }

    let result;
    try {
      result = await cache.get();
    } catch (err) {
      error(`Price lookup failed: ${err.message}`);
      if (err instanceof PricesUnavailableError) {
        return res.json(
          { error: 'Prices are temporarily unavailable. Please try again in a minute.' },
          503,
        );
      }
      return res.json({ error: 'Something went wrong while getting prices.' }, 500);
    }

    const fetchedAt = new Date(result.fetchedAt).toISOString();

    if (result.stale) {
      error(`CoinGecko unavailable, serving prices from ${fetchedAt}: ${result.error}`);
    } else {
      log(`Serving prices fetched at ${fetchedAt}`);
    }

    const prices = Object.fromEntries(
      parsed.ids.map((id) => [id, { ...result.prices[id], fetchedAt }]),
    );

    return res.json({ stale: result.stale, fetchedAt, prices });
  };
}

export default createHandler(createPriceCache());

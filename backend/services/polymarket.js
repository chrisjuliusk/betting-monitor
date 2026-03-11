const GAMMA_API = process.env.GAMMA_API || 'https://gamma-api.polymarket.com';
const CLOB_API = process.env.CLOB_API || 'https://clob.polymarket.com';
const DATA_API = process.env.DATA_API || 'https://data-api.polymarket.com';

async function requestJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'polymarket-pod-monitor/1.0',
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} for ${url} :: ${text.slice(0, 200)}`);
  }

  return response.json();
}

export async function fetchActiveMarkets(limit = 200) {
  const url = new URL(`${GAMMA_API}/markets`);
  url.searchParams.set('active', 'true');
  url.searchParams.set('closed', 'false');
  url.searchParams.set('archived', 'false');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('order', 'volume24hr');

  const payload = await requestJson(url.toString());
  const markets = Array.isArray(payload) ? payload : payload.data || [];

  return markets.map((market) => normalizeMarket(market)).filter(Boolean);
}

function normalizeMarket(market) {
  const tokenId = market.clobTokenIds?.[0] || market.tokenId || market.token_id || market.asset_id || null;
  const conditionId = market.conditionId || market.condition_id || market.id || null;
  if (!tokenId || !conditionId) return null;

  return {
    id: String(conditionId),
    conditionId: String(conditionId),
    tokenId: String(tokenId),
    slug: market.slug || '',
    question: market.question || market.title || market.description || 'Untitled market',
    title: market.question || market.title || 'Untitled market',
    outcome: market.outcomes?.[0] || market.outcome || market.groupItemTitle || 'YES',
    outcomes: market.outcomes || [],
    icon: market.icon || market.image || '',
    category: market.category || market.tags?.[0]?.label || '',
    endDate: market.endDate || market.end_date || null,
    active: Boolean(market.active ?? true),
    liquidity: Number(market.liquidity ?? market.liquidityNum ?? 0),
    volume: Number(market.volume ?? market.volumeNum ?? 0),
    volume24hr: Number(market.volume24hr ?? market.volume24hrNum ?? 0),
  };
}

export async function fetchPricesHistory(tokenId, interval = '1m', fidelity = 1) {
  const url = new URL(`${CLOB_API}/prices-history`);
  url.searchParams.set('market', tokenId);
  url.searchParams.set('interval', interval);
  url.searchParams.set('fidelity', String(fidelity));

  const payload = await requestJson(url.toString());
  return payload.history || [];
}

export async function fetchOrderBook(tokenId) {
  const url = new URL(`${CLOB_API}/book`);
  url.searchParams.set('token_id', tokenId);
  return requestJson(url.toString());
}

export async function fetchTradesForMarket(conditionId, limit = 50) {
  const url = new URL(`${DATA_API}/trades`);
  url.searchParams.set('market', conditionId);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', '0');
  url.searchParams.set('takerOnly', 'true');

  const payload = await requestJson(url.toString());
  return Array.isArray(payload) ? payload : [];
}

export async function fetchProfile(address) {
  const url = new URL(`${GAMMA_API}/public-profile`);
  url.searchParams.set('address', address);

  try {
    return await requestJson(url.toString());
  } catch {
    return null;
  }
}

export async function enrichTradesWithProfiles(trades = [], maxProfiles = 8) {
  const unique = [];
  const seen = new Set();

  for (const trade of trades) {
    const address = String(trade.proxyWallet || '').toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    unique.push(address);
    if (unique.length >= maxProfiles) break;
  }

  const profileEntries = await Promise.all(
    unique.map(async (address) => [address, await fetchProfile(address)]),
  );

  const profileMap = new Map(profileEntries);

  return trades.map((trade) => {
    const address = String(trade.proxyWallet || '').toLowerCase();
    const profile = profileMap.get(address);

    return {
      ...trade,
      profile: profile
        ? {
            name: profile.name || null,
            pseudonym: profile.pseudonym || null,
            profileImage: profile.profileImage || null,
            verifiedBadge: Boolean(profile.verifiedBadge),
            xUsername: profile.xUsername || null,
          }
        : null,
    };
  });
}

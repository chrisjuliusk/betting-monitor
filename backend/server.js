import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const state = {
  rows: [],
  history: new Map(),
  lastRefresh: 0,
  lastError: '',
  scanStatus: 'idle'
};

const REFRESH_MS = 45000;
const HISTORY_LIMIT = 240;
const MARKET_LIMIT = 200;

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function pushHistory(key, point) {
  if (!key) return [];
  const arr = state.history.get(key) || [];
  const last = arr[arr.length - 1];

  if (!last || Math.abs(last.price - point.price) > 0.0000001) {
    arr.push(point);
  } else {
    last.ts = point.ts;
    last.volume = point.volume;
  }

  while (arr.length > HISTORY_LIMIT) arr.shift();
  state.history.set(key, arr);
  return arr;
}

function getWindowPoint(chart, minutes) {
  if (!chart.length) return null;
  const cutoff = Date.now() - minutes * 60 * 1000;
  let candidate = chart[0];
  for (const p of chart) {
    if (p.ts <= cutoff) candidate = p;
  }
  return candidate;
}

function computeDrop(fromPrice, toPrice) {
  const a = n(fromPrice);
  const b = n(toPrice);
  if (a <= 0 || b <= 0 || b >= a) return 0;
  return ((a - b) / a) * 100;
}

function cleanText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function marketCategory(m) {
  return (
    m.category ||
    m.groupItemTitle ||
    m.seriesSlug ||
    m.slug ||
    'Other'
  );
}

function getOutcomeRows(market) {
  const outcomes = safeArray(market.outcomes);
  const outcomePrices = safeArray(market.outcomePrices);
  const volume = n(market.volume24hr || market.volume24h || market.volume || 0);
  const spread = 0.02;

  const names = outcomes.length ? outcomes : ['YES', 'NO'];
  const prices = outcomePrices.length ? outcomePrices : [market.lastTradePrice, null];

  return names.map((outcomeName, idx) => {
    const rawPrice = prices[idx];
    const currentPrice = clamp(n(rawPrice, n(market.lastTradePrice, 0)), 0.001, 0.999);
    const id = `${market.id || market.conditionId || market.slug}-${outcomeName}`;
    const title = cleanText(market.question || market.title || market.slug || 'Untitled market');
    const key = `${market.conditionId || market.id || market.slug}:${outcomeName}`;
    const chart = pushHistory(key, {
      ts: Date.now(),
      price: currentPrice,
      volume
    });

    const openingPoint = chart[0] || null;
    const prevPoint = chart.length > 1 ? chart[chart.length - 2] : openingPoint;
    const windowPoint1m = getWindowPoint(chart, 1) || openingPoint;
    const windowPoint3m = getWindowPoint(chart, 3) || openingPoint;
    const windowPoint5m = getWindowPoint(chart, 5) || openingPoint;
    const windowPoint15m = getWindowPoint(chart, 15) || openingPoint;
    const windowPoint60m = getWindowPoint(chart, 60) || openingPoint;

    const peakPoint = chart.reduce((acc, p) => (p.price > acc.price ? p : acc), chart[0] || { price: currentPrice, ts: Date.now() });

    const drop1m = computeDrop(windowPoint1m?.price, currentPrice);
    const drop3m = computeDrop(windowPoint3m?.price, currentPrice);
    const drop5m = computeDrop(windowPoint5m?.price, currentPrice);
    const drop15m = computeDrop(windowPoint15m?.price, currentPrice);
    const drop60m = computeDrop(windowPoint60m?.price, currentPrice);
    const dropOpen = computeDrop(openingPoint?.price, currentPrice);
    const dropPeak = computeDrop(peakPoint?.price, currentPrice);

    const smartWalletScore =
      volume > 1000000 ? 92 :
      volume > 500000 ? 86 :
      volume > 250000 ? 79 :
      volume > 100000 ? 72 :
      volume > 25000 ? 64 :
      50;

    let signal = 'Watching';
    if (drop3m >= 8 || drop15m >= 12 || drop60m >= 18) signal = 'Fast move';
    else if (drop3m >= 4 || drop15m >= 6 || drop60m >= 10) signal = 'Pressure';
    else if (smartWalletScore >= 72) signal = 'Smart edge';

    const fairPrice = clamp(currentPrice + 0.01, 0.001, 0.999);

    return {
      id,
      key,
      marketId: market.id || '',
      conditionId: market.conditionId || '',
      slug: market.slug || '',
      market: title,
      category: marketCategory(market),
      outcome: String(outcomeName || '').toUpperCase(),
      currentPrice,
      previousPrice: n(prevPoint?.price, currentPrice),
      openingPrice: n(openingPoint?.price, currentPrice),
      peakPrice: n(peakPoint?.price, currentPrice),
      fairPrice,
      fairEdge: ((fairPrice - currentPrice) * 100),
      dropPct: drop3m,
      drop1m,
      drop3m,
      drop5m,
      drop15m,
      drop60m,
      dropPctOpen: dropOpen,
      dropPctPeak: dropPeak,
      aggressiveFlowUsd: 0,
      smartWalletScore,
      primaryWallet: '',
      primaryWalletName: '',
      signal,
      spread,
      volume24h: volume,
      updatedAt: Date.now(),
      chart: chart.map(p => ({ ts: p.ts, price: p.price, volume: p.volume })),
      timeline: chart.slice(-30).reverse().map(p => ({
        time: p.ts,
        price: p.price,
        fair: clamp(p.price + 0.01, 0.001, 0.999),
        size: p.volume || 0,
        tag: 'Price point'
      }))
    };
  });
}

async function fetchGammaPage(offset = 0, limit = 100) {
  const url = `https://gamma-api.polymarket.com/markets?active=true&closed=false&archived=false&limit=${limit}&offset=${offset}`;
  const res = await fetch(url, {
    headers: {
      'accept': 'application/json',
      'user-agent': 'betting-monitor/1.0'
    }
  });

  if (!res.ok) {
    throw new Error(`Gamma fetch failed: ${res.status}`);
  }

  return res.json();
}

async function refreshMarkets() {
  state.scanStatus = 'loading';

  try {
    const [page1, page2] = await Promise.all([
      fetchGammaPage(0, 100),
      fetchGammaPage(100, 100)
    ]);

    const rawMarkets = [...safeArray(page1), ...safeArray(page2)];

    const activeMarkets = rawMarkets.filter(m => {
      const q = cleanText(m.question || m.title);
      const outcomes = safeArray(m.outcomes);
      const prices = safeArray(m.outcomePrices);
      return q && outcomes.length && prices.length;
    });

    const rows = activeMarkets.flatMap(getOutcomeRows);

    rows.sort((a, b) => n(b.volume24h) - n(a.volume24h));

    state.rows = rows.slice(0, MARKET_LIMIT);
    state.lastRefresh = Date.now();
    state.lastError = '';
    state.scanStatus = 'ready';
  } catch (err) {
    state.lastError = err.message || 'Unknown refresh error';
    state.scanStatus = 'error';
    console.error('refreshMarkets error:', err);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    status: state.scanStatus,
    rows: state.rows.length,
    lastRefresh: state.lastRefresh,
    lastError: state.lastError
  });
});

app.get('/api/markets', (_req, res) => {
  res.json(state.rows);
});

app.get('/api/timeline/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key || '');
  const row = state.rows.find(r => r.key === key || r.id === key);
  res.json({
    ok: true,
    timeline: row?.timeline || [],
    chart: row?.chart || []
  });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static(__dirname));

app.listen(PORT, async () => {
  console.log(`Server listening on ${PORT}`);
  await refreshMarkets();
  setInterval(refreshMarkets, REFRESH_MS);
});

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

const REFRESH_MS = 30000;
const HISTORY_LIMIT = 300;
const MARKET_LIMIT = 400;

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function cleanText(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function parseMaybeJsonArray(value) {
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return [];

    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return s.split(',').map(x => x.trim()).filter(Boolean);
    }
  }

  return [];
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

function pushHistory(key, point) {
  if (!key) return [];

  const arr = state.history.get(key) || [];
  const last = arr[arr.length - 1];

  if (!last) {
    arr.push(point);
  } else {
    const changed = Math.abs(last.price - point.price) > 0.0000001;
    if (changed) {
      arr.push(point);
    } else {
      last.ts = point.ts;
      last.volume = point.volume;
    }
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

function toOutcomeRows(market) {
  const outcomes = parseMaybeJsonArray(market.outcomes);
  const outcomePrices = parseMaybeJsonArray(market.outcomePrices);

  if (!outcomes.length || !outcomePrices.length) return [];

  const title = cleanText(market.question || market.title || market.slug || 'Untitled market');
  const category = marketCategory(market);
  const volume = n(market.volume24hr ?? market.volume24h ?? market.volume ?? 0);
  const updatedAt = Date.now();

  return outcomes.map((rawOutcome, idx) => {
    const outcome = String(rawOutcome || '').toUpperCase();
    const currentPrice = clamp(n(outcomePrices[idx], n(market.lastTradePrice, 0.5)), 0.001, 0.999);

    const key = `${market.conditionId || market.id || market.slug}:${outcome}`;
    const chart = pushHistory(key, {
      ts: updatedAt,
      price: currentPrice,
      volume
    });

    const openingPoint = chart[0] || { ts: updatedAt, price: currentPrice, volume };
    const previousPoint = chart.length > 1 ? chart[chart.length - 2] : openingPoint;
    const peakPoint = chart.reduce((acc, p) => (p.price > acc.price ? p : acc), openingPoint);

    const p1 = getWindowPoint(chart, 1) || openingPoint;
    const p3 = getWindowPoint(chart, 3) || openingPoint;
    const p5 = getWindowPoint(chart, 5) || openingPoint;
    const p15 = getWindowPoint(chart, 15) || openingPoint;
    const p60 = getWindowPoint(chart, 60) || openingPoint;

    const drop1m = computeDrop(p1.price, currentPrice);
    const drop3m = computeDrop(p3.price, currentPrice);
    const drop5m = computeDrop(p5.price, currentPrice);
    const drop15m = computeDrop(p15.price, currentPrice);
    const drop60m = computeDrop(p60.price, currentPrice);
    const dropPctOpen = computeDrop(openingPoint.price, currentPrice);
    const dropPctPeak = computeDrop(peakPoint.price, currentPrice);

    const smartWalletScore =
      volume > 1000000 ? 92 :
      volume > 500000 ? 86 :
      volume > 250000 ? 79 :
      volume > 100000 ? 72 :
      volume > 25000 ? 64 :
      50;

    let signal = 'Watching';
    if (drop1m >= 3 || drop3m >= 5 || drop15m >= 8 || drop60m >= 12) signal = 'Fast move';
    else if (drop1m >= 1.5 || drop3m >= 3 || drop15m >= 5 || drop60m >= 8) signal = 'Pressure';
    else if (smartWalletScore >= 72) signal = 'Smart edge';

    const fairPrice = clamp(currentPrice + 0.01, 0.001, 0.999);

    return {
      id: `${market.id || market.conditionId || market.slug}-${outcome}`,
      key,
      marketId: market.id || '',
      conditionId: market.conditionId || '',
      slug: market.slug || '',
      market: title,
      category,
      outcome,
      currentPrice,
      previousPrice: n(previousPoint.price, currentPrice),
      openingPrice: n(openingPoint.price, currentPrice),
      peakPrice: n(peakPoint.price, currentPrice),
      fairPrice,
      fairEdge: (fairPrice - currentPrice) * 100,
      dropPct: drop3m,
      drop1m,
      drop3m,
      drop5m,
      drop15m,
      drop60m,
      dropPctOpen,
      dropPctPeak,
      aggressiveFlowUsd: 0,
      smartWalletScore,
      primaryWallet: '',
      primaryWalletName: '',
      signal,
      spread: 0.02,
      volume24h: volume,
      updatedAt,
      chart: chart.map(p => ({
        ts: p.ts,
        price: p.price,
        volume: p.volume
      })),
      timeline: [...chart].reverse().slice(0, 40).map(p => ({
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
      accept: 'application/json',
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
    const [page1, page2, page3, page4] = await Promise.all([
      fetchGammaPage(0, 100),
      fetchGammaPage(100, 100),
      fetchGammaPage(200, 100),
      fetchGammaPage(300, 100)
    ]);

    const rawMarkets = [...page1, ...page2, ...page3, ...page4];

    const rows = rawMarkets
      .flatMap(toOutcomeRows)
      .filter(r => r.market && r.outcome && r.currentPrice > 0);

    rows.sort((a, b) => n(b.volume24h) - n(a.volume24h));

    state.rows = rows.slice(0, MARKET_LIMIT);
    state.lastRefresh = Date.now();
    state.lastError = '';
    state.scanStatus = 'ready';

    console.log(`refresh ok: ${state.rows.length} rows`);
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

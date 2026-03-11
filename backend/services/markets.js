import { state } from "./state.js";

function parseMaybeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function pickOutcome(outcomes) {
  const arr = parseMaybeJsonArray(outcomes);
  return arr[0] ? String(arr[0]).toUpperCase() : "YES";
}

function pickCurrentPrice(market) {
  const prices = parseMaybeJsonArray(market.outcomePrices);
  if (prices.length) {
    const p = Number(prices[0]);
    if (Number.isFinite(p) && p >= 0 && p <= 1) return p;
  }

  const fallback =
    Number(market.lastTradePrice) ||
    Number(market.bestBid) ||
    Number(market.bestAsk) ||
    0.5;

  if (Number.isFinite(fallback) && fallback >= 0 && fallback <= 1) {
    return fallback;
  }

  return 0.5;
}

function pctDrop(referencePrice, currentPrice) {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return 0;
  if (!Number.isFinite(currentPrice) || currentPrice < 0) return 0;
  return Math.max(0, ((referencePrice - currentPrice) / referencePrice) * 100);
}

function trimHistory(history, now) {
  const cutoff = now - 24 * 60 * 60 * 1000;
  return history.filter((point) => point.ts >= cutoff).slice(-2000);
}

function updateHistory(id, price, now) {
  const existing = state.priceHistory.get(id) || [];
  const last = existing[existing.length - 1];

  if (!last || Math.abs(last.price - price) > 0.000001 || now - last.ts >= 15000) {
    existing.push({ ts: now, price });
  }

  const trimmed = trimHistory(existing, now);
  state.priceHistory.set(id, trimmed);
  return trimmed;
}

function getWindowPeak(history, now, windowMinutes) {
  const fromTs = now - windowMinutes * 60 * 1000;
  let peak = 0;

  for (const point of history) {
    if (point.ts >= fromTs && point.price > peak) {
      peak = point.price;
    }
  }

  if (peak > 0) return peak;
  if (history.length) return history[history.length - 1].price;
  return 0;
}

function buildChart(history, now, windowMinutes) {
  const fromTs = now - windowMinutes * 60 * 1000;
  return history
    .filter((point) => point.ts >= fromTs)
    .map((point) => ({
      ts: point.ts,
      price: point.price
    }));
}

function toMarketRow({
  market,
  currentPrice,
  previousPrice,
  openingPrice,
  dropPctOpen,
  dropPctWindow,
  chart,
  windowMinutes,
  now
}) {
  const spread = 0.02;
  const fairPrice = Math.min(0.99, Math.max(0.01, currentPrice + 0.01));

  return {
    id: String(market.id),
    market: market.question || market.groupItemTitle || "Untitled market",
    category: market.category || "Other",
    outcome: pickOutcome(market.outcomes),

    currentPrice,
    previousPrice,
    openingPrice,
    fairPrice,

    dropPct: dropPctWindow,
    dropPctOpen,
    dropPctWindow,
    dropWindowMinutes: windowMinutes,

    fairEdge: (fairPrice - currentPrice) * 100,
    aggressiveFlowUsd: 0,
    smartWalletScore: 50,
    primaryWallet: "",
    primaryWalletName: "",
    signal: "Watching",
    spread,
    volume24h: Number(market.volume24hr || market.volume || 0),
    updatedAt: now,
    conditionId: market.conditionId || "",
    slug: market.slug || "",
    chart
  };
}

export async function loadMarkets(options = {}) {
  const now = Date.now();
  const windowMinutes = Math.max(1, Number(options.windowMinutes || 60));

  const response = await fetch(
    "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200",
    {
      headers: {
        accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Gamma markets failed with ${response.status}`);
  }

  const data = await response.json();
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.markets)
    ? data.markets
    : [];

  if (!rows.length) {
    return [...state.markets.values()];
  }

  const nextMarkets = new Map();

  for (const market of rows) {
    if (market.closed || market.archived || market.active === false) continue;

    const id = String(market.id);
    const currentPrice = pickCurrentPrice(market);

    const existing = state.markets.get(id);
    const previousPrice = existing?.currentPrice ?? currentPrice;

    if (!state.marketBaselines.has(id)) {
      state.marketBaselines.set(id, {
        openingPrice: currentPrice,
        firstSeenAt: now
      });
    }

    const baseline = state.marketBaselines.get(id);
    const openingPrice = baseline?.openingPrice ?? currentPrice;

    const history = updateHistory(id, currentPrice, now);
    const windowPeak = getWindowPeak(history, now, windowMinutes);

    const dropPctOpen = pctDrop(openingPrice, currentPrice);
    const dropPctWindow = pctDrop(windowPeak, currentPrice);

    const chart = buildChart(history, now, windowMinutes);

    const row = toMarketRow({
      market,
      currentPrice,
      previousPrice,
      openingPrice,
      dropPctOpen,
      dropPctWindow,
      chart,
      windowMinutes,
      now
    });

    nextMarkets.set(id, row);
  }

  if (!nextMarkets.size) {
    return [...state.markets.values()];
  }

  state.markets = nextMarkets;
  state.lastSync = now;

  return [...state.markets.values()];
}

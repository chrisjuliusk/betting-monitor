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

function toMarketRow(market) {
  const currentPrice = pickCurrentPrice(market);
  const openingPrice = currentPrice;
  const spread = 0.02;
  const fairPrice = Math.min(0.99, Math.max(0.01, currentPrice + 0.01));

  return {
    id: String(market.id || market.conditionId || crypto.randomUUID()),
    market: market.question || market.groupItemTitle || market.slug || "Untitled market",
    category: market.category || "Other",
    outcome: pickOutcome(market.outcomes),
    currentPrice,
    previousPrice: currentPrice,
    openingPrice,
    fairPrice,
    fairEdge: (fairPrice - currentPrice) * 100,
    dropPct: 0,
    aggressiveFlowUsd: 0,
    smartWalletScore: 50,
    primaryWallet: "",
    primaryWalletName: "",
    signal: "Watching",
    spread,
    volume24h: Number(market.volume24hr || market.volume || 0),
    updatedAt: Date.now(),
    conditionId: market.conditionId || "",
    slug: market.slug || ""
  };
}

export async function loadMarkets() {
  const url =
    "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200";

  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Gamma markets failed with ${response.status}`);
  }

  const data = await response.json();

  console.log("loadMarkets raw isArray:", Array.isArray(data));
  console.log(
    "loadMarkets raw preview:",
    JSON.stringify(Array.isArray(data) ? data.slice(0, 2) : data).slice(0, 1200)
  );

  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.markets)
    ? data.markets
    : [];

  state.markets.clear();

  for (const market of rows) {
    const row = toMarketRow(market);
    state.markets.set(row.id, row);
  }

  state.lastSync = Date.now();

  console.log("loadMarkets parsed rows:", rows.length);
  console.log("state.markets size:", state.markets.size);

  return [...state.markets.values()];
}

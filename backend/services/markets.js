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
    if (Number.isFinite(p) && p > 0 && p < 1) return p;
  }

  const fallback =
    Number(market.lastTradePrice) ||
    Number(market.bestBid) ||
    Number(market.bestAsk) ||
    0.5;

  if (Number.isFinite(fallback) && fallback > 0 && fallback < 1) {
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
    id: String(market.id),
    market: market.question || market.groupItemTitle || "Untitled market",
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
    volume24h: Number(market.volume24hr || 0),
    updatedAt: Date.now(),
    conditionId: market.conditionId || "",
    slug: market.slug || ""
  };
}

export async function loadMarkets() {
  console.log("loadMarkets start");

  const response = await fetch("https://gamma-api.polymarket.com/markets");
  console.log("gamma status:", response.status);

  if (!response.ok) {
    throw new Error(`Gamma markets failed with ${response.status}`);
  }

  const data = await response.json();

  console.log("gamma isArray:", Array.isArray(data));
  console.log("gamma length:", Array.isArray(data) ? data.length : "not-array");
  console.log(
    "gamma first item:",
    Array.isArray(data) && data.length
      ? JSON.stringify(data[0]).slice(0, 700)
      : "none"
  );

  state.markets.clear();

  for (const market of data) {
    if (market.closed || market.archived || market.active === false) continue;

    const row = toMarketRow(market);
    state.markets.set(row.id, row);
  }

  console.log("state.markets size after loop:", state.markets.size);

  state.lastSync = Date.now();
  return [...state.markets.values()];
}

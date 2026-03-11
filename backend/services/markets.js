import { state } from "./state.js";

const GAMMA_URL = "https://gamma-api.polymarket.com/markets?limit=200&closed=false";

function asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickOutcomeToken(market) {
  const tokens = Array.isArray(market.tokens) ? market.tokens : [];
  if (!tokens.length) return null;

  const yes =
    tokens.find(t => String(t.outcome).toUpperCase() === "YES") ||
    tokens[0];

  return yes;
}

function buildMarket(raw) {
  const token = pickOutcomeToken(raw);
  if (!token) return null;

  const currentPrice = asNumber(
    token.price ?? token.lastPrice ?? raw.lastPrice ?? raw.bestAsk ?? 0
  );

  const previousPrice = currentPrice;
  const openingPrice = currentPrice;
  const fairPrice = Math.min(0.99, currentPrice + 0.01);

  const id = String(raw.id ?? token.token_id ?? raw.conditionId ?? Math.random());
  const marketName = raw.question || raw.title || raw.slug || "Unknown market";
  const category = raw.category || raw.groupItemTitle || "Other";
  const outcome = String(token.outcome || "YES").toUpperCase();
  const conditionId = raw.conditionId || raw.condition_id || raw.clobTokenIds?.[0] || "";
  const slug = raw.slug || "";

  return {
    id,
    market: marketName,
    category,
    outcome,
    currentPrice,
    previousPrice,
    openingPrice,
    fairPrice,
    dropPct: 0,
    dropPctOpen: 0,
    dropPctWindow: 0,
    dropWindowMinutes: 60,
    fairEdge: 1,
    aggressiveFlowUsd: 0,
    smartWalletScore: 50,
    primaryWallet: "",
    primaryWalletName: "",
    signal: "Watching",
    spread: 0.02,
    volume24h: asNumber(raw.volume24hr ?? raw.volume24h ?? raw.volume ?? 0),
    updatedAt: Date.now(),
    conditionId,
    slug,
    chart: [{ ts: Date.now(), price: currentPrice }]
  };
}

function updateExisting(prev, nextRaw) {
  const nextPrice = asNumber(nextRaw.currentPrice, prev.currentPrice);
  const prevPrice = asNumber(prev.currentPrice, nextPrice);
  const opening = asNumber(prev.openingPrice, nextPrice);

  const chart = Array.isArray(prev.chart) ? [...prev.chart] : [];
  const lastPoint = chart[chart.length - 1];

  if (!lastPoint || Math.abs(asNumber(lastPoint.price) - nextPrice) > 0.000001) {
    chart.push({ ts: Date.now(), price: nextPrice });
  }

  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const recent = chart.filter(p => now - asNumber(p.ts) <= windowMs);
  const windowOpen = recent.length ? asNumber(recent[0].price, nextPrice) : nextPrice;

  const dropPct = prevPrice > nextPrice ? ((prevPrice - nextPrice) / prevPrice) * 100 : 0;
  const dropPctOpen = opening > nextPrice ? ((opening - nextPrice) / opening) * 100 : 0;
  const dropPctWindow = windowOpen > nextPrice ? ((windowOpen - nextPrice) / windowOpen) * 100 : 0;

  let signal = "Watching";
  if (dropPctWindow >= 5) signal = "Fast move";
  else if (dropPctWindow >= 3) signal = "Pressure";

  return {
    ...prev,
    ...nextRaw,
    previousPrice: prevPrice,
    openingPrice: opening,
    updatedAt: now,
    dropPct,
    dropPctOpen,
    dropPctWindow,
    dropWindowMinutes: 60,
    signal,
    chart: chart.slice(-300)
  };
}

export async function refreshMarkets() {
  const res = await fetch(GAMMA_URL, {
    headers: {
      "accept": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`Gamma markets failed: ${res.status}`);
  }

  const data = await res.json();
  const list = Array.isArray(data) ? data : [];

  for (const raw of list) {
    const next = buildMarket(raw);
    if (!next || !next.id) continue;

    const prev = state.markets.get(next.id);
    if (!prev) {
      state.markets.set(next.id, next);
    } else {
      state.markets.set(next.id, updateExisting(prev, next));
    }
  }

  state.lastSync = Date.now();
}

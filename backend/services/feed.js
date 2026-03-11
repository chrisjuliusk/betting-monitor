import {
  analyzeMarket,
  buildSignalScore,
  classifyEvent,
  detectWhale,
  signalLabel,
} from './analyzer.js';
import {
  enrichTradesWithProfiles,
  fetchActiveMarkets,
  fetchOrderBook,
  fetchPricesHistory,
  fetchTradesForMarket,
} from './polymarket.js';

const DEFAULTS = {
  historyInterval: '1m',
  historyFidelity: 1,
  tradeLimit: 20,
  fastScanMultiplier: 2,
  hardMaxScan: 80,
  concurrency: 8,
  perMarketTimeoutMs: 6500,
  minTickDropPct: 0.15,
  minWindowDropPct: 0.25,
  minPeakToCurrentPct: 0.35,
  minOpeningDropPct: 0.5,
  minSignalScore: 8,
};

export async function buildFeed({ window = '60m', limit = 200 } = {}) {
  const windowMs = toWindowMs(window);

  // Wichtig:
  // Wir holen zuerst mehr Märkte, scannen aber NICHT unendlich viele parallel.
  // Sonst hängt Render Free.
  const requested = Number(limit || 200);
  const scanLimit = Math.min(
    Math.max(requested * DEFAULTS.fastScanMultiplier, 40),
    DEFAULTS.hardMaxScan
  );

  const markets = await fetchActiveMarkets(scanLimit);

  const results = await mapLimit(
    markets,
    DEFAULTS.concurrency,
    async (market) => processMarketForFeed(market, windowMs)
  );

  const items = results
    .filter(Boolean)
    .sort((a, b) => {
      if (a.whale.whaleFlag !== b.whale.whaleFlag) {
        return Number(b.whale.whaleFlag) - Number(a.whale.whaleFlag);
      }
      if (a.signal.score !== b.signal.score) {
        return b.signal.score - a.signal.score;
      }
      return b.analysis.windowDropPct - a.analysis.windowDropPct;
    })
    .slice(0, requested);

  return items;
}

async function processMarketForFeed(market, windowMs) {
  try {
    const history = await timeoutPromise(
      fetchPricesHistory(
        market.tokenId,
        DEFAULTS.historyInterval,
        DEFAULTS.historyFidelity
      ),
      DEFAULTS.perMarketTimeoutMs,
      `history timeout for ${market.tokenId}`
    );

    const analysis = analyzeMarket(history, windowMs);
    if (!analysis) return null;

    const score = buildSignalScore(analysis);
    const type = classifyEvent(analysis);

    // Trades und Orderbook separat, damit ein einzelner Fehler nicht alles killt
    const [orderbookResult, tradesResult] = await Promise.allSettled([
      timeoutPromise(
        fetchOrderBook(market.tokenId),
        4000,
        `orderbook timeout for ${market.tokenId}`
      ),
      timeoutPromise(
        fetchTradesForMarket(market.conditionId, DEFAULTS.tradeLimit),
        4500,
        `trades timeout for ${market.conditionId}`
      ),
    ]);

    const rawOrderbook =
      orderbookResult.status === 'fulfilled' ? orderbookResult.value : {};
    const rawTrades =
      tradesResult.status === 'fulfilled' ? tradesResult.value : [];

    let trades = [];
    try {
      trades = await timeoutPromise(
        enrichTradesWithProfiles(rawTrades.slice(0, DEFAULTS.tradeLimit), 6),
        4000,
        `profile enrichment timeout for ${market.conditionId}`
      );
    } catch {
      trades = summarizeTrades(rawTrades.slice(0, DEFAULTS.tradeLimit), false);
    }

    const whale = detectWhale(analysis, trades);

    if (!shouldEmit({ analysis, score, whale })) return null;

    return {
      id: market.id,
      tokenId: market.tokenId,
      conditionId: market.conditionId,
      title: market.title,
      question: market.question,
      outcome: market.outcome,
      slug: market.slug,
      icon: market.icon,
      category: market.category,
      endDate: market.endDate,
      volume24hr: market.volume24hr,
      volume: market.volume,
      liquidity: market.liquidity,
      currentPrice: analysis.currentPrice,
      analysis: {
        currentPrice: round(analysis.currentPrice),
        tickDropPct: round(analysis.tickDropPct),
        windowDropPct: round(analysis.windowDropPct),
        openingDropPct: round(analysis.openingDropPct),
        peakToCurrentPct: round(analysis.peakToCurrentPct),
        peakToTroughPct: round(analysis.peakToTroughPct),
        reboundPct: round(analysis.reboundPct),
        updatesInWindow: analysis.updatesInWindow,
        densityPerMin: round(analysis.densityPerMin),
        downMoves: analysis.downMoves,
        upMoves: analysis.upMoves,
        maxConsecutiveDown: analysis.maxConsecutiveDown,
        largestSingleDropPct: round(analysis.largestSingleDropPct),
        localHighPrice: round(analysis.localHighPrice),
        localLowPrice: round(analysis.localLowPrice),
        currentTs: analysis.currentTs,
        localHighTs: analysis.localHighTs,
        localLowTs: analysis.localLowTs,
      },
      signal: {
        score,
        label: signalLabel(score),
        type,
      },
      whale,
      chart: analysis.chart,
      orderbook: summarizeBook(rawOrderbook),
      trades: Array.isArray(trades) && trades.length
        ? summarizeTrades(trades, false)
        : [],
    };
  } catch {
    return null;
  }
}

export async function buildMarketDetails(conditionId, tokenId) {
  const [historyResult, orderbookResult, tradesResult] = await Promise.allSettled([
    timeoutPromise(fetchPricesHistory(tokenId, '1m', 1), 8000, 'details history timeout'),
    timeoutPromise(fetchOrderBook(tokenId), 5000, 'details orderbook timeout'),
    timeoutPromise(fetchTradesForMarket(conditionId, 100), 6000, 'details trades timeout'),
  ]);

  const history =
    historyResult.status === 'fulfilled' ? historyResult.value : [];
  const rawOrderbook =
    orderbookResult.status === 'fulfilled' ? orderbookResult.value : {};
  const rawTrades =
    tradesResult.status === 'fulfilled' ? tradesResult.value : [];

  let trades = [];
  try {
    trades = await timeoutPromise(
      enrichTradesWithProfiles(rawTrades.slice(0, 100), 12),
      5000,
      'details profile enrichment timeout'
    );
  } catch {
    trades = rawTrades.slice(0, 100);
  }

  const analysis = analyzeMarket(history, toWindowMs('60m'));
  const whale = analysis ? detectWhale(analysis, trades) : null;

  return {
    analysis,
    whale,
    chart: history,
    orderbook: summarizeBook(rawOrderbook),
    trades: summarizeTrades(trades, true),
  };
}

function summarizeBook(orderbook = {}) {
  const bids = Array.isArray(orderbook.bids)
    ? orderbook.bids.slice(0, 8).map(normalizeLevel)
    : [];
  const asks = Array.isArray(orderbook.asks)
    ? orderbook.asks.slice(0, 8).map(normalizeLevel)
    : [];

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const spread =
    bestBid != null && bestAsk != null
      ? round((bestAsk - bestBid) * 100)
      : null;

  return {
    bestBid,
    bestAsk,
    spread,
    bids,
    asks,
    lastTradePrice: Number(orderbook.last_trade_price || 0),
    tickSize: Number(orderbook.tick_size || 0),
    minOrderSize: Number(orderbook.min_order_size || 0),
    timestamp: orderbook.timestamp || null,
  };
}

function normalizeLevel(level) {
  return {
    price: Number(level.price || 0),
    size: Number(level.size || 0),
  };
}

function summarizeTrades(trades = [], full = false) {
  return trades.map((trade) => ({
    proxyWallet: trade.proxyWallet,
    side: trade.side,
    size: Number(trade.size || 0),
    price: Number(trade.price || 0),
    timestamp: Number(trade.timestamp || 0),
    outcome: trade.outcome || null,
    transactionHash: full ? trade.transactionHash || null : undefined,
    profile: trade.profile || null,
    label:
      trade.profile?.name ||
      trade.profile?.pseudonym ||
      shortenWallet(trade.proxyWallet),
  }));
}

function shortenWallet(address = '') {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'unknown';
}

function shouldEmit({ analysis, score, whale }) {
  return (
    analysis.tickDropPct >= DEFAULTS.minTickDropPct ||
    analysis.windowDropPct >= DEFAULTS.minWindowDropPct ||
    analysis.peakToCurrentPct >= DEFAULTS.minPeakToCurrentPct ||
    analysis.openingDropPct >= DEFAULTS.minOpeningDropPct ||
    score >= DEFAULTS.minSignalScore ||
    whale.whaleFlag
  );
}

function toWindowMs(window) {
  const normalized = String(window || '60m').trim().toLowerCase();
  if (normalized === '1m') return 60_000;
  if (normalized === '3m') return 180_000;
  if (normalized === '15m') return 900_000;
  return 3_600_000;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function mapLimit(items, limit, asyncMapper) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      try {
        const result = await asyncMapper(items[currentIndex], currentIndex);
        results[currentIndex] = result;
      } catch {
        results[currentIndex] = null;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

function timeoutPromise(promise, ms, message = 'timeout') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

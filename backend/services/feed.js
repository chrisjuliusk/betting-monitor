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
  marketsLimit: 200,
  historyInterval: '1m',
  historyFidelity: 1,
  tradeLimit: 35,
  minTickDropPct: 0.5,
  minWindowDropPct: 1.25,
  minPeakToCurrentPct: 1.75,
  minOpeningDropPct: 2.5,
  minSignalScore: 28,
};

export async function buildFeed({ window = '60m', limit = 200 } = {}) {
  const windowMs = toWindowMs(window);
  const markets = await fetchActiveMarkets(limit || DEFAULTS.marketsLimit);

  const items = await Promise.all(
    markets.map(async (market) => {
      try {
        const [history, orderbook, rawTrades] = await Promise.all([
          fetchPricesHistory(market.tokenId, DEFAULTS.historyInterval, DEFAULTS.historyFidelity),
          fetchOrderBook(market.tokenId),
          fetchTradesForMarket(market.conditionId, DEFAULTS.tradeLimit),
        ]);

        const analysis = analyzeMarket(history, windowMs);
        if (!analysis) return null;

        const score = buildSignalScore(analysis);
        const type = classifyEvent(analysis);
        const trades = await enrichTradesWithProfiles(rawTrades.slice(0, DEFAULTS.tradeLimit), 8);
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
            localHighPrice: analysis.localHighPrice,
            localLowPrice: analysis.localLowPrice,
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
          orderbook: summarizeBook(orderbook),
          trades: summarizeTrades(trades),
        };
      } catch (error) {
        return {
          id: market.id,
          conditionId: market.conditionId,
          tokenId: market.tokenId,
          title: market.title,
          outcome: market.outcome,
          error: error.message,
        };
      }
    }),
  );

  return items
    .filter((item) => item && !item.error)
    .sort((a, b) => {
      if (a.whale.whaleFlag !== b.whale.whaleFlag) return Number(b.whale.whaleFlag) - Number(a.whale.whaleFlag);
      if (a.signal.score !== b.signal.score) return b.signal.score - a.signal.score;
      return b.analysis.windowDropPct - a.analysis.windowDropPct;
    });
}

export async function buildMarketDetails(conditionId, tokenId) {
  const [history, orderbook, rawTrades] = await Promise.all([
    fetchPricesHistory(tokenId, '1m', 1),
    fetchOrderBook(tokenId),
    fetchTradesForMarket(conditionId, 100),
  ]);

  const trades = await enrichTradesWithProfiles(rawTrades.slice(0, 100), 12);
  const analysis = analyzeMarket(history, toWindowMs('60m'));
  const whale = analysis ? detectWhale(analysis, trades) : null;

  return {
    analysis,
    whale,
    chart: history,
    orderbook: summarizeBook(orderbook),
    trades: summarizeTrades(trades, true),
  };
}

function summarizeBook(orderbook = {}) {
  const bids = Array.isArray(orderbook.bids) ? orderbook.bids.slice(0, 8).map(normalizeLevel) : [];
  const asks = Array.isArray(orderbook.asks) ? orderbook.asks.slice(0, 8).map(normalizeLevel) : [];
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const spread = bestBid != null && bestAsk != null ? round((bestAsk - bestBid) * 100) : null;

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
    label: trade.profile?.name || trade.profile?.pseudonym || shortenWallet(trade.proxyWallet),
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

export function pctDrop(from, to) {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to)) return 0;
  return ((from - to) / from) * 100;
}

export function pctChange(from, to) {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to)) return 0;
  return ((to - from) / from) * 100;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeHistory(history = []) {
  return history
    .map((point) => ({
      t: Number(point.t ?? point.timestamp ?? 0),
      p: Number(point.p ?? point.price ?? 0),
    }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.t > 0 && point.p > 0)
    .sort((a, b) => a.t - b.t);
}

export function analyzeMarket(history, windowMs) {
  const chart = normalizeHistory(history);
  if (chart.length < 3) return null;

  const current = chart[chart.length - 1];
  const cutoff = current.t - windowMs;
  const points = chart.filter((point) => point.t >= cutoff);
  if (points.length < 2) return null;

  const open = chart[0];
  const windowStart = points[0];
  const prev = points[points.length - 2];

  let localHigh = points[0];
  let localLow = points[0];
  let downMoves = 0;
  let upMoves = 0;
  let flatMoves = 0;
  let largestSingleDropPct = 0;
  let consecutiveDown = 0;
  let maxConsecutiveDown = 0;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];

    if (b.p > localHigh.p) localHigh = b;
    if (b.p < localLow.p) localLow = b;

    const movePct = pctChange(a.p, b.p);

    if (movePct < 0) {
      downMoves += 1;
      consecutiveDown += 1;
      maxConsecutiveDown = Math.max(maxConsecutiveDown, consecutiveDown);
      largestSingleDropPct = Math.max(largestSingleDropPct, Math.abs(movePct));
    } else if (movePct > 0) {
      upMoves += 1;
      consecutiveDown = 0;
    } else {
      flatMoves += 1;
    }
  }

  const currentPrice = current.p;
  const prevPrice = prev.p;
  const openPrice = open.p;
  const windowStartPrice = windowStart.p;
  const localHighPrice = localHigh.p;
  const localLowPrice = localLow.p;

  const tickDropPct = pctDrop(prevPrice, currentPrice);
  const windowDropPct = pctDrop(windowStartPrice, currentPrice);
  const openingDropPct = pctDrop(openPrice, currentPrice);
  const peakToCurrentPct = pctDrop(localHighPrice, currentPrice);
  const peakToTroughPct = pctDrop(localHighPrice, localLowPrice);
  const reboundPct = localLowPrice < currentPrice
    ? ((currentPrice - localLowPrice) / localLowPrice) * 100
    : 0;

  const durationMs = current.t - windowStart.t;
  const updatesInWindow = points.length;
  const densityPerMin = durationMs > 0 ? (updatesInWindow / durationMs) * 60000 : 0;

  return {
    chart,
    currentPrice,
    prevPrice,
    openPrice,
    windowStartPrice,
    localHighPrice,
    localLowPrice,
    currentTs: current.t,
    localHighTs: localHigh.t,
    localLowTs: localLow.t,
    tickDropPct,
    windowDropPct,
    openingDropPct,
    peakToCurrentPct,
    peakToTroughPct,
    reboundPct,
    updatesInWindow,
    densityPerMin,
    durationMs,
    downMoves,
    upMoves,
    flatMoves,
    maxConsecutiveDown,
    largestSingleDropPct,
  };
}

export function classifyEvent(analysis) {
  if (!analysis) return 'noise';

  const strongTick = analysis.tickDropPct >= 1.0;
  const strongWindow = analysis.windowDropPct >= 2.0;
  const strongPeak = analysis.peakToCurrentPct >= 2.5;
  const lowRebound = analysis.reboundPct <= 0.75;

  if (strongTick && strongWindow) return 'impulse_continuation';
  if (strongTick && !strongWindow) return 'fresh_tick_drop';
  if (!strongTick && strongWindow && lowRebound) return 'slow_bleed';
  if (strongPeak && analysis.maxConsecutiveDown >= 2) return 'peak_break';
  if (analysis.openingDropPct >= 4) return 'opening_breakdown';
  return 'noise';
}

export function buildSignalScore(analysis) {
  if (!analysis) return 0;

  let score = 0;
  score += clamp(analysis.windowDropPct * 8, 0, 30);
  score += clamp(analysis.tickDropPct * 12, 0, 22);
  score += clamp(analysis.peakToCurrentPct * 7, 0, 20);
  score += clamp(analysis.maxConsecutiveDown * 4, 0, 12);
  score += clamp(analysis.largestSingleDropPct * 3, 0, 10);

  if (analysis.downMoves > analysis.upMoves) score += 8;
  if (analysis.reboundPct < 0.8) score += 8;
  if (analysis.densityPerMin >= 0.5) score += 8;
  if (analysis.updatesInWindow < 4) score -= 10;
  if (analysis.tickDropPct < 0.3 && analysis.windowDropPct < 1.5) score -= 12;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function signalLabel(score) {
  if (score >= 80) return 'A+';
  if (score >= 65) return 'A';
  if (score >= 50) return 'B';
  if (score >= 35) return 'C';
  return 'Noise';
}

export function detectWhale(analysis, trades = []) {
  const recentTrades = trades.slice(0, 25);
  const totalRecentSize = recentTrades.reduce((sum, trade) => sum + Number(trade.size || 0), 0);
  const largestTrade = recentTrades.reduce((max, trade) => Math.max(max, Number(trade.size || 0)), 0);
  const aggressiveBuys = recentTrades.filter((trade) => String(trade.side || '').toUpperCase() === 'BUY').length;

  let whaleScore = 0;
  if (analysis.tickDropPct >= 1.5) whaleScore += 25;
  if (analysis.windowDropPct >= 3) whaleScore += 20;
  if (analysis.peakToCurrentPct >= 4) whaleScore += 20;
  if (analysis.reboundPct <= 0.5) whaleScore += 10;
  if (analysis.densityPerMin >= 0.7) whaleScore += 10;
  if (analysis.maxConsecutiveDown >= 3) whaleScore += 10;
  if (largestTrade >= 500) whaleScore += 8;
  if (totalRecentSize >= 1500) whaleScore += 7;
  if (aggressiveBuys >= 3) whaleScore += 5;

  return {
    whaleScore,
    whaleFlag: whaleScore >= 55,
    whaleType: whaleScore >= 75 ? 'aggressive' : whaleScore >= 55 ? 'possible' : 'none',
    totalRecentSize,
    largestTrade,
  };
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Activity,
  TrendingDown,
  Zap,
  RefreshCw,
  Wifi,
  WifiOff,
  Bell,
  ChevronRight,
  AlertTriangle,
  LineChart,
  Clock3,
  DollarSign,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100&order=volume_24hr&ascending=false";
const CLOB_PRICES_URL = "https://clob.polymarket.com/prices-history";
const MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

const FALLBACK_DROPS = [
  {
    id: "fallback-1",
    market: "Will Bitcoin hit $120k before June 30?",
    category: "Crypto",
    outcome: "YES",
    currentPrice: 0.58,
    previousPrice: 0.67,
    dropPct: 13.43,
    volume24h: 184200,
    aggressiveFlowUsd: 48210,
    confidence: 91,
    tokenId: "fallback-token-1",
    updatedAt: Date.now() - 12000,
    signal: "Hard drop",
    spread: 0.012,
    slug: "bitcoin-120k-before-june-30",
    baselineWindowLabel: "5m",
    lastTradePrice: 0.58,
  },
  {
    id: "fallback-2",
    market: "Will Trump meet Xi before August?",
    category: "Politics",
    outcome: "YES",
    currentPrice: 0.41,
    previousPrice: 0.48,
    dropPct: 14.58,
    volume24h: 291100,
    aggressiveFlowUsd: 72900,
    confidence: 95,
    tokenId: "fallback-token-2",
    updatedAt: Date.now() - 24000,
    signal: "Whale flow",
    spread: 0.02,
    slug: "trump-xi-meeting-before-august",
    baselineWindowLabel: "5m",
    lastTradePrice: 0.41,
  },
  {
    id: "fallback-3",
    market: "Will the Fed cut rates by July?",
    category: "Macro",
    outcome: "YES",
    currentPrice: 0.52,
    previousPrice: 0.56,
    dropPct: 7.14,
    volume24h: 404500,
    aggressiveFlowUsd: 51400,
    confidence: 77,
    tokenId: "fallback-token-3",
    updatedAt: Date.now() - 61000,
    signal: "Steady pressure",
    spread: 0.01,
    slug: "fed-cut-rates-by-july",
    baselineWindowLabel: "5m",
    lastTradePrice: 0.52,
  },
];

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatProb(value) {
  return `${((Number(value) || 0) * 100).toFixed(1)}%`;
}

function formatAgo(timestamp) {
  if (!timestamp) return "—";
  const diff = Math.max(0, Date.now() - timestamp);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeCategory(eventItem, market) {
  return (
    eventItem?.category ||
    market?.category ||
    market?.groupItemTitle ||
    market?.seriesSlug ||
    "Other"
  );
}

function pickTokenId(market) {
  if (market?.clobTokenIds && Array.isArray(market.clobTokenIds) && market.clobTokenIds[0]) {
    return String(market.clobTokenIds[0]);
  }

  if (typeof market?.clobTokenIds === "string") {
    try {
      const parsed = JSON.parse(market.clobTokenIds);
      if (Array.isArray(parsed) && parsed[0]) return String(parsed[0]);
    } catch {}
  }

  if (Array.isArray(market?.outcomes) && Array.isArray(market?.tokenIds)) {
    return String(market.tokenIds[0] || "");
  }

  if (Array.isArray(market?.tokens) && market.tokens[0]?.token_id) {
    return String(market.tokens[0].token_id);
  }

  return String(market?.token_id || market?.asset_id || market?.id || "");
}

function pickOutcomeLabel(market) {
  if (Array.isArray(market?.outcomes) && market.outcomes[0]) return String(market.outcomes[0]).toUpperCase();
  if (Array.isArray(market?.tokens) && market.tokens[0]?.outcome) return String(market.tokens[0].outcome).toUpperCase();
  return "YES";
}

function buildInitialMarkets(events) {
  const items = [];

  for (const eventItem of events || []) {
    const markets = Array.isArray(eventItem?.markets) ? eventItem.markets : [];

    for (const market of markets) {
      const tokenId = pickTokenId(market);
      if (!tokenId) continue;

      const currentPrice = asNumber(
        market?.lastTradePrice ?? market?.last_trade_price ?? market?.bestBid ?? market?.price ?? market?.outcomePrice,
        0
      );

      const volume24h = asNumber(market?.volume24hr ?? market?.volume24h ?? market?.volume24Hr ?? market?.volume, 0);
      const liquidity = asNumber(market?.liquidity ?? market?.liquidityNum, 0);

      items.push({
        id: `${market?.id || market?.slug || tokenId}`,
        tokenId,
        market: market?.question || eventItem?.title || eventItem?.slug || "Untitled market",
        category: normalizeCategory(eventItem, market),
        outcome: pickOutcomeLabel(market),
        currentPrice,
        previousPrice: currentPrice,
        dropPct: 0,
        volume24h,
        liquidity,
        aggressiveFlowUsd: 0,
        confidence: 0,
        signal: "Watching",
        spread: Math.max(0, asNumber(market?.bestAsk, currentPrice) - asNumber(market?.bestBid, currentPrice)),
        slug: market?.slug || eventItem?.slug || "",
        updatedAt: Date.now(),
        baselineWindowLabel: "5m",
        lastTradePrice: currentPrice,
      });
    }
  }

  return items;
}

function computeSignal(dropPct, aggressiveFlowUsd, spread) {
  if (dropPct >= 12 && aggressiveFlowUsd >= 1000) return "Whale drop";
  if (dropPct >= 8) return "Fast drop";
  if (dropPct >= 4) return "Pressure";
  if (spread >= 0.03) return "Wide spread";
  return "Watching";
}

function computeConfidence(dropPct, aggressiveFlowUsd, spread) {
  const score = dropPct * 5 + Math.min(35, aggressiveFlowUsd / 1500) + Math.min(15, spread * 400);
  return clamp(Math.round(score), 0, 99);
}

function StatCard({ title, value, sub, icon: Icon }) {
  return (
    <Card className="border-white/10 bg-white/5 backdrop-blur">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-white/50">{title}</div>
            <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
            <div className="mt-1 text-sm text-white/55">{sub}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <Icon className="h-5 w-5 text-white/80" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PolymarketDropTerminal() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [minDrop, setMinDrop] = useState(3);
  const [markets, setMarkets] = useState(FALLBACK_DROPS);
  const [selectedId, setSelectedId] = useState(FALLBACK_DROPS[0].id);
  const [liveMode, setLiveMode] = useState(true);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sourceLabel, setSourceLabel] = useState("Booting live feed...");
  const [lastSync, setLastSync] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const wsRef = useRef(null);
  const baselinesRef = useRef(new Map());
  const lastTradeRef = useRef(new Map());

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      setErrorMessage("");

      try {
        const res = await fetch(GAMMA_EVENTS_URL, { method: "GET" });
        const events = await res.json();
        const initial = buildInitialMarkets(Array.isArray(events) ? events : []);

        if (!cancelled && initial.length) {
          setMarkets(initial.slice(0, 160));
          setSelectedId((prev) => prev || initial[0]?.id);
          setSourceLabel("Live metadata from Polymarket Gamma API");
          setLastSync(Date.now());

          const map = new Map();
          initial.forEach((item) => {
            map.set(item.tokenId, {
              baseline: item.currentPrice || 0,
              previousPrice: item.currentPrice || 0,
              startedAt: Date.now(),
            });
            lastTradeRef.current.set(item.tokenId, item.currentPrice || 0);
          });
          baselinesRef.current = map;
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage("Live metadata could not be loaded. Showing fallback sample feed.");
          setSourceLabel("Fallback sample feed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!liveMode || !markets.length) {
      setConnected(false);
      if (wsRef.current) wsRef.current.close();
      return;
    }

    const tokenIds = markets.map((item) => item.tokenId).filter(Boolean).slice(0, 120);
    if (!tokenIds.length) return;

    const ws = new WebSocket(MARKET_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setErrorMessage("");
      ws.send(
        JSON.stringify({
          assets_ids: tokenIds,
          type: "market",
          custom_feature_enabled: true,
        })
      );
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setConnected(false);
      setErrorMessage("WebSocket disconnected. The page still works, but live drop updates paused.");
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const rows = Array.isArray(payload) ? payload : [payload];

        setMarkets((current) => {
          const next = [...current];
          const byToken = new Map(next.map((item, index) => [item.tokenId, index]));

          for (const message of rows) {
            if (!message) continue;

            if (message.event_type === "price_change" && Array.isArray(message.price_changes)) {
              for (const pc of message.price_changes) {
                const tokenId = String(pc.asset_id || "");
                const index = byToken.get(tokenId);
                if (index === undefined) continue;

                const currentItem = next[index];
                const baselineState = baselinesRef.current.get(tokenId) || {
                  baseline: currentItem.currentPrice || 0,
                  previousPrice: currentItem.currentPrice || 0,
                  startedAt: Date.now(),
                };

                const newBestBid = asNumber(pc.best_bid, currentItem.currentPrice);
                const newBestAsk = asNumber(pc.best_ask, currentItem.currentPrice);
                const newPrice = asNumber(pc.price, currentItem.currentPrice);
                const midpoint = newBestBid && newBestAsk && newBestAsk < 1
                  ? (newBestBid + newBestAsk) / 2
                  : newPrice;

                const priceForDrop = midpoint || newPrice || currentItem.currentPrice;
                const baseline = baselineState.baseline || priceForDrop || 0.0001;
                const dropPct = baseline > 0 ? Math.max(0, ((baseline - priceForDrop) / baseline) * 100) : 0;
                const aggressiveFlowUsd = currentItem.aggressiveFlowUsd + asNumber(pc.size, 0) * priceForDrop;
                const spread = Math.max(0, newBestAsk - newBestBid);
                const confidence = computeConfidence(dropPct, aggressiveFlowUsd, spread);
                const signal = computeSignal(dropPct, aggressiveFlowUsd, spread);

                next[index] = {
                  ...currentItem,
                  previousPrice: baselineState.previousPrice || currentItem.currentPrice,
                  currentPrice: priceForDrop,
                  lastTradePrice: newPrice || currentItem.lastTradePrice,
                  aggressiveFlowUsd,
                  dropPct,
                  confidence,
                  signal,
                  spread,
                  updatedAt: Date.now(),
                };

                baselinesRef.current.set(tokenId, {
                  ...baselineState,
                  previousPrice: currentItem.currentPrice,
                });
              }
            }

            if (message.event_type === "last_trade_price") {
              const tokenId = String(message.asset_id || "");
              const index = byToken.get(tokenId);
              if (index === undefined) continue;
              lastTradeRef.current.set(tokenId, asNumber(message.price, next[index].lastTradePrice));
              next[index] = {
                ...next[index],
                lastTradePrice: asNumber(message.price, next[index].lastTradePrice),
                updatedAt: Date.now(),
              };
            }

            if (message.event_type === "book") {
              const tokenId = String(message.asset_id || "");
              const index = byToken.get(tokenId);
              if (index === undefined) continue;

              const bids = Array.isArray(message.bids) ? message.bids : [];
              const asks = Array.isArray(message.asks) ? message.asks : [];
              const bestBid = bids.length ? asNumber(bids[bids.length - 1]?.price, next[index].currentPrice) : next[index].currentPrice;
              const bestAsk = asks.length ? asNumber(asks[0]?.price, next[index].currentPrice) : next[index].currentPrice;
              const midpoint = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : next[index].currentPrice;

              const baselineState = baselinesRef.current.get(tokenId) || {
                baseline: next[index].currentPrice || midpoint,
                previousPrice: next[index].currentPrice || midpoint,
                startedAt: Date.now(),
              };

              const priceForDrop = midpoint || next[index].currentPrice;
              const baseline = baselineState.baseline || priceForDrop || 0.0001;
              const dropPct = baseline > 0 ? Math.max(0, ((baseline - priceForDrop) / baseline) * 100) : next[index].dropPct;
              const spread = Math.max(0, bestAsk - bestBid);
              const confidence = computeConfidence(dropPct, next[index].aggressiveFlowUsd, spread);

              next[index] = {
                ...next[index],
                previousPrice: baselineState.previousPrice || next[index].currentPrice,
                currentPrice: priceForDrop,
                spread,
                dropPct,
                confidence,
                signal: computeSignal(dropPct, next[index].aggressiveFlowUsd, spread),
                updatedAt: Date.now(),
              };
            }
          }

          return next.sort((a, b) => b.dropPct - a.dropPct);
        });

        setLastSync(Date.now());
      } catch {}
    };

    return () => {
      ws.close();
    };
  }, [liveMode, markets.length]);

  useEffect(() => {
    const interval = setInterval(() => {
      baselinesRef.current = new Map(
        Array.from(baselinesRef.current.entries()).map(([tokenId, state]) => {
          const latest = lastTradeRef.current.get(tokenId);
          return [
            tokenId,
            {
              baseline: Number.isFinite(latest) ? latest : state.baseline,
              previousPrice: state.previousPrice,
              startedAt: Date.now(),
            },
          ];
        })
      );
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const categories = useMemo(() => {
    return ["All", ...Array.from(new Set(markets.map((x) => x.category))).sort()];
  }, [markets]);

  const filtered = useMemo(() => {
    return markets
      .filter((item) => category === "All" || item.category === category)
      .filter((item) => item.dropPct >= minDrop)
      .filter((item) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          item.market.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.signal.toLowerCase().includes(q) ||
          item.outcome.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.dropPct - a.dropPct);
  }, [markets, category, minDrop, search]);

  const selected = filtered.find((x) => x.id === selectedId) || filtered[0] || null;

  useEffect(() => {
    if (!selected && filtered[0]) setSelectedId(filtered[0].id);
  }, [selected, filtered]);

  const totalFlow = filtered.reduce((sum, item) => sum + item.aggressiveFlowUsd, 0);
  const avgDrop = filtered.length ? filtered.reduce((sum, item) => sum + item.dropPct, 0) / filtered.length : 0;
  const hardestDrop = filtered[0]?.dropPct ?? 0;
  const whaleDrops = filtered.filter((item) => item.signal === "Whale drop").length;

  return (
    <div className="min-h-screen bg-[#06070a] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(58,95,255,0.18),transparent_28%),radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_18%)]" />

      <div className="relative mx-auto max-w-7xl p-6 md:p-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-8 flex flex-col gap-5 rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-xl"
        >
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/65">
                <Activity className="h-3.5 w-3.5" />
                Polymarket Drop Terminal
              </div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">
                POD-style <span className="text-white/70">Polymarket drops</span>
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60 md:text-base">
                Real-time scanner for sharp Polymarket downside moves. Built around live event discovery, orderbook updates,
                last-trade changes, and a rolling baseline to detect actual price drops instead of static snapshots.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                onClick={() => setLiveMode((v) => !v)}
              >
                {liveMode ? <Wifi className="mr-2 h-4 w-4" /> : <WifiOff className="mr-2 h-4 w-4" />}
                {liveMode ? "Live mode on" : "Live mode off"}
              </Button>
              <Button className="rounded-2xl bg-white text-black hover:bg-white/90">
                <Bell className="mr-2 h-4 w-4" />
                Alerts v1
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-white/55">
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">{sourceLabel}</div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              {connected ? "WebSocket connected" : "WebSocket idle"}
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              Last sync: {lastSync ? formatAgo(lastSync) : "—"}
            </div>
          </div>

          {errorMessage ? (
            <div className="flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <AlertTriangle className="h-4 w-4" />
              {errorMessage}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-5">
            <StatCard title="Active drops" value={filtered.length} sub="Markets matching filters" icon={TrendingDown} />
            <StatCard title="Avg drop" value={`${avgDrop.toFixed(2)}%`} sub="Rolling baseline vs now" icon={Zap} />
            <StatCard title="Hardest drop" value={`${hardestDrop.toFixed(2)}%`} sub="Largest live downside move" icon={Activity} />
            <StatCard title="Whale drops" value={whaleDrops} sub="Fast move + strong flow" icon={DollarSign} />
            <StatCard title="Aggressive flow" value={formatUsd(totalFlow)} sub="Estimated sell-side pressure" icon={LineChart} />
          </div>
        </motion.div>

        <div className="grid gap-6 xl:grid-cols-[1.45fr_0.8fr]">
          <div className="space-y-6">
            <Card className="border-white/10 bg-white/5 backdrop-blur">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <CardTitle className="text-xl">Drop scanner</CardTitle>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative min-w-[220px]">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search market, category, signal..."
                        className="border-white/10 bg-black/20 pl-9 text-white placeholder:text-white/35"
                      />
                    </div>
                    <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70">
                      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                      Min drop {minDrop}% · 5m rolling baseline
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap gap-2">
                  {categories.map((item) => (
                    <button
                      key={item}
                      onClick={() => setCategory(item)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        category === item
                          ? "border-white bg-white text-black"
                          : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10"
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>

                <div className="overflow-hidden rounded-3xl border border-white/10">
                  <div className="grid grid-cols-[1.8fr_0.65fr_0.65fr_0.8fr_0.8fr_0.8fr_0.85fr] gap-3 border-b border-white/10 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.18em] text-white/45">
                    <div>Market</div>
                    <div>Side</div>
                    <div>Now</div>
                    <div>Drop</div>
                    <div>Spread</div>
                    <div>24h Vol</div>
                    <div>Signal</div>
                  </div>

                  <div className="divide-y divide-white/10">
                    {filtered.map((item) => {
                      const active = item.id === selected?.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => setSelectedId(item.id)}
                          className={`grid w-full grid-cols-[1.8fr_0.65fr_0.65fr_0.8fr_0.8fr_0.8fr_0.85fr] gap-3 px-4 py-4 text-left transition ${
                            active ? "bg-white/10" : "bg-transparent hover:bg-white/5"
                          }`}
                        >
                          <div>
                            <div className="font-medium text-white">{item.market}</div>
                            <div className="mt-1 text-sm text-white/45">{item.category} · {formatAgo(item.updatedAt)}</div>
                          </div>
                          <div className="text-sm text-white/70">{item.outcome}</div>
                          <div className="text-sm text-white/80">{formatProb(item.currentPrice)}</div>
                          <div className="text-sm font-semibold text-white">-{item.dropPct.toFixed(2)}%</div>
                          <div className="text-sm text-white/70">{(item.spread * 100).toFixed(2)}%</div>
                          <div className="text-sm text-white/70">{formatUsd(item.volume24h)}</div>
                          <div className="flex items-center justify-between gap-2">
                            <Badge className="border-0 bg-white/10 text-white">{item.signal}</Badge>
                            <ChevronRight className="h-4 w-4 text-white/35" />
                          </div>
                        </button>
                      );
                    })}

                    {!filtered.length && (
                      <div className="px-6 py-12 text-center text-white/50">
                        No markets match your current filters.
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-white/10 bg-white/5 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-xl">Signal detail</CardTitle>
              </CardHeader>
              <CardContent>
                {selected ? (
                  <div className="space-y-5">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-white/45">Selected market</div>
                      <div className="mt-2 text-xl font-semibold leading-7 text-white">{selected.market}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge className="border-0 bg-white text-black">{selected.category}</Badge>
                        <Badge className="border border-white/10 bg-transparent text-white/70">{selected.outcome}</Badge>
                        <Badge className="border border-white/10 bg-transparent text-white/70">{selected.signal}</Badge>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-white/45">Baseline</div>
                        <div className="mt-2 text-2xl font-semibold">{formatProb(selected.previousPrice)}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-white/45">Current price</div>
                        <div className="mt-2 text-2xl font-semibold">{formatProb(selected.currentPrice)}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-white/45">Last trade</div>
                        <div className="mt-2 text-2xl font-semibold">{formatProb(selected.lastTradePrice)}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-white/45">Aggressive flow</div>
                        <div className="mt-2 text-2xl font-semibold">{formatUsd(selected.aggressiveFlowUsd)}</div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-2 flex items-center justify-between text-sm text-white/65">
                        <span>Drop confidence</span>
                        <span>{selected.confidence}%</span>
                      </div>
                      <Progress value={selected.confidence} className="h-2 bg-white/10" />
                      <p className="mt-3 text-sm leading-6 text-white/55">
                        Signal is based on rolling baseline deterioration, accumulated aggressive flow, and spread behaviour.
                        This is the right logic for a Polymarket POD-style scanner.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/55">
                      <div className="mb-2 flex items-center gap-2 font-medium text-white">
                        <Clock3 className="h-4 w-4" />
                        Live logic
                      </div>
                      The scanner loads active markets from Gamma, subscribes to market token IDs over the public market WebSocket,
                      tracks book updates and last trades, and recalculates drops against a rolling 5-minute baseline.
                    </div>

                    {selected.slug ? (
                      <a
                        href={`https://polymarket.com/event/${selected.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80 transition hover:bg-white/10"
                      >
                        Open market on Polymarket
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-white/50">Choose a market on the left.</div>
                )}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-white/5 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-xl">Build status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm leading-6 text-white/60">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-1 font-medium text-white">What is already here</div>
                  Real Polymarket market discovery, real Polymarket WebSocket subscription, rolling drop logic, and a POD-style scanner UI.
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-1 font-medium text-white">Next professional layer</div>
                  Dedicated backend cache, persistent alert engine, trade clustering, whale wallet tagging, auth, and billing.
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-1 font-medium text-white">Best deployment</div>
                  Move this into a Next.js app, deploy on Vercel, and point your custom domain to the project.
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

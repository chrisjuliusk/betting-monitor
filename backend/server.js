import express from "express";
import cors from "cors";
import { state } from "./services/state.js";
import { loadMarkets } from "./services/markets.js";
import { loadTimeline } from "./services/trades.js";
import { startMarketStream } from "./services/stream.js";
import { profileHref } from "./services/profiles.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Betting Monitor Backend Running");
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    markets: state.markets.size,
    wallets: state.wallets.size,
    lastSync: state.lastSync
  });
});

app.get("/api/markets", async (req, res) => {
  try {
    const windowMinutes = Math.max(1, Number(req.query.window || 60));
    const minDrop = Math.max(0, Number(req.query.minDrop || 0));
    const mode = req.query.mode === "open" ? "open" : "window";

    await loadMarkets({ windowMinutes });

    let rows = [...state.markets.values()].map((row) => ({
      ...row,
      dropPct: mode === "open" ? row.dropPctOpen : row.dropPctWindow
    }));

    if (minDrop > 0) {
      rows = rows.filter((row) => row.dropPct >= minDrop);
    }

    const sort = req.query.sort || "drop";

    if (sort === "drop") rows.sort((a, b) => b.dropPct - a.dropPct);
    if (sort === "recent") rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (sort === "flow") rows.sort((a, b) => (b.aggressiveFlowUsd || 0) - (a.aggressiveFlowUsd || 0));
    if (sort === "wallet") rows.sort((a, b) => (b.smartWalletScore || 0) - (a.smartWalletScore || 0));
    if (sort === "volume") rows.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));

    res.json(rows);
  } catch (error) {
    console.error("GET /api/markets failed:", error);
    res.status(500).json({ ok: false, error: "markets_failed" });
  }
});

app.get("/api/timeline/:conditionId", async (req, res) => {
  try {
    const { conditionId } = req.params;
    const result = await loadTimeline(conditionId);

    const timeline = (result.timeline || []).map((row) => {
      const walletObj = state.wallets.get(row.wallet);
      return {
        ...row,
        walletLabel: walletObj?.nickname || row.wallet,
        profileUrl: walletObj
          ? profileHref(walletObj)
          : (row.wallet ? `https://polymarket.com/profile/${row.wallet}` : "#")
      };
    });

    res.json({
      timeline,
      topWallet: result.topWallet || ""
    });
  } catch (error) {
    console.error("GET /api/timeline failed:", error);
    res.status(500).json({ ok: false, error: "timeline_failed" });
  }
});

app.get("/api/wallets", (_req, res) => {
  try {
    const rows = [...state.wallets.values()].map((w) => ({
      ...w,
      profileUrl: profileHref(w)
    }));

    rows.sort((a, b) => (b.score + b.activity * 2) - (a.score + a.activity * 2));

    res.json(rows.slice(0, 100));
  } catch (error) {
    console.error("GET /api/wallets failed:", error);
    res.status(500).json({ ok: false, error: "wallets_failed" });
  }
});

const port = Number(process.env.PORT) || 10000;

app.listen(port, "0.0.0.0", () => {
  console.log(`Betting Monitor backend listening on port ${port}`);
});

(async () => {
  try {
    await loadMarkets({ windowMinutes: 60 });
    startMarketStream();
    console.log("Initial market load complete");
  } catch (error) {
    console.error("Background init failed:", error);
  }
})();

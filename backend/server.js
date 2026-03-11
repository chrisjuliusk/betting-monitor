import express from "express";
import cors from "cors";
import { state } from "./services/state.js";
import { startMarketStream } from "./services/stream.js";
import { getTimelineForCondition } from "./services/trades.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    markets: state.markets.size,
    wallets: state.wallets.size,
    lastSync: state.lastSync
  });
});

app.get("/api/markets", (_req, res) => {
  res.json(Array.from(state.markets.values()));
});

app.get("/api/wallets", (_req, res) => {
  res.json(Array.from(state.wallets.values()));
});

app.get("/api/timeline/:conditionId", async (req, res) => {
  try {
    const data = await getTimelineForCondition(req.params.conditionId);
    res.json(data);
  } catch (err) {
    console.error("timeline error:", err.message);
    res.json({
      timeline: [],
      topWallet: "",
      topWalletName: ""
    });
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, async () => {
  console.log(`Backend listening on ${PORT}`);
  await startMarketStream();
});

import express from 'express';
import cors from 'cors';
import { state } from './services/state.js';
import { startMarketStream } from './services/stream.js';
import { getTimelineForCondition } from './services/trades.js';

const app = express();
app.use(cors());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, markets: state.markets.size, wallets: state.wallets.size, lastSync: state.lastSync });
});

app.get('/api/markets', (_req, res) => {
  res.json(Array.from(state.markets.values()));
});

app.get('/api/wallets', (_req, res) => {
  res.json(Array.from(state.wallets.values()));
});

app.get('/api/timeline/:conditionId', async (req, res) => {
  try {
    const data = await getTimelineForCondition(req.params.conditionId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ timeline: [], topWallet: null, error: 'timeline failed' });
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, async () => {
  await startMarketStream();
  console.log(`Backend listening on ${PORT}`);
});

import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { buildFeed, buildMarketDetails } from './services/feed.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const cache = new Map();
const TTL_MS = 20_000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'polymarket-pod-monitor', ts: Date.now() });
});

app.get('/api/markets', async (req, res) => {
  const window = String(req.query.window || '60m');
  const limit = Number(req.query.limit || 200);
  const key = `feed:${window}:${limit}`;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return res.json({ cached: true, count: cached.data.length, data: cached.data });
  }

  try {
    const data = await buildFeed({ window, limit });
    cache.set(key, { ts: Date.now(), data });
    return res.json({ cached: false, count: data.length, data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/:conditionId/details', async (req, res) => {
  const { conditionId } = req.params;
  const tokenId = String(req.query.tokenId || '');

  if (!tokenId) {
    return res.status(400).json({ error: 'tokenId query parameter is required' });
  }

  const key = `details:${conditionId}:${tokenId}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return res.json({ cached: true, ...cached.data });
  }

  try {
    const data = await buildMarketDetails(conditionId, tokenId);
    cache.set(key, { ts: Date.now(), data });
    return res.json({ cached: false, ...data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`polymarket-pod-monitor backend listening on ${port}`);
});

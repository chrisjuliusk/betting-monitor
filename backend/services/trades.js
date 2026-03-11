import { state, upsertWallet } from "./state.js";
import { enrichWallet } from "./profiles.js";

export async function loadTimeline(conditionId) {
  if (!conditionId) {
    return { timeline: [], topWallet: "" };
  }

  const url = `https://data-api.polymarket.com/trades?market=${encodeURIComponent(conditionId)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Trades failed with ${response.status}`);
  }

  const rows = await response.json();

  const market = [...state.markets.values()].find((m) => m.conditionId === conditionId);
  const fair = market?.fairPrice ?? 0.5;

  const timeline = [];
  const walletTotals = new Map();

  for (const t of rows.slice(0, 100)) {
    const wallet = t.proxyWallet || t.wallet || "";
    const price = Number(t.price || 0);
    const size = Number(t.size || 0);
    const sizeUsd = size * Math.max(price, 1);

    if (wallet) {
      const current = state.wallets.get(wallet);
      upsertWallet(wallet, {
        activity: (current?.activity || 0) + 1,
        score: (current?.score || 50) + 1
      });
      await enrichWallet(wallet);
      walletTotals.set(wallet, (walletTotals.get(wallet) || 0) + sizeUsd);
    }

    timeline.push({
      time: Number(t.timestamp || Date.now()),
      fair,
      price,
      size: sizeUsd,
      wallet
    });
  }

  timeline.sort((a, b) => b.time - a.time);

  const topWalletEntry = [...walletTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const topWallet = topWalletEntry ? topWalletEntry[0] : "";

  if (market && topWallet) {
    market.primaryWallet = topWallet;
    market.primaryWalletName = `${topWallet.slice(0, 6)}...${topWallet.slice(-4)}`;
  }

  return { timeline, topWallet };
}

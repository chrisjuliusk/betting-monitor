import { state, upsertWallet } from "./state.js";
import { walletNickname, walletProfileUrl } from "./profiles.js";

function asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function getTimelineForCondition(conditionId) {
  const market = Array.from(state.markets.values()).find(
    x => x.conditionId === conditionId
  );

  if (!market) {
    return {
      timeline: [],
      topWallet: "",
      topWalletName: ""
    };
  }

  const chart = Array.isArray(market.chart) ? market.chart : [];
  const timeline = chart.slice(-50).map(point => ({
    time: point.ts,
    fair: market.fairPrice,
    price: point.price,
    size: 0,
    wallet: "",
    walletLabel: "",
    profileUrl: ""
  }));

  return {
    timeline,
    topWallet: market.primaryWallet || "",
    topWalletName: market.primaryWalletName || ""
  };
}

export function registerWalletActivity(wallet, patch = {}) {
  if (!wallet) return null;

  return upsertWallet(wallet, {
    nickname: patch.nickname || walletNickname(wallet),
    profileUrl: patch.profileUrl || walletProfileUrl(wallet),
    activity: asNumber(patch.activity, 0),
    score: asNumber(patch.score, 50),
    pnlEdge: asNumber(patch.pnlEdge, 0)
  });
}

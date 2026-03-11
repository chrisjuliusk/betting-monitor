export const state = {
  markets: new Map(),
  wallets: new Map(),
  priceHistory: new Map(),
  marketBaselines: new Map(),
  lastSync: null
};

export function upsertWallet(wallet, patch = {}) {
  if (!wallet) return null;

  const current = state.wallets.get(wallet) || {
    wallet,
    nickname: `${wallet.slice(0, 6)}...${wallet.slice(-4)}`,
    activity: 0,
    score: 50,
    pnlEdge: 0
  };

  const next = { ...current, ...patch };
  state.wallets.set(wallet, next);
  return next;
}

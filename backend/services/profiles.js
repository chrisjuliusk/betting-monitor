import { upsertWallet } from "./state.js";

export function profileHref(walletObj) {
  if (!walletObj || !walletObj.wallet) return "#";
  return `https://polymarket.com/profile/${walletObj.wallet}`;
}

export async function enrichWallet(wallet) {
  if (!wallet) return null;

  return upsertWallet(wallet, {
    nickname: `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
  });
}

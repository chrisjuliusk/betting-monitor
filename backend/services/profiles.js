export function walletProfileUrl(wallet) {
  if (!wallet) return "";
  return `https://polymarket.com/profile/${wallet}`;
}

export function walletNickname(wallet) {
  if (!wallet) return "";
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

export function profileHref(wallet) {
  if (!wallet || !wallet.wallet) {
    return "#";
  }
  return `https://polymarket.com/profile/${wallet.wallet}`;
}

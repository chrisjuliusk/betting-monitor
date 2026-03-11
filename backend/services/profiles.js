export function profileHref(wallet) {
  if (!wallet) return '';
  return `https://polymarket.com/profile/${wallet}`;
}

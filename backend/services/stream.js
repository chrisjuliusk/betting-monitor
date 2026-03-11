import { refreshMarkets } from "./markets.js";

let started = false;

export async function startMarketStream() {
  if (started) return;
  started = true;

  try {
    await refreshMarkets();
    console.log("Initial market refresh complete");
  } catch (err) {
    console.error("Initial refresh failed:", err.message);
  }

  setInterval(async () => {
    try {
      await refreshMarkets();
      console.log("Market refresh ok");
    } catch (err) {
      console.error("Market refresh failed:", err.message);
    }
  }, 30000);
}

// Live spot gold (USD per gram) from livepriceofgold.com.
// Primary: real-time socket.io stream (per-second ticks). Fallback: parse the
// server-rendered HTML on cold start before the first stream tick arrives.

import { ensureGoldSocket, getGoldSocketPrice } from "./goldSocket";

let htmlCache: { price: number; expires: number } | null = null;

export async function getGoldSpotPerGram(): Promise<number | null> {
  ensureGoldSocket();
  const live = getGoldSocketPrice();
  if (live != null) return live;

  // Cold start: scrape the HTML once until the stream warms up.
  if (htmlCache && htmlCache.expires > Date.now()) return htmlCache.price;
  try {
    const res = await fetch("https://livepriceofgold.com/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) throw new Error(`livepriceofgold ${res.status}`);
    const html = await res.text();
    const m = html.match(/data-price="GXAUUSD"[^>]*>([\d.,]+)</);
    if (!m) throw new Error("GXAUUSD not found");
    const price = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(price) || price <= 0) throw new Error("bad price");
    htmlCache = { price, expires: Date.now() + 5000 };
    return price;
  } catch {
    return htmlCache?.price ?? null;
  }
}

import { NextResponse } from "next/server";
import { tvPrices } from "@/lib/sources/tvQuote";
import { getGoldSpotPerGram } from "@/lib/sources/goldSpot";
import { getNiftyData } from "@/lib/instruments/nifty";
import { getSensexData } from "@/lib/instruments/sensex";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Token-guarded batch price feed for the 24/7 monitor (monitor.php on the PHP
// host). Accepts a comma-separated `keys` list mixing paper instruments
// (gold|nifty|sensex) and TradingView symbols (EXCHANGE:TICKER). This is the
// single source of truth for prices, shared with the on-screen UI.
const PAPER = new Set(["gold", "nifty", "sensex"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const expected = process.env.MONITOR_TOKEN ?? "";
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const keys = (url.searchParams.get("keys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const prices: Record<string, number | null> = {};

  const paperKeys = keys.filter((k) => PAPER.has(k));
  const symKeys = keys.filter((k) => !PAPER.has(k));

  await Promise.all(
    paperKeys.map(async (k) => {
      try {
        if (k === "gold") prices[k] = await getGoldSpotPerGram();
        else if (k === "sensex") prices[k] = (await getSensexData()).index?.value ?? null;
        else prices[k] = (await getNiftyData()).index?.value ?? null;
      } catch {
        prices[k] = null;
      }
    }),
  );

  if (symKeys.length) {
    const m = await tvPrices(symKeys);
    for (const k of symKeys) prices[k] = m.get(k) ?? null;
  }

  return NextResponse.json({ prices });
}

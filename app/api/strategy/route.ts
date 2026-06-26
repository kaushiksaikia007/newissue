import { NextRequest, NextResponse } from "next/server";
import { buildStrategy, type Horizon } from "@/lib/strategy";

export const dynamic = "force-dynamic";

interface Cache {
  data: unknown;
  expires: number;
}
const cache = new Map<string, Cache>();

function cacheMs(): number {
  const s = Number(process.env.SIGNAL_CACHE_SECONDS ?? 60);
  return (Number.isFinite(s) && s > 0 ? s : 60) * 1000;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const horizon = (["intraday", "short", "long"].includes(sp.get("horizon") ?? "")
    ? sp.get("horizon")
    : "short") as Horizon;
  let profit = Number(sp.get("profit") ?? 1.5);
  if (!Number.isFinite(profit) || profit <= 0) profit = 1.5;
  profit = Math.min(profit, 50);

  const fresh = sp.get("fresh") === "1";
  const key = `${horizon}:${profit}`;
  const hit = cache.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return NextResponse.json(hit.data);

  const data = await buildStrategy("gold", horizon, profit);
  cache.set(key, { data, expires: Date.now() + cacheMs() });
  return NextResponse.json(data);
}

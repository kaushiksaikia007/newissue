import { NextResponse } from "next/server";
import { getMetrics } from "@/lib/macro";
import { getNews } from "@/lib/sources/news";
import { analyzeGold } from "@/lib/brain";
import { allMockMetrics } from "@/lib/fred";
import {
  attachGeoValue,
  attachGoldValues,
  buildGoldSignals,
} from "@/lib/analysis";
import type { SignalResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Cache {
  data: SignalResponse;
  expires: number;
}
let cache: Cache | null = null;

function cacheMs(): number {
  const s = Number(process.env.SIGNAL_CACHE_SECONDS ?? 60);
  return (Number.isFinite(s) && s > 0 ? s : 60) * 1000;
}

// The OpenAI recommendation — analysed on demand. `?fresh=1` forces a brand-new
// analysis; otherwise a recent cached result (<= SIGNAL_CACHE_SECONDS) is reused.
export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (!fresh && cache && cache.expires > Date.now()) {
    return NextResponse.json(cache.data);
  }

  let data: SignalResponse;
  try {
    const [{ metrics, gold }, news] = await Promise.all([
      getMetrics(),
      getNews(),
    ]);
    data = {
      signals: attachGeoValue(
        attachGoldValues(await analyzeGold(metrics, gold, news), metrics),
        news,
      ),
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    const metrics = allMockMetrics().filter((m) => m.id !== "gold");
    data = {
      signals: attachGeoValue(
        attachGoldValues(buildGoldSignals(metrics, []), metrics),
        [],
      ),
      fetchedAt: new Date().toISOString(),
    };
  }

  cache = { data, expires: Date.now() + cacheMs() };
  return NextResponse.json(data);
}

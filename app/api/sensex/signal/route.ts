import { NextResponse } from "next/server";
import { getSensexData, allSensexMock } from "@/lib/instruments/sensex";
import { getNiftyNews } from "@/lib/sources/news";
import { analyzeSensex } from "@/lib/brain";
import {
  applyNiftyOverrides,
  attachGeoValue,
  attachNiftyValues,
  buildNiftySignals,
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

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (!fresh && cache && cache.expires > Date.now()) {
    return NextResponse.json(cache.data);
  }

  let data: SignalResponse;
  try {
    const [{ metrics, index }, news] = await Promise.all([
      getSensexData(),
      getNiftyNews(),
    ]);
    let signals = await analyzeSensex(metrics, index, news);
    // Deterministic breadth (% > 50-EMA) + momentum (RSI-14), then recompute.
    signals = applyNiftyOverrides(signals, [...metrics, index]);
    signals = attachNiftyValues(signals, [...metrics, index]);
    signals = attachGeoValue(signals, news);
    data = { signals, fetchedAt: new Date().toISOString() };
  } catch {
    const { metrics, index } = allSensexMock();
    data = {
      signals: attachGeoValue(
        attachNiftyValues(buildNiftySignals(metrics, []), [...metrics, index]),
        [],
      ),
      fetchedAt: new Date().toISOString(),
    };
  }

  cache = { data, expires: Date.now() + cacheMs() };
  return NextResponse.json(data);
}

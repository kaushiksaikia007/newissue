import {
  allMockMetrics,
  fredMetric,
  makeMetric,
  mockMetric,
  SERIES,
} from "./fred";
import { tradingviewBatch } from "./sources/tradingview";
import { getGoldSpotPerGram } from "./sources/goldSpot";
import { blsMetrics } from "./sources/bls";
import type { Metric } from "./types";

export interface MetricsBundle {
  metrics: Metric[];
  gold: Metric;
  usingMockData: boolean;
}

// --- Caching tiers ------------------------------------------------------
// Market data (TradingView) is refreshed ~every second; the monthly BLS/FRED
// series (CPI, NFP) are fetched rarely to respect their daily rate limits.

let fastCache: { data: MetricsBundle; expires: number } | null = null;
let lastGood: MetricsBundle | null = null;

let slowCache: { cpi: Metric; nfp: Metric; expires: number } | null = null;

const SLOW_OK_TTL = 6 * 60 * 60_000; // 6h when data is good
const SLOW_RETRY_TTL = 5 * 60_000; // 5m to retry after a failure

function fastTtlMs(): number {
  const ms = Number(process.env.VALUES_CACHE_MS ?? 1000);
  return Number.isFinite(ms) && ms >= 0 ? ms : 1000;
}

/**
 * Live metric bundle. Market data is at most `VALUES_CACHE_MS` old (default
 * 1s); CPI/NFP come from a long-lived cache. Falls back to the last good
 * snapshot if a whole pull fails, so the UI never flickers to demo data.
 */
export async function getMetrics(): Promise<MetricsBundle> {
  if (fastCache && fastCache.expires > Date.now()) return fastCache.data;

  const fresh = await fetchBundle();
  const data = fresh.usingMockData && lastGood ? lastGood : fresh;
  if (!fresh.usingMockData) lastGood = fresh;

  fastCache = { data, expires: Date.now() + fastTtlMs() };
  return data;
}

async function fetchBundle(): Promise<MetricsBundle> {
  // Per-second market data: one TradingView batch request (primary), with a
  // per-metric fallback to FRED if TradingView is down or omits a symbol.
  const marketKeys = ["dxy", "us10y", "vix", "fed", "gold"];
  let tv: Record<string, Metric> = {};
  try {
    tv = await tradingviewBatch();
  } catch {
    tv = {};
  }
  const market = await Promise.all(
    marketKeys.map((k) => (tv[k] ? Promise.resolve(tv[k]) : resolveFallback(k))),
  );

  // Monthly economic data (cached long-term).
  const { cpi, nfp } = await getSlowMetrics();

  const byKey: Record<string, Metric> = {};
  for (const m of [...market, cpi, nfp]) byKey[m.id] = m;

  // Spot gold price: prefer the per-second feed from livepriceofgold.com,
  // keeping TradingView's prior close for the day's change.
  try {
    const spot = await getGoldSpotPerGram();
    if (spot != null) {
      const prev = byKey.gold ? byKey.gold.previous : null;
      const asOf = byKey.gold
        ? byKey.gold.asOf
        : new Date().toISOString().slice(0, 10);
      byKey.gold = makeMetric("gold", spot, prev, asOf, "livepriceofgold.com");
    }
  } catch {
    /* keep TradingView gold */
  }

  const order = ["dxy", "us10y", "fed", "cpi", "nfp", "vix"];
  const metrics = order.map((k) => byKey[k] ?? mockMetric(k));
  const gold = byKey.gold ?? mockMetric("gold");
  const usingMockData = [...metrics, gold].every((m) => m.mock);
  return { metrics, gold, usingMockData };
}

/** CPI + NFP — cached 6h (5m on failure) to stay within BLS/FRED limits. */
async function getSlowMetrics(): Promise<{ cpi: Metric; nfp: Metric }> {
  if (slowCache && slowCache.expires > Date.now()) {
    return { cpi: slowCache.cpi, nfp: slowCache.nfp };
  }

  let bls: Record<string, Metric> = {};
  try {
    bls = await blsMetrics();
  } catch {
    bls = {};
  }
  const cpi = bls.cpi ?? (await resolveFallback("cpi"));
  const nfp = bls.nfp ?? (await resolveFallback("nfp"));

  const ok = !cpi.mock && !nfp.mock;
  slowCache = {
    cpi,
    nfp,
    expires: Date.now() + (ok ? SLOW_OK_TTL : SLOW_RETRY_TTL),
  };
  return { cpi, nfp };
}

/** Fallback when TradingView omits a series: FRED, then demo data. */
async function resolveFallback(key: string): Promise<Metric> {
  try {
    if (SERIES[key]) return await fredMetric(key);
  } catch {
    /* fall through */
  }
  return mockMetric(key);
}

export { allMockMetrics };

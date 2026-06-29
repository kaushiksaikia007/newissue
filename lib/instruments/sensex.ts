import { buildMetric, type MetricMeta } from "../fred";
import { tradingviewScanCols } from "../sources/tradingview";
import { ensureSubscribed, getQuote } from "../sources/tvSocket";
import {
  getNiftyData,
  allNiftyMock,
  type NiftyBundle,
  type Breadth,
  type NiftyTechnicals,
} from "./nifty";
import type { Metric } from "../types";

// BSE SENSEX mirrors the Nifty 50 dashboard exactly — same India macro
// indicators — but the index itself, market breadth and RSI are computed for
// the SENSEX 30 instead. The index metric deliberately reuses the id "nifty"
// so it flows through the shared Nifty-style analysis/strategy pipeline
// unchanged; only its value/label are SENSEX.
const INDEX_TICKER = "BSE:SENSEX";

// Sectoral indices for rotation analysis. The REST scanner doesn't carry the
// Auto/FMCG/Pharma/Metal indices, so these are streamed via the TradingView
// socket — warmed here on every Sensex poll so they're ready for the
// institutional-intelligence engine. NIFTY is the benchmark to outperform.
export const SENSEX_BENCH = "NSE:NIFTY";
export const SENSEX_SECTORS: { key: string; label: string; ticker: string }[] = [
  { key: "bank", label: "Bank Nifty", ticker: "NSE:BANKNIFTY" },
  { key: "it", label: "Nifty IT", ticker: "NSE:CNXIT" },
  { key: "auto", label: "Nifty Auto", ticker: "NSE:CNXAUTO" },
  { key: "fmcg", label: "Nifty FMCG", ticker: "NSE:CNXFMCG" },
  { key: "pharma", label: "Nifty Pharma", ticker: "NSE:CNXPHARMA" },
  { key: "metal", label: "Nifty Metal", ticker: "NSE:CNXMETAL" },
];

const INDEX_META: MetricMeta = {
  id: "nifty",
  label: "BSE Sensex",
  unit: "pts",
  description: "BSE SENSEX 30 index level.",
};
const BREADTH_META: MetricMeta = {
  id: "breadth",
  label: "Market Breadth",
  unit: "%",
  description: "% of SENSEX 30 stocks trading above their 50-day EMA.",
};
const RSI_META: MetricMeta = {
  id: "rsi",
  label: "Sensex RSI (14)",
  unit: "rsi",
  description: "14-period RSI of the BSE SENSEX index.",
};

// SENSEX 30 constituents (quoted on NSE for the india screener — same companies,
// breadth is just % above 50-EMA so the venue is immaterial).
const CONSTITUENTS = [
  "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "HINDUNILVR", "ITC",
  "SBIN", "BHARTIARTL", "BAJFINANCE", "KOTAKBANK", "LT", "HCLTECH", "AXISBANK",
  "MARUTI", "ASIANPAINT", "SUNPHARMA", "TITAN", "ULTRACEMCO", "NESTLEIND",
  "NTPC", "POWERGRID", "TATASTEEL", "TMPV", "M&M", "BAJAJFINSV", "TECHM",
  "ADANIPORTS", "INDUSINDBK", "JSWSTEEL",
];

const MOCK_INDEX: [number, number] = [78500, 78900];
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

let fastCache: { data: NiftyBundle; expires: number } | null = null;
let lastGood: NiftyBundle | null = null;

function ttlMs(): number {
  const ms = Number(process.env.VALUES_CACHE_MS ?? 1000);
  return Number.isFinite(ms) && ms >= 0 ? ms : 1000;
}

/** Live SENSEX bundle, refreshed ~every second (TradingView). */
export async function getSensexData(): Promise<NiftyBundle> {
  if (fastCache && fastCache.expires > Date.now()) return fastCache.data;
  const fresh = await fetchSensex();
  const data = fresh.usingMockData && lastGood ? lastGood : fresh;
  if (!fresh.usingMockData) lastGood = fresh;
  fastCache = { data, expires: Date.now() + ttlMs() };
  return data;
}

async function fetchSensex(): Promise<NiftyBundle> {
  // Reuse the shared India macro cards (Bank Nifty, India VIX, USD/INR, repo,
  // yields, inflation) exactly as the Nifty dashboard computes them.
  const base = await getNiftyData();
  const asOf = new Date().toISOString().slice(0, 10);

  // --- SENSEX index (real-time stream, REST snapshot fallback) ---
  // Also keep the sector indices + benchmark warm for the intel engine.
  ensureSubscribed([
    INDEX_TICKER,
    SENSEX_BENCH,
    ...SENSEX_SECTORS.map((s) => s.ticker),
  ]);
  let index: Metric | null = null;
  const q = getQuote(INDEX_TICKER);
  if (q) {
    index = buildMetric(INDEX_META, q.price, q.price - q.change, asOf, "TradingView");
  } else {
    try {
      const rows = await tradingviewScanCols(
        [INDEX_TICKER],
        ["close", "change_abs"],
        "india",
      );
      const d = rows.get(INDEX_TICKER);
      if (d && typeof d[0] === "number") {
        const close = d[0];
        const ch = typeof d[1] === "number" ? d[1] : 0;
        index = buildMetric(INDEX_META, close, close - ch, asOf, "TradingView");
      }
    } catch {
      /* fall through to mock */
    }
  }
  if (!index) {
    index = buildMetric(INDEX_META, MOCK_INDEX[0], MOCK_INDEX[1], asOf, "Demo data", true);
  }

  // --- SENSEX-specific breadth + RSI (override the Nifty cards) ---
  const [b, rsi] = await Promise.all([getSensexBreadth(), getSensexRsi()]);
  const breadthM = b
    ? buildMetric(BREADTH_META, r1(b.pct), null, asOf, `TradingView (${b.above}/${b.total} stocks)`)
    : base.metrics.find((m) => m.id === "breadth")!;
  const rsiM =
    rsi != null
      ? buildMetric(RSI_META, r2(rsi), null, asOf, "TradingView")
      : { ...base.metrics.find((m) => m.id === "rsi")!, label: RSI_META.label };

  const metrics = base.metrics.map((m) =>
    m.id === "breadth" ? breadthM : m.id === "rsi" ? rsiM : m,
  );

  const usingMockData = base.usingMockData && index.mock;
  return { metrics, index, usingMockData };
}

/** Mock bundle: Nifty mock cards + a SENSEX-shaped mock index. */
export function allSensexMock(): NiftyBundle {
  const { metrics } = allNiftyMock();
  const asOf = new Date().toISOString().slice(0, 10);
  const index = buildMetric(INDEX_META, MOCK_INDEX[0], MOCK_INDEX[1], asOf, "Demo data", true);
  // Relabel the RSI card so it reads "Sensex" even in demo mode.
  const m2 = metrics.map((m) => (m.id === "rsi" ? { ...m, label: RSI_META.label } : m));
  return { metrics: m2, index, usingMockData: true };
}

let breadthCache: { b: Breadth; expires: number } | null = null;

/** % of SENSEX 30 constituents trading above their 50-day EMA. Cached 60s. */
export async function getSensexBreadth(): Promise<Breadth | null> {
  if (breadthCache && breadthCache.expires > Date.now()) return breadthCache.b;
  try {
    const rows = await tradingviewScanCols(
      CONSTITUENTS.map((s) => `NSE:${s}`),
      ["close", "EMA50"],
      "india",
    );
    let above = 0;
    let total = 0;
    for (const d of rows.values()) {
      const close = d[0];
      const ema = d[1];
      if (typeof close === "number" && typeof ema === "number" && ema > 0) {
        total++;
        if (close > ema) above++;
      }
    }
    if (total < 22) throw new Error("too few constituents resolved");
    const b: Breadth = { pct: (above / total) * 100, above, total };
    breadthCache = { b, expires: Date.now() + 60_000 };
    return b;
  } catch {
    return breadthCache?.b ?? null;
  }
}

let rsiCache: { rsi: number; expires: number } | null = null;

/** 14-period RSI of the BSE SENSEX index from TradingView. Cached 60s. */
export async function getSensexRsi(): Promise<number | null> {
  if (rsiCache && rsiCache.expires > Date.now()) return rsiCache.rsi;
  try {
    const rows = await tradingviewScanCols([INDEX_TICKER], ["RSI"], "india");
    const d = rows.get(INDEX_TICKER);
    const rsi = d?.[0];
    if (typeof rsi !== "number") throw new Error("no RSI");
    rsiCache = { rsi, expires: Date.now() + 60_000 };
    return rsi;
  } catch {
    return rsiCache?.rsi ?? null;
  }
}

let techCache: { t: NiftyTechnicals; expires: number } | null = null;

/** Full technical snapshot of the SENSEX index for strategy generation. */
export async function getSensexTechnicals(): Promise<NiftyTechnicals | null> {
  if (techCache && techCache.expires > Date.now()) return techCache.t;
  const cols = [
    "close", "EMA20", "EMA50", "EMA200", "RSI", "MACD.macd", "MACD.signal",
    "ADX", "ATR", "Pivot.M.Classic.S1", "Pivot.M.Classic.R1",
    "Pivot.M.Classic.S2", "Pivot.M.Classic.R2", "High.1M", "Low.1M",
  ];
  try {
    const rows = await tradingviewScanCols([INDEX_TICKER], cols, "india");
    const d = rows.get(INDEX_TICKER);
    if (!d || typeof d[0] !== "number") throw new Error("no technicals");
    const n = (i: number) => (typeof d[i] === "number" ? (d[i] as number) : NaN);
    const t: NiftyTechnicals = {
      cmp: n(0), ema20: n(1), ema50: n(2), ema200: n(3), rsi: n(4),
      macd: n(5), macdSignal: n(6), adx: n(7), atr: n(8),
      s1: n(9), r1: n(10), s2: n(11), r2: n(12), high1m: n(13), low1m: n(14),
    };
    if (Number.isNaN(t.cmp) || Number.isNaN(t.atr)) throw new Error("bad data");
    techCache = { t, expires: Date.now() + 30_000 };
    return t;
  } catch {
    return techCache?.t ?? null;
  }
}

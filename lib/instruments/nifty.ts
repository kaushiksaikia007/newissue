import { buildMetric, type MetricMeta } from "../fred";
import { tradingviewScan, tradingviewScanCols } from "../sources/tradingview";
import { ensureSubscribed, getQuote } from "../sources/tvSocket";
import type { Metric } from "../types";

interface NiftyMeta extends MetricMeta {
  ticker?: string;
}

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

// Live indicators for the Nifty 50 dashboard (TradingView primary).
const META: Record<string, NiftyMeta> = {
  nifty: {
    id: "nifty",
    label: "Nifty 50",
    unit: "pts",
    description: "NSE Nifty 50 index level.",
    ticker: "NSE:NIFTY",
  },
  banknifty: {
    id: "banknifty",
    label: "Bank Nifty",
    unit: "pts",
    description: "NSE Bank Nifty — heavyweight financials / breadth proxy.",
    ticker: "NSE:BANKNIFTY",
  },
  indiavix: {
    id: "indiavix",
    label: "India VIX",
    unit: "index",
    description: "NSE India VIX — volatility / risk gauge.",
    ticker: "NSE:INDIAVIX",
  },
  usdinr: {
    id: "usdinr",
    label: "USD / INR",
    unit: "fx",
    description: "Indian rupee per US dollar — FII flow proxy.",
    ticker: "FX_IDC:USDINR",
  },
  in10y: {
    id: "in10y",
    label: "India 10Y Yield",
    unit: "%",
    description: "India 10-year government bond yield — RBI stance.",
    ticker: "TVC:IN10Y",
  },
  us10y: {
    id: "us10y",
    label: "US 10Y Yield",
    unit: "%",
    description: "US 10-year Treasury yield — global rates / Fed.",
    ticker: "TVC:US10Y",
  },
  repo: {
    id: "repo",
    label: "RBI Repo Rate",
    unit: "%",
    description: "RBI policy repo rate.",
    ticker: "ECONOMICS:ININTR",
  },
  inflation: {
    id: "inflation",
    label: "India CPI (YoY)",
    unit: "%",
    description: "India consumer price inflation rate, year-on-year.",
    ticker: "ECONOMICS:INIRYY",
  },
  breadth: {
    id: "breadth",
    label: "Market Breadth",
    unit: "%",
    description: "% of Nifty 50 stocks trading above their 50-day EMA.",
  },
  rsi: {
    id: "rsi",
    label: "Nifty RSI (14)",
    unit: "rsi",
    description: "14-period RSI of the Nifty 50 index.",
  },
};

// Nifty 50 constituents (TradingView NSE symbols). Membership drifts over time;
// breadth is computed over whatever resolves, so small changes are harmless.
const CONSTITUENTS = [
  "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "HINDUNILVR", "ITC",
  "SBIN", "BHARTIARTL", "BAJFINANCE", "KOTAKBANK", "LT", "HCLTECH", "AXISBANK",
  "MARUTI", "ASIANPAINT", "SUNPHARMA", "TITAN", "ULTRACEMCO", "WIPRO",
  "NESTLEIND", "ONGC", "NTPC", "POWERGRID", "TMPV", "TATASTEEL", "JSWSTEEL",
  "ADANIENT", "ADANIPORTS", "COALINDIA", "GRASIM", "HINDALCO", "BAJAJFINSV",
  "BPCL", "BRITANNIA", "CIPLA", "DRREDDY", "EICHERMOT", "HDFCLIFE", "HEROMOTOCO",
  "INDUSINDBK", "SBILIFE", "TATACONSUM", "TECHM", "APOLLOHOSP", "BAJAJ_AUTO",
  "M&M", "SHRIRAMFIN", "TRENT", "BEL", "JIOFIN", "ETERNAL",
];

// TradingView-quoted market keys (the rest come from other sources).
const MARKET_KEYS = [
  "nifty",
  "banknifty",
  "indiavix",
  "usdinr",
  "in10y",
  "us10y",
  "repo",
  "inflation",
];

// Cards shown in the grid (the index itself is the hero).
const CARD_ORDER = [
  "breadth",
  "rsi",
  "banknifty",
  "indiavix",
  "usdinr",
  "repo",
  "in10y",
  "us10y",
  "inflation",
];

const MOCK: Record<string, [number, number]> = {
  nifty: [23800, 24010],
  banknifty: [51200, 51650],
  indiavix: [14.1, 13.4],
  usdinr: [83.25, 83.18],
  in10y: [6.9, 6.93],
  us10y: [4.3, 4.35],
  repo: [5.25, 5.5],
  inflation: [3.5, 3.7],
  breadth: [60, 60],
  rsi: [55, 54],
};

export interface NiftyBundle {
  metrics: Metric[];
  index: Metric;
  usingMockData: boolean;
}

function mock(key: string): Metric {
  const [value, previous] = MOCK[key] ?? [0, 0];
  return buildMetric(
    META[key],
    value,
    previous,
    new Date().toISOString().slice(0, 10),
    "Demo data",
    true,
  );
}

let fastCache: { data: NiftyBundle; expires: number } | null = null;
let lastGood: NiftyBundle | null = null;

function ttlMs(): number {
  const ms = Number(process.env.VALUES_CACHE_MS ?? 1000);
  return Number.isFinite(ms) && ms >= 0 ? ms : 1000;
}

/** Live Nifty bundle, market data refreshed ~every second (TradingView). */
export async function getNiftyData(): Promise<NiftyBundle> {
  if (fastCache && fastCache.expires > Date.now()) return fastCache.data;

  const fresh = await fetchNifty();
  const data = fresh.usingMockData && lastGood ? lastGood : fresh;
  if (!fresh.usingMockData) lastGood = fresh;

  fastCache = { data, expires: Date.now() + ttlMs() };
  return data;
}

async function fetchNifty(): Promise<NiftyBundle> {
  const tickers = MARKET_KEYS.map((k) => META[k].ticker!);
  // Real-time stream (preferred). Anything not yet streamed falls back to the
  // REST scanner snapshot below.
  ensureSubscribed(tickers);
  const missing = tickers.filter((t) => !getQuote(t));

  let rows: Map<string, (number | null)[]> = new Map();
  if (missing.length) {
    try {
      rows = await tradingviewScan(missing);
    } catch {
      rows = new Map();
    }
  }
  const asOf = new Date().toISOString().slice(0, 10);

  const byKey: Record<string, Metric> = {};
  for (const k of MARKET_KEYS) {
    const ticker = META[k].ticker!;
    const q = getQuote(ticker);
    if (q) {
      byKey[k] = buildMetric(
        META[k],
        q.price,
        q.price - q.change,
        asOf,
        "TradingView",
      );
      continue;
    }
    const d = rows.get(ticker);
    if (d && typeof d[0] === "number") {
      const close = d[0];
      const changeAbs = typeof d[1] === "number" ? d[1] : 0;
      byKey[k] = buildMetric(
        META[k],
        close,
        close - changeAbs,
        asOf,
        "TradingView",
      );
    } else {
      byKey[k] = mock(k);
    }
  }

  // Inflation comes from TradingView (ECONOMICS:INIRYY) above; if that was
  // missing, fall back to the FRED India CPI year-on-year series.
  if (byKey.inflation.mock) {
    byKey.inflation = await getIndiaInflation();
  }

  // Market breadth + index RSI (computed/cached separately, ~60s).
  const [b, rsi] = await Promise.all([getNiftyBreadth(), getNiftyRsi()]);
  byKey.breadth = b
    ? buildMetric(
        META.breadth,
        Math.round(b.pct * 10) / 10,
        null,
        asOf,
        `TradingView (${b.above}/${b.total} stocks)`,
      )
    : mock("breadth");
  byKey.rsi =
    rsi != null
      ? buildMetric(META.rsi, Math.round(rsi * 100) / 100, null, asOf, "TradingView")
      : mock("rsi");

  const metrics = CARD_ORDER.map((k) => byKey[k]);
  const index = byKey.nifty;
  const usingMockData = metrics.concat(index).every((m) => m.mock);
  return { metrics, index, usingMockData };
}

interface FredObs {
  date: string;
  value: string;
}
let inflCache: { m: Metric; expires: number } | null = null;

/** India CPI year-on-year from FRED, cached 6h (30m on failure). */
async function getIndiaInflation(): Promise<Metric> {
  if (inflCache && inflCache.expires > Date.now()) return inflCache.m;

  let m: Metric;
  let ok = false;
  try {
    const key = process.env.FRED_API_KEY;
    if (!key) throw new Error("no FRED key");
    const url =
      `${FRED_BASE}?series_id=INDCPIALLMINMEI&api_key=${key}` +
      `&file_type=json&sort_order=desc&limit=14`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error(`FRED -> ${res.status}`);
    const json = (await res.json()) as { observations: FredObs[] };
    const obs = json.observations
      .filter((o) => o.value !== ".")
      .map((o) => ({ date: o.date, value: Number(o.value) }));
    if (obs.length < 14) throw new Error("not enough CPI history");
    const yoy = (a: number, b: number) => Math.round((a / b - 1) * 1000) / 10;
    m = buildMetric(
      META.inflation,
      yoy(obs[0].value, obs[12].value),
      yoy(obs[1].value, obs[13].value),
      obs[0].date,
      "FRED",
    );
    ok = true;
  } catch {
    m = mock("inflation");
  }
  inflCache = { m, expires: Date.now() + (ok ? 6 * 3600_000 : 30 * 60_000) };
  return m;
}

export function allNiftyMock(): NiftyBundle {
  const metrics = CARD_ORDER.map(mock);
  return { metrics, index: mock("nifty"), usingMockData: true };
}

export interface Breadth {
  pct: number;
  above: number;
  total: number;
}
let breadthCache: { b: Breadth; expires: number } | null = null;

/**
 * Market breadth: % of Nifty 50 constituents trading above their 50-day EMA.
 * One scanner request returns each stock's close + EMA50. Cached 60s.
 */
export async function getNiftyBreadth(): Promise<Breadth | null> {
  if (breadthCache && breadthCache.expires > Date.now()) return breadthCache.b;
  try {
    // close + 50-day EMA per stock, from the India screener.
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
    if (total < 40) throw new Error("too few constituents resolved");
    const b: Breadth = { pct: (above / total) * 100, above, total };
    breadthCache = { b, expires: Date.now() + 60_000 };
    return b;
  } catch {
    return breadthCache?.b ?? null;
  }
}

export interface NiftyTechnicals {
  cmp: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  adx: number;
  atr: number;
  s1: number;
  r1: number;
  s2: number;
  r2: number;
  high1m: number;
  low1m: number;
}
let techCache: { t: NiftyTechnicals; expires: number } | null = null;

/** Full technical snapshot of the Nifty 50 index for strategy generation. */
export async function getNiftyTechnicals(): Promise<NiftyTechnicals | null> {
  if (techCache && techCache.expires > Date.now()) return techCache.t;
  const cols = [
    "close", "EMA20", "EMA50", "EMA200", "RSI", "MACD.macd", "MACD.signal",
    "ADX", "ATR", "Pivot.M.Classic.S1", "Pivot.M.Classic.R1",
    "Pivot.M.Classic.S2", "Pivot.M.Classic.R2", "High.1M", "Low.1M",
  ];
  try {
    const rows = await tradingviewScanCols(["NSE:NIFTY"], cols, "india");
    const d = rows.get("NSE:NIFTY");
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

let rsiCache: { rsi: number; expires: number } | null = null;

/** 14-period RSI of the Nifty 50 index from TradingView. Cached 60s. */
export async function getNiftyRsi(): Promise<number | null> {
  if (rsiCache && rsiCache.expires > Date.now()) return rsiCache.rsi;
  try {
    const rows = await tradingviewScanCols(["NSE:NIFTY"], ["RSI"], "india");
    const d = rows.get("NSE:NIFTY");
    const rsi = d?.[0];
    if (typeof rsi !== "number") throw new Error("no RSI");
    rsiCache = { rsi, expires: Date.now() + 60_000 };
    return rsi;
  } catch {
    return rsiCache?.rsi ?? null;
  }
}

import { makeMetric, OUNCE_TO_GRAM } from "../fred";
import type { Metric } from "../types";

// Unofficial TradingView scanner endpoint. Returns one row per ticker:
//   d = [close, change_abs]
// This is reverse-engineered and not covered by an official API/ToS — we keep
// FRED as an automatic fallback in lib/macro.ts.
const SCAN_URL = "https://scanner.tradingview.com/global/scan";

const SPECS: Record<
  string,
  { ticker: string; source: string; transform?: (v: number) => number }
> = {
  dxy: { ticker: "TVC:DXY", source: "TradingView (TVC:DXY)" },
  us10y: { ticker: "TVC:US10Y", source: "TradingView (TVC:US10Y)" },
  vix: { ticker: "TVC:VIX", source: "TradingView (TVC:VIX)" },
  // 30-day Fed funds futures (continuous) -> implied rate = 100 - price.
  fed: {
    ticker: "CBOT:ZQ1!",
    source: "TradingView (Fed funds futures)",
    transform: (v) => 100 - v,
  },
  // Spot gold (XAU) — quoted per ounce; convert to per gram.
  gold: {
    ticker: "TVC:GOLD",
    source: "TradingView (spot gold)",
    transform: (v) => v / OUNCE_TO_GRAM,
  },
};

export const TV_KEYS = Object.keys(SPECS);

interface ScanResp {
  data?: { s: string; d: (number | null)[] }[];
}

/**
 * Generic batch query: returns ticker -> column values (in the requested
 * order). `screener` selects the universe ("global", "india", ...). Throws on
 * transport failure.
 */
export async function tradingviewScanCols(
  tickers: string[],
  columns: string[],
  screener = "global",
): Promise<Map<string, (number | null)[]>> {
  const body = JSON.stringify({ symbols: { tickers }, columns });
  const res = await fetch(`https://scanner.tradingview.com/${screener}/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json",
    },
    body,
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`TradingView -> ${res.status}`);
  const json = (await res.json()) as ScanResp;
  return new Map((json.data ?? []).map((r) => [r.s, r.d]));
}

/** Batch quote: returns ticker -> [close, change_abs]. */
export function tradingviewScan(
  tickers: string[],
): Promise<Map<string, (number | null)[]>> {
  return tradingviewScanCols(tickers, ["close", "change_abs"]);
}

export interface ScreenRow {
  /** "EXCHANGE:TICKER". */
  symbol: string;
  /** Column values in the requested order. */
  values: (number | string | null)[];
}

/**
 * Screen a whole market (not a fixed ticker list): POST a filter/sort/range
 * query to a country screener and get back the matching rows with their symbol
 * and requested columns. Used to discover the top companies of a country.
 * Throws on transport failure.
 */
export async function tradingviewScreen(
  screener: string,
  columns: string[],
  opts: {
    filter?: { left: string; operation: string; right: unknown }[];
    sort?: { sortBy: string; sortOrder: "asc" | "desc" };
    range?: [number, number];
  } = {},
): Promise<ScreenRow[]> {
  const body = JSON.stringify({
    filter: opts.filter ?? [],
    columns,
    sort: opts.sort,
    range: opts.range ?? [0, 100],
  });
  const res = await fetch(`https://scanner.tradingview.com/${screener}/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json",
    },
    body,
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`TradingView screen -> ${res.status}`);
  const json = (await res.json()) as {
    data?: { s: string; d: (number | string | null)[] }[];
  };
  return (json.data ?? []).map((r) => ({ symbol: r.s, values: r.d }));
}

/** Fetch all market metrics from TradingView in a single request. */
export async function tradingviewBatch(): Promise<Record<string, Metric>> {
  const entries = Object.entries(SPECS);
  const body = JSON.stringify({
    symbols: { tickers: entries.map(([, s]) => s.ticker) },
    columns: ["close", "change_abs"],
  });

  const res = await fetch(SCAN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json",
    },
    body,
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`TradingView -> ${res.status}`);

  const json = (await res.json()) as ScanResp;
  const rows = new Map((json.data ?? []).map((r) => [r.s, r.d]));
  const asOf = new Date().toISOString().slice(0, 10);

  const out: Record<string, Metric> = {};
  for (const [key, spec] of entries) {
    const d = rows.get(spec.ticker);
    if (!d || typeof d[0] !== "number") continue;
    const close = d[0];
    const changeAbs = typeof d[1] === "number" ? d[1] : 0;
    const prevClose = close - changeAbs;
    const t = spec.transform ?? ((v: number) => v);
    out[key] = makeMetric(key, t(close), t(prevClose), asOf, spec.source);
  }
  return out;
}

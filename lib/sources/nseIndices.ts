// Live NSE index quotes from the official allIndices JSON feed.
// Source page: https://www.nseindia.com/market-data/live-market-indices
//              (JSON: /api/allIndices)
//
// NSE gates its API behind bot-protection cookies, so we prime a cookie jar by
// hitting the site first, then call the JSON endpoint with browser-like headers
// (same approach as lib/sources/nseFiiDii.ts). Quotes refresh near-realtime
// during market hours; we cache for a minute and always fall back to the last
// good snapshot if a refresh fails.

export interface NseIndexRow {
  /** e.g. "NIFTY BANK" — the key used to look an index up. */
  indexSymbol: string;
  /** Display name as published, e.g. "NIFTY BANK". */
  index: string;
  last: number;
  /** Absolute change vs previous close. */
  variation: number;
  percentChange: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  yearHigh: number;
  yearLow: number;
  pe: number | null;
  pb: number | null;
  /** Dividend yield %. */
  dy: number | null;
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
  /** Index level snapshots for performance calcs (null when not published). */
  oneWeekAgoVal: number | null;
  oneMonthAgoVal: number | null;
  oneYearAgoVal: number | null;
  perChange30d: number | null;
  perChange365d: number | null;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const HOME = "https://www.nseindia.com/";
const REPORT = "https://www.nseindia.com/market-data/live-market-indices";
const API = "https://www.nseindia.com/api/allIndices";
const TTL = 60_000; // near-realtime source — refresh at most every minute

let cache: { at: number; rows: Map<string, NseIndexRow> } | null = null;
let inflight: Promise<Map<string, NseIndexRow>> | null = null;

/** "20.87" -> 20.87, "" / "-" / garbage -> null. */
const numOrNull = (v: unknown): number | null => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const num = (v: unknown): number => numOrNull(v) ?? 0;

async function timedFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    return await fetch(url, { headers, cache: "no-store", signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function primeCookies(): Promise<string> {
  const baseHeaders = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  const jar: string[] = [];
  for (const url of [HOME, REPORT]) {
    try {
      const res = await timedFetch(url, baseHeaders);
      const set =
        (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      for (const c of set) jar.push(c.split(";")[0]);
    } catch {
      /* keep whatever we collected */
    }
  }
  return jar.join("; ");
}

function parseRow(o: Record<string, unknown>): NseIndexRow | null {
  const indexSymbol = String(o.indexSymbol ?? "").trim();
  const last = numOrNull(o.last);
  if (!indexSymbol || last == null || last <= 0) return null;
  return {
    indexSymbol,
    index: String(o.index ?? indexSymbol).trim(),
    last,
    variation: num(o.variation),
    percentChange: num(o.percentChange),
    open: num(o.open),
    high: num(o.high),
    low: num(o.low),
    previousClose: num(o.previousClose),
    yearHigh: num(o.yearHigh),
    yearLow: num(o.yearLow),
    pe: numOrNull(o.pe),
    pb: numOrNull(o.pb),
    dy: numOrNull(o.dy),
    advances: numOrNull(o.advances),
    declines: numOrNull(o.declines),
    unchanged: numOrNull(o.unchanged),
    oneWeekAgoVal: numOrNull(o.oneWeekAgoVal),
    oneMonthAgoVal: numOrNull(o.oneMonthAgoVal),
    oneYearAgoVal: numOrNull(o.oneYearAgoVal),
    perChange30d: numOrNull(o.perChange30d),
    perChange365d: numOrNull(o.perChange365d),
  };
}

async function fetchAllIndices(): Promise<Map<string, NseIndexRow>> {
  const cookie = await primeCookies();
  const res = await timedFetch(API, {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: REPORT,
    "X-Requested-With": "XMLHttpRequest",
    ...(cookie ? { Cookie: cookie } : {}),
  });
  if (!res.ok) throw new Error(`NSE allIndices ${res.status}`);
  const raw = (await res.json()) as { data?: unknown[] };
  const out = new Map<string, NseIndexRow>();
  for (const r of raw.data ?? []) {
    const row = parseRow(r as Record<string, unknown>);
    if (row) out.set(row.indexSymbol, row);
  }
  if (!out.size) throw new Error("NSE allIndices empty");
  return out;
}

/**
 * All NSE indices keyed by indexSymbol ("NIFTY BANK", "NIFTY IT", …) plus the
 * time they were fetched. Serves the last good snapshot on refresh failure;
 * null only if the feed has never loaded.
 */
export async function getNseIndices(): Promise<{
  rows: Map<string, NseIndexRow>;
  at: number;
} | null> {
  if (cache && Date.now() - cache.at < TTL) return cache;

  if (!inflight) {
    inflight = fetchAllIndices()
      .then((rows) => {
        cache = { at: Date.now(), rows };
        return rows;
      })
      .finally(() => {
        inflight = null;
      });
  }

  try {
    await inflight;
  } catch {
    /* fall through to stale cache below */
  }
  return cache;
}

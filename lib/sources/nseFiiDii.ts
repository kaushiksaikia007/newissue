// FII/FPI & DII trading activity (Capital Market Segment) from NSE.
// Source: https://www.nseindia.com/reports/fii-dii  (JSON: /api/fiidiiTradeReact)
//
// NSE gates its API behind bot-protection cookies, so we prime a cookie jar by
// hitting the site first, then call the JSON endpoint with browser-like headers.
// The figures are end-of-day (they don't move intraday), so we cache aggressively
// and always fall back to the last good snapshot if a refresh fails.

export interface FiiDiiRow {
  category: string; // "FII/FPI" | "DII"
  date: string; // "30-Jun-2026"
  buyValue: number; // ₹ crores
  sellValue: number;
  netValue: number;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const HOME = "https://www.nseindia.com/";
const REPORT = "https://www.nseindia.com/reports/fii-dii";
const API = "https://www.nseindia.com/api/fiidiiTradeReact";
const TTL = 5 * 60_000; // refresh at most every 5 minutes

let cache: { at: number; rows: FiiDiiRow[] } | null = null;
let inflight: Promise<FiiDiiRow[]> | null = null;

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

// "DII **" / "FII/FPI *" -> "DII" / "FII/FPI"
const cleanCategory = (c: unknown): string =>
  String(c ?? "")
    .replace(/\*+/g, "")
    .trim();

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

async function fetchFiiDii(): Promise<FiiDiiRow[]> {
  const cookie = await primeCookies();
  const res = await timedFetch(API, {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: REPORT,
    "X-Requested-With": "XMLHttpRequest",
    ...(cookie ? { Cookie: cookie } : {}),
  });
  if (!res.ok) throw new Error(`NSE ${res.status}`);
  const raw: unknown = await res.json();
  const arr = Array.isArray(raw) ? raw : [];
  const rows = arr
    .map((r) => {
      const o = r as Record<string, unknown>;
      return {
        category: cleanCategory(o.category),
        date: String(o.date ?? "").trim(),
        buyValue: num(o.buyValue),
        sellValue: num(o.sellValue),
        netValue: num(o.netValue),
      };
    })
    .filter((r) => r.category);
  if (!rows.length) throw new Error("NSE empty");
  return rows;
}

/** Cached FII/DII rows with the timestamp they were fetched; null if never loaded. */
export async function getFiiDii(): Promise<{ rows: FiiDiiRow[]; at: number } | null> {
  if (cache && Date.now() - cache.at < TTL) return cache;

  if (!inflight) {
    inflight = fetchFiiDii()
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

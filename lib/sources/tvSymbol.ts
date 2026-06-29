// Resolve an ISIN (or plain ticker) to a TradingView symbol via their public
// symbol-search endpoint — the same one the search box on tradingview.com
// calls. An ISIN -> symbol mapping is effectively static, so it's cached in
// memory. This is reverse-engineered and not an official API/ToS, matching the
// rest of the TradingView sourcing in this project (see lib/sources/*).

export interface TvSymbol {
  /** "EXCHANGE:TICKER" — the key used to subscribe/scan. */
  symbol: string;
  /** Bare ticker, e.g. "AAPL". */
  ticker: string;
  /** Routing exchange, e.g. "NASDAQ". */
  exchange: string;
  description: string;
  /** "stock" | "fund" | "bond" | "index" | ... */
  type: string;
  currency?: string;
}

const SEARCH = "https://symbol-search.tradingview.com/symbol_search/";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Origin: "https://www.tradingview.com",
  Referer: "https://www.tradingview.com/",
  Accept: "application/json",
};

// Search results wrap the matched text in <em> highlight tags.
const stripTags = (s: string) => s.replace(/<[^>]*>/g, "");

interface SearchRow {
  symbol?: string;
  description?: string;
  type?: string;
  exchange?: string;
  currency_code?: string;
  prefix?: string;
}

const cache = new Map<string, { sym: TvSymbol | null; expires: number }>();

/** Resolve an ISIN / ticker to its primary TradingView symbol, or null. */
export async function resolveTvSymbol(text: string): Promise<TvSymbol | null> {
  const key = (text || "").toUpperCase().trim();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.sym;

  let rows: SearchRow[] = [];
  try {
    const url = `${SEARCH}?text=${encodeURIComponent(key)}&hl=1&lang=en&domain=production`;
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (res.ok) {
      const j = (await res.json()) as SearchRow[] | { symbols?: SearchRow[] };
      rows = Array.isArray(j) ? j : (j.symbols ?? []);
    }
  } catch {
    /* network — fall through to negative cache */
  }

  const sym = pick(rows);
  // Cache positives for a day; negatives briefly so an unresolvable ISIN
  // doesn't hammer TradingView on every poll.
  cache.set(key, {
    sym,
    expires: Date.now() + (sym ? 24 * 3600_000 : 10 * 60_000),
  });
  return sym;
}

function pick(rows: SearchRow[]): TvSymbol | null {
  for (const r of rows) {
    const ticker = stripTags(r.symbol ?? "");
    const exchange = stripTags(r.exchange ?? "").toUpperCase();
    if (!ticker || !exchange) continue;
    // `prefix` (when present) is the routing exchange the chart/quote feed
    // expects; the human `exchange` label is the fallback.
    const ex = (r.prefix ? stripTags(r.prefix).toUpperCase() : "") || exchange;
    return {
      symbol: `${ex}:${ticker}`,
      ticker,
      exchange,
      description: stripTags(r.description ?? ""),
      type: r.type ?? "",
      currency: r.currency_code || undefined,
    };
  }
  return null;
}

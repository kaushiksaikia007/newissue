import { ensureSubscribed, getQuote } from "./tvSocket";
import { tradingviewScanCols } from "./tradingview";

// Live prices/quotes for arbitrary TradingView symbols (EXCHANGE:TICKER). The
// streaming socket is universal (no screener routing needed), so it's the
// primary source; the REST scanner fills any gaps before the socket has warmed.

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const SCREENERS = ["global", "india"];

export interface FullQuote {
  price: number;
  change: number;
  changePct: number;
}

const quoteFrom = (price: number, change: number): FullQuote => {
  const prev = price - change;
  return { price, change, changePct: prev ? (change / prev) * 100 : 0 };
};

/** Batch live quotes (price + change). Waits briefly for the socket to warm. */
export async function tvQuotes(symbols: string[]): Promise<Map<string, FullQuote>> {
  const out = new Map<string, FullQuote>();
  const want = Array.from(
    new Set(symbols.map((s) => (s || "").toUpperCase().trim()).filter((s) => s.includes(":"))),
  );
  if (!want.length) return out;
  ensureSubscribed(want);

  // Up to ~2.5s for the socket to deliver every symbol (returns early when all
  // are in). Warm invocations satisfy this on the first pass.
  for (let i = 0; i < 10; i++) {
    let missing = false;
    for (const s of want) {
      const q = getQuote(s);
      if (q) out.set(s, quoteFrom(q.price, q.change));
      else missing = true;
    }
    if (!missing) break;
    await sleep(250);
  }

  // Scanner fallback (try global then india) for anything still missing.
  for (const screener of SCREENERS) {
    const left = want.filter((s) => !out.has(s));
    if (!left.length) break;
    try {
      const rows = await tradingviewScanCols(left, ["close", "change_abs"], screener);
      for (const [sym, d] of rows) {
        if (typeof d[0] === "number") {
          out.set(sym, quoteFrom(d[0], typeof d[1] === "number" ? d[1] : 0));
        }
      }
    } catch {
      /* try next screener */
    }
  }
  return out;
}

/** A single symbol's quote, or null. */
export async function tvQuote(symbol: string): Promise<FullQuote | null> {
  const m = await tvQuotes([symbol]);
  return m.get((symbol || "").toUpperCase().trim()) ?? null;
}

/** Batch prices only (for the monitor's /api/prices). */
export async function tvPrices(symbols: string[]): Promise<Map<string, number>> {
  const q = await tvQuotes(symbols);
  const out = new Map<string, number>();
  for (const [sym, v] of q) out.set(sym, v.price);
  return out;
}

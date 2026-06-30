import { NextResponse } from "next/server";
import { tvQuote, tvQuotes } from "@/lib/sources/tvQuote";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Live quotes for the watchlist UI, polled ~every second.
//   ?symbol=NASDAQ:AAPL          -> { symbol, price, change, changePct }
//   ?symbols=NASDAQ:AAPL,TVC:GOLD -> { quotes: { sym: { price, change, changePct } } }
export async function GET(req: Request) {
  const url = new URL(req.url);
  const many = url.searchParams.get("symbols");

  if (many != null) {
    const list = many.split(",").map((s) => s.trim()).filter(Boolean);
    const m = await tvQuotes(list);
    const quotes: Record<string, { price: number; change: number; changePct: number }> = {};
    for (const [sym, q] of m) quotes[sym] = q;
    return NextResponse.json({ quotes });
  }

  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase().trim();
  if (!symbol.includes(":")) return NextResponse.json({ symbol, price: null });
  const q = await tvQuote(symbol);
  if (!q) return NextResponse.json({ symbol, price: null });
  return NextResponse.json({ symbol, ...q });
}

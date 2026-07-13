import { NextResponse } from "next/server";
import { tvQuotes } from "@/lib/sources/tvQuote";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Live quotes (price + % change) for a set of TradingView symbols — powers the
// customized brain's realtime price panel. No auth needed (read-only prices).
export async function GET(req: Request) {
  const symbols = (new URL(req.url).searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);
  if (!symbols.length) return NextResponse.json({ quotes: {} });

  const quotes: Record<string, { price: number; changePct: number }> = {};
  try {
    const m = await tvQuotes(symbols);
    for (const [sym, q] of m) quotes[sym] = { price: q.price, changePct: q.changePct };
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ quotes });
}

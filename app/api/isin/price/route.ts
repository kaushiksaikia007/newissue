import { NextResponse } from "next/server";
import { resolveTvSymbol } from "@/lib/sources/tvSymbol";
import { ensureSubscribed, getQuote } from "@/lib/sources/tvSocket";
import { tradingviewScanCols } from "@/lib/sources/tradingview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Live market price for an ISIN, pulled from TradingView. Polled ~every second
// by the client. The shared websocket (tvSocket) streams the latest tick; the
// REST scanner is only used to seed the first response before the stream warms.
export async function GET(req: Request) {
  const isin = new URL(req.url).searchParams.get("isin") ?? "";
  const sym = await resolveTvSymbol(isin);
  if (!sym) {
    return NextResponse.json({ found: false });
  }

  ensureSubscribed([sym.symbol]);

  let price: number | null = null;
  let change = 0;

  const q = getQuote(sym.symbol);
  if (q) {
    price = q.price;
    change = q.change;
  } else {
    // Stream not warm yet — snapshot via the REST scanner so the very first
    // poll already shows a number.
    try {
      const rows = await tradingviewScanCols(
        [sym.symbol],
        ["close", "change_abs"],
      );
      const d = rows.get(sym.symbol);
      if (d && typeof d[0] === "number") {
        price = d[0];
        change = typeof d[1] === "number" ? d[1] : 0;
      }
    } catch {
      /* no snapshot available */
    }
  }

  const prev = price == null ? null : price - change;
  return NextResponse.json({
    found: true,
    symbol: sym.symbol,
    exchange: sym.exchange,
    description: sym.description,
    currency: sym.currency,
    price,
    change,
    changePct: prev ? (change / prev) * 100 : 0,
    ts: Date.now(),
  });
}

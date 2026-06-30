import { NextResponse } from "next/server";
import { searchTvSymbols } from "@/lib/sources/tvSymbol";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Free-text TradingView symbol search for the watchlist "add" box.
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 1) return NextResponse.json({ results: [] });
  const results = await searchTvSymbols(q, 12);
  return NextResponse.json({ results });
}

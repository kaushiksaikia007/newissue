import { NextResponse } from "next/server";
import { getSymbolMeta, getSymbolTechnicals } from "@/lib/symbol";
import { analyzeSymbol } from "@/lib/symbolBrain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Deep technical analysis + disciplined Buy/Sell/Hold verdict for any symbol.
export async function GET(req: Request) {
  const symbol = (new URL(req.url).searchParams.get("symbol") ?? "").toUpperCase().trim();
  if (!symbol.includes(":")) {
    return NextResponse.json({ ok: false, error: "Invalid symbol." }, { status: 400 });
  }

  const [meta, tech] = await Promise.all([
    getSymbolMeta(symbol),
    getSymbolTechnicals(symbol),
  ]);

  if (!tech || !Number.isFinite(tech.price)) {
    return NextResponse.json({
      ok: false,
      error: "Couldn't load market data for this symbol — it may not be covered by the data feed.",
    });
  }

  const resolved = meta ?? {
    symbol,
    ticker: symbol.split(":")[1] ?? symbol,
    exchange: symbol.split(":")[0] ?? "",
    description: symbol,
    type: "",
  };

  const verdict = await analyzeSymbol(resolved, tech);

  return NextResponse.json({
    ok: true,
    symbol,
    meta: resolved,
    technicals: tech,
    verdict,
  });
}

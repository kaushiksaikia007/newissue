import { NextResponse } from "next/server";
import { getSymbolMeta, getSymbolTechnicals } from "@/lib/symbol";
import { analyzeSymbol, chatSymbol, type ChatMsg } from "@/lib/symbolBrain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Conversational follow-up about a specific symbol, grounded in its live
// technicals + the disciplined signal, with web search for facts.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const symbol = String(body.symbol ?? "").toUpperCase().trim();
  const messages: ChatMsg[] = Array.isArray(body.messages) ? body.messages : [];
  if (!symbol.includes(":")) {
    return NextResponse.json({ reply: "Invalid symbol." }, { status: 400 });
  }

  const [meta, tech] = await Promise.all([
    getSymbolMeta(symbol),
    getSymbolTechnicals(symbol),
  ]);
  if (!tech) {
    return NextResponse.json({ reply: "I can't reach live data for this symbol right now." });
  }
  const resolved = meta ?? {
    symbol,
    ticker: symbol.split(":")[1] ?? symbol,
    exchange: symbol.split(":")[0] ?? "",
    description: symbol,
    type: "",
  };

  const verdict = await analyzeSymbol(resolved, tech);
  const reply = await chatSymbol(resolved, tech, verdict, messages);
  return NextResponse.json({ reply });
}

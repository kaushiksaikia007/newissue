import { NextResponse } from "next/server";
import { commodityQuotesFor } from "@/lib/countryCommodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A country's key commodities with live TradingView prices attached.
export async function GET(req: Request) {
  const code = (new URL(req.url).searchParams.get("code") ?? "").trim();
  if (!code) return NextResponse.json({ commodities: [] });
  const commodities = await commodityQuotesFor(code);
  return NextResponse.json({ commodities });
}

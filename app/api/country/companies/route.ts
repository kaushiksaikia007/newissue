import { NextResponse } from "next/server";
import { searchCompanies } from "@/lib/countryData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Top companies of a country (optionally filtered by `q`), sourced from
// TradingView's public scanner and cached — no OpenAI/API key involved.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!code) return NextResponse.json({ companies: [] });
  const companies = await searchCompanies(code, q);
  return NextResponse.json({ companies });
}

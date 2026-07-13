import { NextResponse } from "next/server";
import { getIndicators, INDICATORS } from "@/lib/macroData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Live macro indicators for a country (GDP growth, …), pulled from the open
// internet in near real time. GET /api/country/macro?code=IN&name=India&keys=gdp
// -> { indicators: { gdp: { value, changePct, unit, asOf, source } } }
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "").trim();
  const name = (url.searchParams.get("name") || code || "this country").trim();
  const keys = (url.searchParams.get("keys") || "gdp")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k in INDICATORS)
    .slice(0, 20);

  if (!code || !keys.length) return NextResponse.json({ indicators: {} });

  const indicators = await getIndicators(code, name, keys);
  return NextResponse.json({ indicators });
}

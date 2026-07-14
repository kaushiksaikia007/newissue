import { NextResponse } from "next/server";
import { getRiskRadar } from "@/lib/riskData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Live country risk radar — five axes (Currency, Inflation, Geopolitical,
// Liquidity, Policy) computed from real macro data and normalized 0-100.
// GET /api/country/risk?code=IN&name=India
// -> { axes: [{ label, score, components, missing }], asOf }
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "").trim();
  const name = (url.searchParams.get("name") || code || "this country").trim();
  if (!code) return NextResponse.json({ axes: [], asOf: null });

  try {
    const data = await getRiskRadar(code, name);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ axes: [], asOf: null });
  }
}

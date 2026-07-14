import { NextResponse } from "next/server";
import { getSectorImpact } from "@/lib/sectorData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Live sector impact scores — 8 sectors rated 0-100 from real macro/market
// indicators (weighted scoring engine, see lib/sectorData.ts).
// GET /api/country/sectors?code=IN
// -> { sectors: [{ name, score, sentiment, components, missing }], asOf }
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "").trim();
  if (!code) return NextResponse.json({ sectors: [], asOf: null });

  try {
    const data = await getSectorImpact(code);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ sectors: [], asOf: null });
  }
}

import { NextResponse } from "next/server";
import { getSectorIndexList, getSectorIndexDetail } from "@/lib/sectorIndices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// India sector→NSE-index data layer (see lib/sectorIndices.ts).
// GET /api/country/sector-index?code=IN
//   -> { sectors: [{ id, sector, indexName, last, changePct, … }], asOf }
// GET /api/country/sector-index?code=IN&id=banking
//   -> { detail: { …full index quote… }, news: [{ title, link, source, publishedAt }], asOf }
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "").trim();
  const id = (url.searchParams.get("id") || "").trim();

  try {
    if (id) {
      const data = await getSectorIndexDetail(code, id);
      return NextResponse.json(data);
    }
    const data = await getSectorIndexList(code);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      id ? { detail: null, news: [], asOf: null } : { sectors: [], asOf: null },
    );
  }
}

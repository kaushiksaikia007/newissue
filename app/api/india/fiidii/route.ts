import { NextResponse } from "next/server";
import { getFiiDii } from "@/lib/sources/nseFiiDii";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// FII/FPI & DII trading activity (NSE Capital Market Segment). End-of-day data,
// served from a short-lived server cache so the client can poll freely.
export async function GET() {
  const data = await getFiiDii();
  if (!data) return NextResponse.json({ rows: [], asOf: null });
  return NextResponse.json({ rows: data.rows, asOf: new Date(data.at).toISOString() });
}

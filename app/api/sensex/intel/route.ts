import { NextResponse } from "next/server";
import { getSensexIntel } from "@/lib/instruments/sensexIntel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const data = await getSensexIntel(fresh);
  return NextResponse.json(data);
}

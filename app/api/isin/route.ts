import { NextResponse } from "next/server";
import { lookupIsin } from "@/lib/isin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const isin = new URL(req.url).searchParams.get("isin") ?? "";
  const data = await lookupIsin(isin);
  return NextResponse.json(data);
}

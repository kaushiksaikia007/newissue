import { NextResponse } from "next/server";
import { analyzeIsin } from "@/lib/isinAnalysis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const isin = new URL(req.url).searchParams.get("isin") ?? "";
  const data = await analyzeIsin(isin);
  return NextResponse.json(data);
}

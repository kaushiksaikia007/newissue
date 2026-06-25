import { NextResponse } from "next/server";
import { getNiftyNews } from "@/lib/sources/news";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await getNiftyNews();
  return NextResponse.json({ items });
}

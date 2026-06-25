import { NextResponse } from "next/server";
import { getNews } from "@/lib/sources/news";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await getNews();
  return NextResponse.json({ items });
}

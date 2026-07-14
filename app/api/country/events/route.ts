import { NextResponse } from "next/server";
import { getUpcomingEvents } from "@/lib/eventsData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Top 5 upcoming market-moving events for a country, ranked by importance.
// GET /api/country/events?code=IN -> { events: [{ title, date, impact }], asOf }
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "").trim();
  if (!code) return NextResponse.json({ events: [], asOf: null });

  try {
    const data = await getUpcomingEvents(code);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ events: [], asOf: null });
  }
}

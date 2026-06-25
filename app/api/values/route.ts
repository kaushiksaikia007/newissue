import { NextResponse } from "next/server";
import { getMetrics } from "@/lib/macro";
import { allMockMetrics, mockMetric } from "@/lib/fred";
import type { ValuesResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

// Fast lane: live market values. getMetrics() caches TradingView data for
// ~VALUES_CACHE_MS (default 1s), so polling this every second is cheap.
export async function GET() {
  let data: ValuesResponse;
  try {
    const { metrics, gold, usingMockData } = await getMetrics();
    data = { metrics, gold, usingMockData, fetchedAt: new Date().toISOString() };
  } catch {
    data = {
      metrics: allMockMetrics().filter((m) => m.id !== "gold"),
      gold: mockMetric("gold"),
      usingMockData: true,
      fetchedAt: new Date().toISOString(),
    };
  }
  return NextResponse.json(data);
}

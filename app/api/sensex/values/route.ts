import { NextResponse } from "next/server";
import { allSensexMock, getSensexData } from "@/lib/instruments/sensex";
import { ensureAlertMonitor } from "@/lib/alerts";
import type { ValuesResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureAlertMonitor();
  let data: ValuesResponse;
  try {
    const { metrics, index, usingMockData } = await getSensexData();
    data = {
      metrics,
      gold: index,
      usingMockData,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    const { metrics, index } = allSensexMock();
    data = {
      metrics,
      gold: index,
      usingMockData: true,
      fetchedAt: new Date().toISOString(),
    };
  }
  return NextResponse.json(data);
}

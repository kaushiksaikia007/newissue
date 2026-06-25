import { makeMetric } from "../fred";
import type { Metric } from "../types";

const BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

// BLS series IDs (seasonally adjusted):
//   CPI-U, all items:               CUSR0000SA0
//   Total Nonfarm employment (k):   CES0000000001
const SERIES_ID: Record<string, string> = {
  cpi: "CUSR0000SA0",
  nfp: "CES0000000001",
};

interface BlsDatum {
  year: string;
  period: string; // "M01".."M12", "M13" = annual avg
  value: string;
}
interface BlsResponse {
  status: string;
  Results?: { series: Array<{ seriesID: string; data: BlsDatum[] }> };
}

function periodNum(p: string): number {
  return Number(p.replace(/[^0-9]/g, ""));
}

/** Fetch CPI and NFP from the BLS public API in one call. */
export async function blsMetrics(): Promise<Record<string, Metric>> {
  const now = new Date();
  const endYear = now.getFullYear();
  const body: Record<string, unknown> = {
    seriesid: Object.values(SERIES_ID),
    startyear: String(endYear - 1),
    endyear: String(endYear),
  };
  if (process.env.BLS_API_KEY) body.registrationkey = process.env.BLS_API_KEY;

  const res = await fetch(BLS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`BLS -> ${res.status}`);
  const json = (await res.json()) as BlsResponse;
  if (json.status !== "REQUEST_SUCCEEDED" || !json.Results) {
    throw new Error(`BLS -> ${json.status}`);
  }

  const out: Record<string, Metric> = {};
  for (const key of Object.keys(SERIES_ID)) {
    const id = SERIES_ID[key];
    const series = json.Results.series.find((s) => s.seriesID === id);
    if (!series) continue;

    const rows = series.data
      .filter((d) => d.period !== "M13") // drop annual averages
      .map((d) => ({
        value: Number(d.value),
        sort: Number(d.year) * 100 + periodNum(d.period),
        asOf: `${d.year}-${String(periodNum(d.period)).padStart(2, "0")}-01`,
      }))
      .sort((a, b) => b.sort - a.sort);

    if (rows.length === 0) continue;
    out[key] = makeMetric(
      key,
      rows[0].value,
      rows[1]?.value ?? null,
      rows[0].asOf,
      "BLS.gov",
    );
  }
  return out;
}

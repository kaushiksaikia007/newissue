import type { Metric, Trend } from "./types";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

/**
 * FRED series config — used as the reliable fallback when a primary live
 * website is unreachable, and to define labels/units/descriptions.
 */
export const SERIES: Record<
  string,
  { id: string; label: string; unit: string; description: string }
> = {
  dxy: {
    id: "DTWEXBGS",
    label: "US Dollar Index (DXY)",
    unit: "index",
    description: "U.S. dollar strength against a basket of major currencies.",
  },
  us10y: {
    id: "DGS10",
    label: "US 10Y Treasury Yield",
    unit: "%",
    description: "10-Year Treasury yield.",
  },
  fed: {
    id: "DFEDTARU",
    label: "Fed Expectations",
    unit: "%",
    description: "Market-implied Fed policy rate (rate-cut/hike expectations).",
  },
  cpi: {
    id: "CPIAUCSL",
    label: "CPI (Inflation)",
    unit: "index",
    description: "Consumer Price Index — headline inflation level.",
  },
  nfp: {
    id: "PAYEMS",
    label: "Nonfarm Payrolls",
    unit: "k jobs",
    description: "All Employees, Total Nonfarm (level, thousands).",
  },
  vix: {
    id: "VIXCLS",
    label: "VIX (Risk Sentiment)",
    unit: "index",
    description: "CBOE Volatility Index — global risk-on/risk-off gauge.",
  },
  gold: {
    id: "GOLDPMGBD228NLBM",
    label: "Spot Gold (per gram)",
    unit: "usd",
    description: "Gold price in USD per gram.",
  },
};

/** Troy ounce -> gram. Gold feeds quote per ounce; we display per gram. */
export const OUNCE_TO_GRAM = 31.1034768;

interface FredObs {
  date: string;
  value: string;
}

export function trendOf(change: number | null): Trend {
  if (change === null || Math.abs(change) < 1e-9) return "flat";
  return change > 0 ? "up" : "down";
}

export interface MetricMeta {
  id: string;
  label: string;
  unit: string;
  description: string;
}

/** Build a Metric from explicit metadata and a latest+previous pair. */
export function buildMetric(
  meta: MetricMeta,
  value: number,
  previous: number | null,
  asOf: string,
  source: string,
  mock = false,
): Metric {
  const change = previous != null ? value - previous : null;
  const changePct =
    previous != null && previous !== 0 ? (change! / previous) * 100 : null;
  return {
    id: meta.id,
    label: meta.label,
    value,
    previous,
    change,
    changePct,
    unit: meta.unit,
    asOf,
    description: meta.description,
    trend: trendOf(change),
    source,
    mock,
  };
}

/** Build a Metric for a key defined in the FRED SERIES registry. */
export function makeMetric(
  key: string,
  value: number,
  previous: number | null,
  asOf: string,
  source: string,
  mock = false,
): Metric {
  const cfg = SERIES[key];
  return buildMetric(
    { id: key, label: cfg.label, unit: cfg.unit, description: cfg.description },
    value,
    previous,
    asOf,
    source,
    mock,
  );
}

/** Fetch a single series from FRED (fallback provider). Throws on failure. */
export async function fredMetric(key: string): Promise<Metric> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("FRED_API_KEY not set");
  const cfg = SERIES[key];

  const url =
    `${FRED_BASE}?series_id=${cfg.id}&api_key=${apiKey}` +
    `&file_type=json&sort_order=desc&limit=8`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`FRED ${cfg.id} -> ${res.status}`);
  const json = (await res.json()) as { observations: FredObs[] };

  const obs = json.observations
    .filter((o) => o.value !== ".")
    .map((o) => ({ date: o.date, value: Number(o.value) }));
  if (obs.length === 0) throw new Error(`FRED ${cfg.id} -> no observations`);

  // FRED quotes gold per ounce; convert to per gram for display.
  const conv = key === "gold" ? (v: number) => v / OUNCE_TO_GRAM : (v: number) => v;
  return makeMetric(
    key,
    conv(obs[0].value),
    obs[1] ? conv(obs[1].value) : null,
    obs[0].date,
    "FRED (St. Louis Fed)",
  );
}

/** Deterministic mock so the dashboard renders without any data source. */
export function mockMetric(key: string): Metric {
  const base: Record<string, [number, number]> = {
    dxy: [104.2, 104.7],
    us10y: [4.28, 4.35],
    fed: [4.33, 4.33],
    cpi: [319.8, 318.9],
    nfp: [159350, 159210],
    vix: [18.6, 16.9],
    gold: [2658.4 / OUNCE_TO_GRAM, 2641.1 / OUNCE_TO_GRAM],
  };
  const [value, previous] = base[key] ?? [0, 0];
  const asOf = new Date().toISOString().slice(0, 10);
  return makeMetric(key, value, previous, asOf, "Demo data", true);
}

export function allMockMetrics(): Metric[] {
  return Object.keys(SERIES).map(mockMetric);
}

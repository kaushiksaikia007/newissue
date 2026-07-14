import { tradingviewScanCols } from "./sources/tradingview";
import { cached, econAll, fxAll, yieldsAll, percentile, val, chg } from "./riskData";

/**
 * Live Sector Impact engine — scores 8 sectors 0-100 for a country using the
 * weighted-indicator methodology:
 *
 *   1. collect real indicators per sector (TradingView Economics series,
 *      global market prices, FX),
 *   2. normalize each to a 0-100 bullishness score (peer-set percentile for
 *      country series; momentum/PMI transforms for market prices),
 *   3. weight and sum; a missing indicator is dropped and the remaining
 *      weights renormalize, so a sector never breaks,
 *   4. map the final score to sentiment: ≥75 Bullish · 45-74 Neutral ·
 *      <45 Bearish.
 *
 * Indicators with no public per-country source (NPA ratios, drug pipelines,
 * AI capex, OPEC decisions, rural income…) are reported in `missing` rather
 * than silently faked.
 */

export interface SectorComponent {
  label: string;
  /** Normalized 0-100 bullishness (higher = better for the sector). */
  score: number;
  weight: number;
}

export type SectorSentiment = "Bullish" | "Neutral" | "Bearish";

export interface SectorScore {
  name: string;
  score: number; // weighted composite 0-100
  sentiment: SectorSentiment;
  components: SectorComponent[];
  missing: string[];
}

export interface SectorImpactData {
  sectors: SectorScore[];
  asOf: string;
}

/* ------------------------------ Market data ------------------------------ */

const MKT_TTL = 10 * 60_000;

/** Global prices every sector model shares — one scanner call. */
const MKT = {
  nasdaq: "NASDAQ:IXIC",
  dxy: "TVC:DXY",
  brent: "ICEEUR:BRN1!",
  natgas: "NYMEX:NG1!",
  copper: "COMEX:HG1!",
  steelUs: "COMEX:HRC1!", // US HRC steel futures
  steelCn: "SHFE:RB1!", // Shanghai rebar futures
} as const;

interface Quote {
  close: number;
  changePct: number | null;
  perf3m: number | null;
}

function marketAll(): Promise<Map<string, Quote>> {
  return cached("sector:mkt", MKT_TTL, async () => {
    const symbols = Object.values(MKT) as string[];
    const rows = await tradingviewScanCols(symbols, ["close", "change", "Perf.3M"], "global");
    const out = new Map<string, Quote>();
    for (const s of symbols) {
      const d = rows.get(s);
      if (d && typeof d[0] === "number") {
        out.set(s, {
          close: d[0],
          changePct: typeof d[1] === "number" ? d[1] : null,
          perf3m: typeof d[2] === "number" ? d[2] : null,
        });
      }
    }
    return out;
  });
}

/** 10Y yield 3-month momentum per country (rates direction proxy). */
function yields3mAll(): Promise<Map<string, number>> {
  return cached("sector:y3m", MKT_TTL, async () => {
    const codes = ["IN","US","CN","JP","DE","GB","FR","CA","AU","BR","RU","KR","IT","ES","MX","ID","CH","NL","SG","HK","TR","ZA"];
    const rows = await tradingviewScanCols(codes.map((c) => `TVC:${c}10Y`), ["Perf.3M"], "global");
    const out = new Map<string, number>();
    for (const c of codes) {
      const d = rows.get(`TVC:${c}10Y`);
      if (d && typeof d[0] === "number") out.set(c, d[0]);
    }
    return out;
  });
}

/* ------------------------------ Transforms ------------------------------- */

const clamp01 = (v: number) => Math.min(100, Math.max(0, v));

/** Momentum → bullishness: 0% = 50, saturating at ±(50/slope)%. */
const trend = (pct: number, slope = 2.5) => clamp01(50 + pct * slope);

/** A true PMI (50 = expansion boundary) → bullishness. */
const pmiScore = (v: number) => clamp01(50 + (v - 50) * 6);

/* ------------------------------ Sector specs ----------------------------- */

interface IndicatorSpec {
  label: string;
  weight: number;
  /** Normalized 0-100 bullishness, or null when unavailable. */
  resolve: (code: string) => Promise<number | null>;
}

/** Merged home-sales momentum (new/existing/total, whichever exists). */
async function homeSalesTrend(): Promise<Map<string, number>> {
  const [nhs, ehs, hos] = await Promise.all([econAll("NHS"), econAll("EHS"), econAll("HOS")]);
  const out = new Map<string, number>();
  for (const m of [nhs, ehs, hos]) {
    for (const [c, d] of m) {
      if (d.changePct != null && !out.has(c)) out.set(c, d.changePct);
    }
  }
  return out;
}

const SECTORS: { name: string; components: IndicatorSpec[] }[] = [
  {
    name: "Banks",
    components: [
      // Moderately-high stable rates are best for margins (inverted-U on the
      // peer percentile of the level); a fresh rate cut trims the score.
      { label: "Interest Rate Environment", weight: 0.3,
        resolve: async (c) => {
          const intr = await econAll("INTR");
          const p = percentile(val(intr), c);
          if (p == null) return null;
          const cut = (intr.get(c)?.changePct ?? 0) <= -4 ? 25 : 0;
          return clamp01(100 - Math.abs(p - 55) * 1.5 - cut);
        } },
      { label: "Loan Growth", weight: 0.25,
        resolve: async (c) => percentile(chg(await econAll("PSC")), c) },
      // Steep curve (10Y above policy rate) = healthy lending spread.
      { label: "Yield Curve", weight: 0.2,
        resolve: async (c) => {
          const [ys, intr] = await Promise.all([yieldsAll(), econAll("INTR")]);
          const y = ys.get(c);
          const r = intr.get(c)?.value;
          return y == null || r == null ? null : trend(y - r, 20);
        } },
      { label: "NPA Trend", weight: 0.15,
        resolve: async () => null }, // no public live per-country NPL series
      { label: "GDP Growth", weight: 0.1,
        resolve: async (c) => percentile(val(await econAll("GDPYY")), c) },
    ],
  },
  {
    name: "IT",
    components: [
      // US ISM Manufacturing PMI — global tech demand bellwether.
      { label: "US Economy (ISM PMI)", weight: 0.3,
        resolve: async () => {
          const v = (await econAll("BCOI")).get("US")?.value;
          return v == null ? null : pmiScore(v);
        } },
      { label: "Tech Earnings", weight: 0.25,
        resolve: async () => null }, // no structured live estimates feed
      { label: "Nasdaq Trend", weight: 0.2,
        resolve: async () => {
          const q = (await marketAll()).get(MKT.nasdaq);
          return q?.perf3m == null ? null : trend(q.perf3m, 2.5);
        } },
      { label: "AI Investment", weight: 0.15,
        resolve: async () => null }, // no structured live capex feed
      // Firm USD lifts export-heavy IT revenue; a sliding USD is the risk.
      { label: "USD Trend", weight: 0.1,
        resolve: async () => {
          const q = (await marketAll()).get(MKT.dxy);
          return q?.perf3m == null ? null : trend(q.perf3m, 5);
        } },
    ],
  },
  {
    name: "Real Estate",
    components: [
      // Own mortgage-rate series where published; otherwise the 10Y yield's
      // 3-month direction (mortgage pricing tracks the long bond).
      { label: "Mortgage/Long Rates", weight: 0.35,
        resolve: async (c) => {
          const mr = (await econAll("MR")).get(c);
          if (mr?.changePct != null) return trend(-mr.changePct, 6);
          const p3m = (await yields3mAll()).get(c);
          return p3m == null ? null : trend(-p3m, 4);
        } },
      { label: "Housing Demand", weight: 0.3,
        resolve: async (c) => percentile(await homeSalesTrend(), c) },
      { label: "Construction Activity", weight: 0.2,
        resolve: async (c) => percentile(chg(await econAll("HST")), c) },
      { label: "Employment", weight: 0.15,
        resolve: async (c) => percentile(val(await econAll("UR")), c, true) },
    ],
  },
  {
    name: "Autos",
    components: [
      { label: "Auto Sales", weight: 0.4,
        resolve: async (c) => percentile(chg(await econAll("TVS")), c) },
      { label: "Consumer Confidence", weight: 0.25,
        resolve: async (c) => percentile(chg(await econAll("CCI")), c) },
      { label: "Manufacturing Trend", weight: 0.2,
        resolve: async (c) => percentile(chg(await econAll("BCOI")), c) },
      // Falling steel + fuel = margin tailwind.
      { label: "Raw Material Costs", weight: 0.15,
        resolve: async () => {
          const m = await marketAll();
          const parts = [MKT.steelUs, MKT.steelCn, MKT.brent]
            .map((s) => m.get(s)?.perf3m)
            .filter((v): v is number => v != null);
          if (!parts.length) return null;
          const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
          return trend(-avg, 2.5);
        } },
    ],
  },
  {
    name: "Pharma",
    components: [
      { label: "Drug Pipeline", weight: 0.3,
        resolve: async () => null }, // no structured live approvals feed
      { label: "Healthcare Spending", weight: 0.25,
        resolve: async () => null }, // annual-only, no live series
      { label: "Export Growth", weight: 0.2,
        resolve: async (c) => percentile(chg(await econAll("EXP")), c) },
      // A softer home currency lifts export realizations.
      { label: "Currency (Exports)", weight: 0.15,
        resolve: async (c) => {
          const d = (await fxAll()).get(c);
          return d?.perfY == null ? null : trend(d.perfY, 3);
        } },
      { label: "R&D Spending", weight: 0.1,
        resolve: async () => null },
    ],
  },
  {
    name: "Energy",
    components: [
      { label: "Crude Oil Price", weight: 0.4,
        resolve: async () => {
          const q = (await marketAll()).get(MKT.brent);
          return q?.perf3m == null ? null : trend(q.perf3m, 2.5);
        } },
      // Demand proxy: average of the two manufacturing bellwethers (US ISM,
      // China NBS) — both true 50-centred PMIs.
      { label: "Global Demand (PMI)", weight: 0.25,
        resolve: async () => {
          const b = await econAll("BCOI");
          const us = b.get("US")?.value;
          const cn = b.get("CN")?.value;
          if (us == null && cn == null) return null;
          const vals = [us, cn].filter((v): v is number => v != null);
          return pmiScore(vals.reduce((a, x) => a + x, 0) / vals.length);
        } },
      // US EIA weekly crude stocks change (millions bbl) — the global
      // benchmark inventory print. Draws (negative) are bullish.
      { label: "Inventories (EIA)", weight: 0.15,
        resolve: async () => {
          const v = (await econAll("COSC")).get("US")?.value;
          return v == null ? null : trend(-v, 8);
        } },
      { label: "OPEC Policy", weight: 0.1,
        resolve: async () => null }, // no structured live feed
      { label: "Natural Gas Price", weight: 0.1,
        resolve: async () => {
          const q = (await marketAll()).get(MKT.natgas);
          return q?.perf3m == null ? null : trend(q.perf3m, 2.5);
        } },
    ],
  },
  {
    name: "FMCG",
    components: [
      { label: "Consumer Spending", weight: 0.35,
        resolve: async (c) => percentile(val(await econAll("RSYY")), c) },
      { label: "Inflation", weight: 0.25,
        resolve: async (c) => percentile(val(await econAll("IRYY")), c, true) },
      { label: "Rural Income", weight: 0.2,
        resolve: async () => null }, // no live cross-country series
      { label: "Wage Growth", weight: 0.2,
        resolve: async (c) => percentile(val(await econAll("WG")), c) },
    ],
  },
  {
    name: "Metals",
    components: [
      { label: "Metal Prices", weight: 0.35,
        resolve: async () => {
          const m = await marketAll();
          const parts = [MKT.copper, MKT.steelUs, MKT.steelCn]
            .map((s) => m.get(s)?.perf3m)
            .filter((v): v is number => v != null);
          if (!parts.length) return null;
          const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
          return trend(avg, 2.5);
        } },
      { label: "China Demand (PMI)", weight: 0.3,
        resolve: async () => {
          const v = (await econAll("BCOI")).get("CN")?.value;
          return v == null ? null : pmiScore(v);
        } },
      { label: "Global Mfg (ISM)", weight: 0.2,
        resolve: async () => {
          const v = (await econAll("BCOI")).get("US")?.value;
          return v == null ? null : pmiScore(v);
        } },
      { label: "Construction", weight: 0.15,
        resolve: async (c) => percentile(chg(await econAll("HST")), c) },
    ],
  },
];

/* -------------------------------- Compose -------------------------------- */

function toSentiment(score: number): SectorSentiment {
  return score >= 75 ? "Bullish" : score >= 45 ? "Neutral" : "Bearish";
}

async function buildSector(
  spec: { name: string; components: IndicatorSpec[] },
  code: string,
): Promise<SectorScore> {
  const scores = await Promise.all(
    spec.components.map((s) => s.resolve(code).catch(() => null)),
  );

  const present = spec.components
    .map((s, i) => ({ ...s, score: scores[i] }))
    .filter((s): s is IndicatorSpec & { score: number } => s.score != null);
  const missing = spec.components.filter((_, i) => scores[i] == null).map((s) => s.label);

  const totalW = present.reduce((sum, s) => sum + s.weight, 0);
  const score =
    totalW > 0
      ? present.reduce((sum, s) => sum + s.score * (s.weight / totalW), 0)
      : 50; // nothing resolved — neutral, everything flagged missing

  const rounded = Math.round(clamp01(score));
  return {
    name: spec.name,
    score: rounded,
    sentiment: toSentiment(rounded),
    components: present.map((s) => ({ label: s.label, score: Math.round(s.score), weight: s.weight })),
    missing,
  };
}

type Entry = { at: number; data: SectorImpactData };
const sectorCache = new Map<string, Entry>();
const sectorInflight = new Map<string, Promise<SectorImpactData>>();
const SECTOR_TTL = 10 * 60_000;

/** Compute (or serve cached) live sector impact scores for a country. */
export async function getSectorImpact(code: string): Promise<SectorImpactData> {
  const cc = code.toUpperCase();
  const hot = sectorCache.get(cc);
  if (hot && Date.now() - hot.at < SECTOR_TTL) return hot.data;
  if (sectorInflight.has(cc)) return sectorInflight.get(cc)!;

  const job = (async () => {
    const sectors = await Promise.all(SECTORS.map((s) => buildSector(s, cc)));
    const data: SectorImpactData = { sectors, asOf: new Date().toISOString() };
    sectorCache.set(cc, { at: Date.now(), data });
    return data;
  })().finally(() => sectorInflight.delete(cc));

  sectorInflight.set(cc, job);
  return job;
}

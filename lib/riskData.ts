import { tradingviewScanCols } from "./sources/tradingview";
import { CURRENCY_BY_CODE } from "./macroData";
import { webSearch } from "./chat";

/**
 * Live Country Risk Radar — five risk axes (Currency, Inflation, Geopolitical,
 * Liquidity, Policy), each a weighted composite of REAL indicators:
 *
 *   TradingView Economics  — CPI, core CPI, PPI, policy rate, 10Y yield, M2,
 *                            private credit, government debt, budget balance,
 *                            FX reserves, current account, FX vol/performance
 *   World Bank             — Worldwide Governance Indicators (0-100 scores),
 *                            external debt (% of GNI)
 *   OpenAI web search      — AI news-sentiment geopolitical score (optional,
 *                            only when OPENAI_API_KEY is configured)
 *
 * NORMALIZATION: market/macro indicators are percentile-ranked across the
 * 24-country peer set (fetched in ONE batched call per series), so no
 * hardcoded thresholds; indicators where higher = safer are inverted.
 * World Bank governance scores are already normalized 0-100 by the source.
 *
 * MISSING DATA: a component that can't be resolved is dropped and the
 * remaining weights are renormalized, so the radar never breaks; the axis
 * reports which inputs were unavailable so the UI can flag it.
 *
 * EXTENSIBILITY: an axis is just a list of { label, weight, resolve } —
 * adding a provider means appending one entry.
 */

export interface RiskComponent {
  label: string;
  /** Normalized 0-100 risk contribution (higher = riskier). */
  score: number;
  /** The spec weight (before renormalization over available components). */
  weight: number;
}

export interface RiskAxisData {
  label: string;
  /** Weighted composite, 0-100 (higher = riskier). */
  score: number;
  components: RiskComponent[];
  /** Labels of indicators that were unavailable for this country. */
  missing: string[];
}

export interface RiskRadarData {
  axes: RiskAxisData[];
  asOf: string;
}

/** The peer set every market indicator is percentile-ranked against. */
const CODES = [
  "IN", "US", "CN", "JP", "DE", "GB", "FR", "CA", "AU", "BR", "RU", "KR",
  "IT", "ES", "MX", "ID", "SA", "AE", "CH", "NL", "SG", "HK", "TR", "ZA",
];

/** Official central-bank inflation targets (midpoints), % YoY. */
const INFLATION_TARGET: Record<string, number> = {
  IN: 4, US: 2, CN: 3, JP: 2, DE: 2, GB: 2, FR: 2, CA: 2, AU: 2.5, BR: 3,
  RU: 4, KR: 2, IT: 2, ES: 2, MX: 3, ID: 2.5, SA: 2, AE: 2, CH: 1, NL: 2,
  SG: 2, HK: 2, TR: 5, ZA: 4.5,
};

/** World Bank ISO2 codes match our country codes 1:1. */
const WB_CODES = new Set(CODES);

/* ------------------------------ Small cache ------------------------------ */

type CacheEntry<T> = { at: number; data: T };
const seriesCache = new Map<string, CacheEntry<unknown>>();
const seriesInflight = new Map<string, Promise<unknown>>();

/** Memoize an async producer under `key` for `ttl` ms, with in-flight dedup. */
export function cached<T>(key: string, ttl: number, producer: () => Promise<T>): Promise<T> {
  const hot = seriesCache.get(key);
  if (hot && Date.now() - hot.at < ttl) return Promise.resolve(hot.data as T);
  if (seriesInflight.has(key)) return seriesInflight.get(key) as Promise<T>;
  const job = producer()
    .then((data) => {
      seriesCache.set(key, { at: Date.now(), data });
      return data;
    })
    .catch((e) => {
      // Serve stale on failure rather than blanking the radar.
      if (hot) return hot.data as T;
      throw e;
    })
    .finally(() => seriesInflight.delete(key));
  seriesInflight.set(key, job);
  return job;
}

const ECON_TTL = 10 * 60_000; // market/macro series
const WB_TTL = 24 * 60 * 60_000; // World Bank series update ~yearly
const NEWS_TTL = 30 * 60_000; // AI news sentiment

/* --------------------------- Batched providers --------------------------- */

/** One scanner call: an ECONOMICS series for every peer country. */
export function econAll(suffix: string): Promise<Map<string, { value: number; changePct: number | null }>> {
  return cached(`econ:${suffix}`, ECON_TTL, async () => {
    const tickers = CODES.map((c) => `ECONOMICS:${c}${suffix}`);
    const rows = await tradingviewScanCols(tickers, ["close", "change"], "global");
    const out = new Map<string, { value: number; changePct: number | null }>();
    for (const c of CODES) {
      const d = rows.get(`ECONOMICS:${c}${suffix}`);
      if (d && typeof d[0] === "number") {
        out.set(c, { value: d[0], changePct: typeof d[1] === "number" ? d[1] : null });
      }
    }
    return out;
  });
}

/** FX volatility (monthly) and 1-year performance per country, one call. */
export function fxAll(): Promise<Map<string, { vol: number | null; perfY: number | null }>> {
  return cached("fx:all", ECON_TTL, async () => {
    const sym = (c: string) => (c === "US" ? "TVC:DXY" : `FX_IDC:USD${CURRENCY_BY_CODE[c]}`);
    const rows = await tradingviewScanCols(CODES.map(sym), ["Volatility.M", "Perf.Y"], "global");
    const out = new Map<string, { vol: number | null; perfY: number | null }>();
    for (const c of CODES) {
      const d = rows.get(sym(c));
      if (!d) continue;
      const vol = typeof d[0] === "number" ? d[0] : null;
      let perfY = typeof d[1] === "number" ? d[1] : null;
      // Pairs are USD/local, so +Perf.Y = local depreciation. The US shows DXY
      // (USD strength), so invert it onto the same "depreciation" basis.
      if (c === "US" && perfY != null) perfY = -perfY;
      out.set(c, { vol, perfY });
    }
    return out;
  });
}

/** 10-year government bond yield per country (markets that have one). */
export function yieldsAll(): Promise<Map<string, number>> {
  return cached("yields:all", ECON_TTL, async () => {
    const withYield = CODES.filter((c) => c !== "SA" && c !== "AE");
    const rows = await tradingviewScanCols(withYield.map((c) => `TVC:${c}10Y`), ["close"], "global");
    const out = new Map<string, number>();
    for (const c of withYield) {
      const d = rows.get(`TVC:${c}10Y`);
      if (d && typeof d[0] === "number") out.set(c, d[0]);
    }
    return out;
  });
}

interface WbRow {
  country?: { id?: string };
  date?: string;
  value?: number | null;
}

/* The World Bank API rejects concurrent bursts from one client, so calls are
 * serialized through a small queue with one retry. They're cached for 24h, so
 * the extra latency only ever applies to a cold start. */
let wbQueue: Promise<unknown> = Promise.resolve();
function wbFetch(url: string): Promise<Response> {
  const job = wbQueue.then(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { next: { revalidate: 0 } });
        if (res.ok) return res;
        if (attempt >= 1) throw new Error(`World Bank -> ${res.status}`);
      } catch (e) {
        if (attempt >= 1) throw e;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  });
  wbQueue = job.catch(() => undefined);
  return job;
}

/**
 * Latest non-null World Bank value per peer country, one call per indicator.
 * Queries country/all (the API 502s on some long explicit country lists) and
 * filters to the peer set here.
 */
export function worldBankAll(indicator: string, source?: number): Promise<Map<string, number>> {
  return cached(`wb:${indicator}`, WB_TTL, async () => {
    const year = new Date().getFullYear();
    const src = source ? `source=${source}&` : "";
    const url =
      `https://api.worldbank.org/v2/country/all/indicator/${indicator}` +
      `?${src}format=json&date=${year - 4}:${year}&per_page=5000`;
    const res = await wbFetch(url);
    const json = (await res.json()) as [unknown, WbRow[] | null];
    const out = new Map<string, number>();
    const rows = (json[1] ?? []).filter((r) => typeof r.value === "number");
    // Newest year first, keep the first (latest) value seen per country.
    rows.sort((a, b) => ((a.date ?? "") < (b.date ?? "") ? 1 : -1));
    for (const r of rows) {
      const id = r.country?.id ?? "";
      if (WB_CODES.has(id) && !out.has(id)) out.set(id, r.value as number);
    }
    return out;
  });
}

/** Optional AI news-sentiment score (0-100 risk) — needs OPENAI_API_KEY. */
function newsRisk(code: string, country: string): Promise<number | null> {
  return cached(`news:${code}`, NEWS_TTL, async () => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    const text = await webSearch(
      `Based on this week's news about ${country} (conflicts, sanctions, unrest, elections, security), ` +
        `rate its CURRENT geopolitical risk from 0 (completely calm) to 100 (extreme crisis). ` +
        `Answer with a single integer only.`,
      key,
    );
    const m = text.match(/\d{1,3}/);
    const n = m ? Number(m[0]) : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  });
}

/* ------------------------------ Normalization ---------------------------- */

/**
 * Percentile rank of `code`'s value within the peer set (0-100). With
 * `invert`, higher raw values mean LOWER risk (e.g. reserves growth).
 * Returns null when the country is missing or the peer set is too thin for a
 * meaningful ranking.
 */
export function percentile(values: Map<string, number>, code: string, invert = false): number | null {
  const v = values.get(code);
  if (v == null || values.size < 6) return null;
  const all = [...values.values()];
  const below = all.filter((x) => x < v).length;
  const equal = all.filter((x) => x === v).length;
  const pct = ((below + equal / 2) / all.length) * 100;
  return invert ? 100 - pct : pct;
}

/** Project a per-country map through a transform before ranking. */
function mapValues(values: Map<string, number>, f: (v: number, code: string) => number): Map<string, number> {
  const out = new Map<string, number>();
  for (const [c, v] of values) out.set(c, f(v, c));
  return out;
}

export const val = (m: Map<string, { value: number; changePct: number | null }>) =>
  mapValues(new Map([...m].map(([c, d]) => [c, d.value])), (v) => v);
export const chg = (m: Map<string, { value: number; changePct: number | null }>) => {
  const out = new Map<string, number>();
  for (const [c, d] of m) if (d.changePct != null) out.set(c, d.changePct);
  return out;
};

/* ------------------------------- Axis specs ------------------------------ */

interface ComponentSpec {
  label: string;
  weight: number;
  resolve: (code: string, country: string) => Promise<number | null>;
}

const AXES: { label: string; components: ComponentSpec[] }[] = [
  {
    label: "Currency",
    components: [
      { label: "FX Volatility", weight: 0.35,
        resolve: async (c) => {
          const fx = await fxAll();
          const vols = new Map<string, number>();
          for (const [k, d] of fx) if (d.vol != null) vols.set(k, d.vol);
          return percentile(vols, c);
        } },
      { label: "Depreciation (1Y)", weight: 0.25,
        resolve: async (c) => {
          const fx = await fxAll();
          const dep = new Map<string, number>();
          for (const [k, d] of fx) if (d.perfY != null) dep.set(k, d.perfY);
          return percentile(dep, c);
        } },
      { label: "FX Reserves Trend", weight: 0.2,
        resolve: async (c) => percentile(chg(await econAll("FER")), c, true) },
      { label: "Current Account", weight: 0.1,
        resolve: async (c) => percentile(val(await econAll("CAG")), c, true) },
      { label: "External Debt", weight: 0.1,
        resolve: async (c) => percentile(await worldBankAll("DT.DOD.DECT.GN.ZS"), c) },
    ],
  },
  {
    label: "Inflation",
    components: [
      { label: "CPI YoY", weight: 0.4,
        resolve: async (c) => percentile(val(await econAll("IRYY")), c) },
      { label: "Core CPI", weight: 0.25,
        resolve: async (c) => percentile(val(await econAll("CIR")), c) },
      { label: "Target Deviation", weight: 0.2,
        resolve: async (c) =>
          percentile(mapValues(val(await econAll("IRYY")), (v, k) => Math.abs(v - (INFLATION_TARGET[k] ?? 2))), c) },
      { label: "PPI YoY", weight: 0.1,
        resolve: async (c) => percentile(val(await econAll("PPIYY")), c) },
      { label: "Inflation Expectations", weight: 0.05,
        resolve: async (c) => percentile(val(await econAll("IE")), c) },
    ],
  },
  {
    label: "Geopolitical",
    components: [
      // World Bank WGI scores: higher = MORE stable, so rank inverted.
      { label: "Political Stability", weight: 0.45,
        resolve: async (c) => percentile(await worldBankAll("GOV_WGI_PV.SC", 3), c, true) },
      { label: "Voice & Accountability", weight: 0.15,
        resolve: async (c) => percentile(await worldBankAll("GOV_WGI_VA.SC", 3), c, true) },
      { label: "Control of Corruption", weight: 0.15,
        resolve: async (c) => percentile(await worldBankAll("GOV_WGI_CC.SC", 3), c, true) },
      { label: "News Sentiment (AI)", weight: 0.25,
        resolve: (c, country) => newsRisk(c, country) },
    ],
  },
  {
    label: "Liquidity",
    components: [
      { label: "Policy Rate", weight: 0.35,
        resolve: async (c) => percentile(val(await econAll("INTR")), c) },
      { label: "10Y Yield", weight: 0.25,
        resolve: async (c) => percentile(await yieldsAll(), c) },
      { label: "M2 Growth", weight: 0.2,
        resolve: async (c) => percentile(chg(await econAll("M2")), c, true) },
      { label: "Credit Growth", weight: 0.2,
        resolve: async (c) => percentile(chg(await econAll("PSC")), c, true) },
    ],
  },
  {
    label: "Policy",
    components: [
      { label: "Govt Debt/GDP", weight: 0.3,
        resolve: async (c) => percentile(val(await econAll("GDG")), c) },
      { label: "Fiscal Balance", weight: 0.2,
        resolve: async (c) => percentile(val(await econAll("GBP")), c, true) },
      { label: "Govt Effectiveness", weight: 0.2,
        resolve: async (c) => percentile(await worldBankAll("GOV_WGI_GE.SC", 3), c, true) },
      { label: "Regulatory Quality", weight: 0.15,
        resolve: async (c) => percentile(await worldBankAll("GOV_WGI_RQ.SC", 3), c, true) },
      { label: "Rule of Law", weight: 0.15,
        resolve: async (c) => percentile(await worldBankAll("GOV_WGI_RL.SC", 3), c, true) },
    ],
  },
];

/* -------------------------------- Compose -------------------------------- */

async function buildAxis(
  spec: { label: string; components: ComponentSpec[] },
  code: string,
  country: string,
): Promise<RiskAxisData> {
  const scores = await Promise.all(
    spec.components.map((c) => c.resolve(code, country).catch(() => null)),
  );

  const present = spec.components
    .map((c, i) => ({ ...c, score: scores[i] }))
    .filter((c): c is ComponentSpec & { score: number } => c.score != null);
  const missing = spec.components.filter((_, i) => scores[i] == null).map((c) => c.label);

  // Renormalize weights over whatever resolved, so a missing indicator never
  // breaks the axis — it just stops contributing.
  const totalW = present.reduce((s, c) => s + c.weight, 0);
  const score =
    totalW > 0
      ? present.reduce((s, c) => s + c.score * (c.weight / totalW), 0)
      : 50; // no data at all — neutral midpoint, everything flagged missing

  return {
    label: spec.label,
    score: Math.round(Math.min(100, Math.max(0, score))),
    components: present.map((c) => ({
      label: c.label,
      score: Math.round(c.score),
      weight: c.weight,
    })),
    missing,
  };
}

const radarCache = new Map<string, CacheEntry<RiskRadarData>>();
const radarInflight = new Map<string, Promise<RiskRadarData>>();
const RADAR_TTL = 10 * 60_000;

/** Compute (or serve cached) live risk radar for a country. */
export async function getRiskRadar(code: string, country: string): Promise<RiskRadarData> {
  const cc = code.toUpperCase();
  const hot = radarCache.get(cc);
  if (hot && Date.now() - hot.at < RADAR_TTL) return hot.data;
  if (radarInflight.has(cc)) return radarInflight.get(cc)!;

  const job = (async () => {
    const axes = await Promise.all(AXES.map((a) => buildAxis(a, cc, country)));
    const data: RiskRadarData = { axes, asOf: new Date().toISOString() };
    radarCache.set(cc, { at: Date.now(), data });
    return data;
  })().finally(() => radarInflight.delete(cc));

  radarInflight.set(cc, job);
  return job;
}

import { tradingviewScanCols, tradingviewScreen } from "./sources/tradingview";
import { tvQuotes } from "./sources/tvQuote";
import { COUNTRY_SCREENER } from "./countryData";
import { webSearch } from "./chat";

/**
 * Live macro indicators for a country, pulled from the open internet in
 * (near) real time. The resolver is a SOURCE CHAIN — no single provider is
 * authoritative:
 *   1. TradingView Economics feed (fast, structured, all countries)
 *   2. OpenAI web-search extraction (the "whole internet" fallback)
 * More sources drop into `SOURCES` without touching callers. Results are cached
 * for a couple of seconds and de-duped in-flight so 1s client polling (and many
 * concurrent metrics) never hammer upstream.
 *
 * Starts with GDP Growth (YoY, %). Add more indicators to `INDICATORS`.
 */

export interface LiveIndicator {
  /** The headline number, e.g. 7.8 for 7.8% GDP growth. */
  value: number;
  /** % change of the figure vs the previous release, or null. */
  changePct: number | null;
  /** 1-year (YoY) performance of the underlying series, or null. */
  yoyPct: number | null;
  unit: string;
  /** ISO timestamp of when this value was fetched. */
  asOf: string;
  /** Human-readable provenance, e.g. "TradingView Economics". */
  source: string;
  /** Country-specific descriptor for the box, e.g. "RBI Repo Rate". */
  detail?: string;
}

interface IndicatorSpec {
  label: string;
  unit: string;
  decimals: number;
  /** TradingView Economics symbol for a country code (e.g. IN -> ECONOMICS:INGDPYY). */
  tvSymbol: (code: string) => string;
  /** A focused web query used by the fallback source. */
  webQuery: (country: string) => string;
  /** Optional country-specific descriptor shown in the tile (e.g. the exact rate name). */
  detail?: (code: string) => string;
  /** Optional transform of the raw value (e.g. negate a budget balance into a deficit). */
  transform?: (v: number) => number;
  /** Optional bespoke resolver — bypasses the tvSymbol source chain entirely. */
  custom?: (code: string, country: string) => Promise<LiveIndicator | null>;
  /** Optional cache TTL override in ms (slow-moving series can cache longer). */
  ttl?: number;
}

/**
 * The exact benchmark policy rate each central bank sets — shown inside the
 * Policy Rate box. Euro-area members all steer via the ECB. Verified against
 * TradingView's `ECONOMICS:<CC>INTR` series.
 */
/** The local currency each country's FX rate is quoted against USD. */
const CURRENCY_BY_CODE: Record<string, string> = {
  IN: "INR", US: "USD", CN: "CNY", JP: "JPY", DE: "EUR", GB: "GBP",
  FR: "EUR", CA: "CAD", AU: "AUD", BR: "BRL", RU: "RUB", KR: "KRW",
  IT: "EUR", ES: "EUR", MX: "MXN", ID: "IDR", SA: "SAR", AE: "AED",
  CH: "CHF", NL: "EUR", SG: "SGD", HK: "HKD", TR: "TRY", ZA: "ZAR",
};

const POLICY_RATE_NAME: Record<string, string> = {
  IN: "RBI Repo Rate",
  US: "Fed Funds Rate",
  CN: "PBoC Loan Prime Rate",
  JP: "BoJ Policy Rate",
  DE: "ECB Main Refinancing Rate",
  GB: "BoE Bank Rate",
  FR: "ECB Main Refinancing Rate",
  CA: "BoC Overnight Rate",
  AU: "RBA Cash Rate",
  BR: "BCB Selic Rate",
  RU: "CBR Key Rate",
  KR: "BoK Base Rate",
  IT: "ECB Main Refinancing Rate",
  ES: "ECB Main Refinancing Rate",
  MX: "Banxico Target Rate",
  ID: "Bank Indonesia BI-Rate",
  SA: "SAMA Repo Rate",
  AE: "CBUAE Base Rate",
  CH: "SNB Policy Rate",
  NL: "ECB Main Refinancing Rate",
  SG: "MAS SORA",
  HK: "HKMA Base Rate",
  TR: "CBRT 1-Week Repo Rate",
  ZA: "SARB Repo Rate",
};

export const INDICATORS: Record<string, IndicatorSpec> = {
  gdp: {
    label: "GDP Growth",
    unit: "%",
    decimals: 2,
    tvSymbol: (code) => `ECONOMICS:${code.toUpperCase()}GDPYY`,
    webQuery: (country) =>
      `latest ${country} real GDP annual growth rate year-on-year, most recent quarter, percent`,
  },
  inflation: {
    label: "Inflation",
    unit: "%",
    decimals: 2,
    tvSymbol: (code) => `ECONOMICS:${code.toUpperCase()}IRYY`,
    webQuery: (country) =>
      `latest ${country} CPI inflation rate year-on-year, most recent month, percent`,
  },
  policy: {
    label: "Policy Rate",
    unit: "%",
    decimals: 2,
    tvSymbol: (code) => `ECONOMICS:${code.toUpperCase()}INTR`,
    webQuery: (country) =>
      `current ${country} central bank benchmark policy interest rate, latest decision, percent`,
    detail: (code) => POLICY_RATE_NAME[code.toUpperCase()] || "Central Bank Rate",
  },
  deficit: {
    label: "Fiscal Deficit",
    unit: "%",
    decimals: 2,
    // Government budget balance (% of GDP): a deficit is NEGATIVE, a surplus
    // POSITIVE — shown with its sign so the direction is explicit.
    tvSymbol: (code) => `ECONOMICS:${code.toUpperCase()}GBP`,
    webQuery: (country) =>
      `${country} government budget balance as percent of GDP, latest fiscal year`,
  },
  vix: {
    label: "Volatility",
    unit: "",
    decimals: 2,
    tvSymbol: () => "",
    webQuery: (country) => `${country} stock market volatility index current level`,
    custom: (code) => vixData(code),
    detail: (code) => VIX_NAME[code.toUpperCase()] || "Volatility Index",
  },
  indexpe: {
    label: "Index PE",
    unit: "",
    decimals: 1,
    tvSymbol: () => "",
    webQuery: (country) => `${country} benchmark stock index trailing price to earnings ratio`,
    custom: (code) => indexPeData(code),
    ttl: 10 * 60_000, // valuations move slowly — cache 10 min
  },
  indexpb: {
    label: "Index PB",
    unit: "",
    decimals: 2,
    tvSymbol: () => "",
    webQuery: (country) =>
      `${country} benchmark stock market index price to book ratio, current`,
    custom: (code, country) => indexPbData(code, country),
    ttl: 10 * 60_000, // valuations move slowly — cache 10 min
  },
  reserves: {
    label: "FX Reserves",
    unit: "",
    decimals: 0,
    // Fully handled by the bespoke resolver (USD conversion + calendar YoY).
    tvSymbol: () => "",
    webQuery: (country) => `${country} total foreign exchange reserves in US dollars, latest`,
    custom: (code) => reservesData(code),
    ttl: 10 * 60_000, // reserves update ~weekly — cache 10 min
  },
  yield: {
    label: "10Y Yield",
    unit: "%",
    decimals: 2,
    // 10-year government bond yield. All markets that have one use TVC:<CC>10Y.
    // Saudi Arabia and UAE have no standard local 10Y benchmark, so the UI does
    // not request them (they show N/A) rather than surface a dubious figure.
    tvSymbol: (code) => `TVC:${code.toUpperCase()}10Y`,
    webQuery: (country) => `current ${country} 10 year government bond yield percent`,
  },
  fx: {
    label: "FX Rate",
    unit: "",
    decimals: 4,
    // Local currency per 1 USD (USD-base pair). The US "vs USD" is meaningless,
    // so it shows the US Dollar Index (DXY) instead.
    tvSymbol: (code) => {
      const cc = code.toUpperCase();
      if (cc === "US") return "TVC:DXY";
      const ccy = CURRENCY_BY_CODE[cc];
      return ccy ? `FX_IDC:USD${ccy}` : "";
    },
    webQuery: (country) => `current US dollar to ${country} local currency exchange rate`,
    detail: (code) => {
      const cc = code.toUpperCase();
      if (cc === "US") return "US Dollar Index (DXY)";
      const ccy = CURRENCY_BY_CODE[cc];
      return ccy ? `USD/${ccy}` : "vs USD";
    },
  },
};

/* ------------------------------- Sources -------------------------------- */

type Source = (
  code: string,
  country: string,
  spec: IndicatorSpec,
) => Promise<LiveIndicator | null>;

/** Primary: TradingView's Economics feed — one scanner call, structured value. */
const fromTradingView: Source = async (code, _country, spec) => {
  const symbol = spec.tvSymbol(code);
  if (!symbol) return null;
  const rows = await tradingviewScanCols([symbol], ["close", "change", "Perf.Y"], "global");
  const d = rows.get(symbol);
  if (!d || typeof d[0] !== "number") return null;
  const raw = d[0];
  return {
    value: spec.transform ? spec.transform(raw) : raw,
    changePct: typeof d[1] === "number" ? d[1] : null,
    yoyPct: typeof d[2] === "number" ? d[2] : null,
    unit: spec.unit,
    asOf: new Date().toISOString(),
    source: symbol.startsWith("ECONOMICS:") ? "TradingView Economics" : "TradingView",
  };
};

/** Fallback: search the open web and extract the number (needs OPENAI_API_KEY). */
const fromWebSearch: Source = async (_code, country, spec) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const text = await webSearch(spec.webQuery(country), key);
  const raw = extractNumber(text);
  if (raw == null) return null;
  return {
    value: spec.transform ? spec.transform(raw) : raw,
    changePct: null,
    yoyPct: null,
    unit: spec.unit,
    asOf: new Date().toISOString(),
    source: "Web search",
  };
};

const SOURCES: Source[] = [fromTradingView, fromWebSearch];

/** Pull the first signed decimal (optionally a percentage) out of free text. */
function extractNumber(text: string): number | null {
  const m = text.match(/-?\d+(?:\.\d+)?\s*%?/);
  if (!m) return null;
  const n = Number(m[0].replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------- FX reserves (bespoke) ---------------------- */
// Reserves need special handling: TradingView reports them in the country's own
// unit (USD for most, but SAR/AED/EUR/CHF for some), so we read the `currency`
// column and convert to USD via the live FX rate. The YoY change (for colour)
// isn't in the scanner, so we derive it from the economic-calendar release
// history where available.

/** Latest FX reserves converted to USD (absolute dollars), or null. */
async function reservesUsd(code: string): Promise<number | null> {
  const sym = `ECONOMICS:${code.toUpperCase()}FER`;
  const rows = await tradingviewScanCols([sym], ["close", "currency"], "global");
  const d = rows.get(sym);
  if (!d || typeof d[0] !== "number") return null;
  const raw = d[0];
  const ccy = typeof d[1] === "string" && d[1] ? d[1] : "USD";
  if (ccy === "USD") return raw;
  // Convert local-currency reserves to USD: USD = local / (local per USD).
  const fxSym = `FX_IDC:USD${ccy}`;
  const fx = await tradingviewScanCols([fxSym], ["close"], "global");
  const rate = fx.get(fxSym)?.[0];
  if (typeof rate !== "number" || rate <= 0) return null;
  return raw / rate;
}

interface CalEvent {
  date?: string;
  title?: string;
  actual?: number | null;
}

/** YoY % change in reserves from the release calendar, or null if unavailable. */
async function reservesYoY(code: string): Promise<number | null> {
  try {
    const day = 86_400_000;
    const from = new Date(Date.now() - 400 * day).toISOString();
    const to = new Date(Date.now() + day).toISOString();
    const url = `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=${code.toUpperCase()}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Origin: "https://www.tradingview.com" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: CalEvent[] };
    const series = (json.result ?? [])
      .filter(
        (e) =>
          (e.title ?? "").trim().toLowerCase() === "foreign exchange reserves" &&
          typeof e.actual === "number",
      )
      .sort((a, b) => ((a.date ?? "") < (b.date ?? "") ? -1 : 1));
    if (series.length < 13) return null;
    const latest = series[series.length - 1];
    const targetT = new Date(latest.date!).getTime() - 365 * day;
    let yearAgo = series[0];
    let best = Infinity;
    for (const e of series) {
      const diff = Math.abs(new Date(e.date!).getTime() - targetT);
      if (diff < best) {
        best = diff;
        yearAgo = e;
      }
    }
    const base = yearAgo.actual as number;
    if (!base) return null;
    return (((latest.actual as number) - base) / base) * 100;
  } catch {
    return null;
  }
}

async function reservesData(code: string): Promise<LiveIndicator | null> {
  const usd = await reservesUsd(code);
  if (usd == null) return null;
  const yoy = await reservesYoY(code);
  return {
    value: usd,
    changePct: null,
    yoyPct: yoy,
    unit: "",
    asOf: new Date().toISOString(),
    source: "TradingView Economics",
  };
}

/* ------------------------- Volatility index (bespoke) -------------------- */
// Each market's own equity-volatility index. Only a handful of countries
// publish one that's on TradingView; the rest legitimately have none, so their
// tile shows N/A. Uses the universal quote socket (these live on exchanges the
// scanner's "global" screener doesn't cover).

const VIX_SYMBOL: Record<string, string> = {
  US: "TVC:VIX", // CBOE Volatility Index (S&P 500)
  IN: "NSE:INDIAVIX", // India VIX
  AU: "ASX:XVI", // S&P/ASX 200 VIX
  DE: "INDEX:DV1X", // VDAX-NEW (DAX)
  HK: "HSI:VHSI", // HSI Volatility Index
};

const VIX_NAME: Record<string, string> = {
  US: "S&P 500 VIX",
  IN: "India VIX",
  AU: "ASX 200 VIX",
  DE: "VDAX-NEW",
  HK: "HSI Volatility",
};

/** Country codes with a supported volatility index (for the UI to gate on). */
export const VIX_CODES = Object.keys(VIX_SYMBOL);

async function vixData(code: string): Promise<LiveIndicator | null> {
  const sym = VIX_SYMBOL[code.toUpperCase()];
  if (!sym) return null;
  const q = (await tvQuotes([sym])).get(sym);
  if (!q) return null;
  return {
    value: q.price,
    changePct: q.changePct,
    yoyPct: null,
    unit: "",
    asOf: new Date().toISOString(),
    source: "TradingView",
  };
}

/* ------------------- Index P/E & P/B (bespoke) --------------------------- */
// Benchmark index valuations, computed with the standard cap-weighted formulas:
//   Index PE = Σ(market cap) / Σ(earnings),     earnings_i = market_cap_i / PE_i
//   Index PB = Σ(market cap) / Σ(book equity),  book_i     = market_cap_i / PB_i
// over the largest DOMESTIC companies (filtered by country of origin so foreign
// cross-listings — e.g. US megacaps trading in Germany — don't leak in), with
// duplicate share-class / depositary listings collapsed to their primary
// (highest $ volume). If the screener is unavailable, P/B falls back to the
// published index figure extracted from a live web search.

// TradingView's `country` field value for each market code.
const TV_COUNTRY: Record<string, string> = {
  IN: "India", US: "United States", CN: "China", JP: "Japan", DE: "Germany",
  GB: "United Kingdom", FR: "France", CA: "Canada", AU: "Australia", BR: "Brazil",
  RU: "Russia", KR: "South Korea", IT: "Italy", ES: "Spain", MX: "Mexico",
  ID: "Indonesia", SA: "Saudi Arabia", AE: "United Arab Emirates", CH: "Switzerland",
  NL: "Netherlands", SG: "Singapore", HK: "Hong Kong", TR: "Turkey", ZA: "South Africa",
};

/** Collapse share-class / depositary variants to one company key. */
function normCompany(desc: string): string {
  const base = desc
    .toLowerCase()
    .split(/\b(class|deposit|deposito|depositor?y|depositary|adr|gdr|sponsored|series|pfd|preferred|registered|non.?voting)\b/)[0];
  return base.replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The largest domestic companies of a market with their market cap and one
 * price ratio (P/E, P/B, …), deduped by company (primary = highest $ volume).
 */
async function topDomestic(
  code: string,
  ratioColumn: string,
): Promise<{ mcap: number; ratio: number | null }[] | null> {
  const cc = code.toUpperCase();
  const slug = COUNTRY_SCREENER[cc];
  const country = TV_COUNTRY[cc];
  if (!slug || !country) return null;

  const rows = await tradingviewScreen(
    slug,
    ["description", "close", "volume", "market_cap_basic", ratioColumn],
    {
      filter: [
        { left: "type", operation: "equal", right: "stock" },
        // Common stock only: preference shares carry the parent's full market
        // cap but their own (meaningless) price ratios — e.g. Canadian bank
        // "Non-Cum Conv Red Pfd" lines — and would poison the aggregate.
        { left: "subtype", operation: "in_range", right: ["common"] },
        { left: "country", operation: "equal", right: country },
      ],
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      // Deep enough that markets whose companies list on many venues (Germany
      // trades each name on ~11 exchanges) still dedup to a broad universe.
      range: [0, 300],
    },
  );

  // Dedup by company, keeping the primary (highest dollar-volume) listing.
  const best = new Map<string, { dv: number; mcap: number; ratio: number | null }>();
  for (const r of rows) {
    const [desc, close, vol, mcap, ratio] = r.values;
    if (typeof mcap !== "number" || mcap <= 0) continue;
    const key = normCompany(typeof desc === "string" ? desc : "");
    if (!key) continue;
    const dv = (typeof close === "number" ? close : 0) * (typeof vol === "number" ? vol : 0);
    const prev = best.get(key);
    if (!prev || dv > prev.dv) {
      best.set(key, { dv, mcap, ratio: typeof ratio === "number" ? ratio : null });
    }
  }
  return [...best.values()];
}

/**
 * Cap-weighted aggregate: Σ(market cap) / Σ(market cap / ratio_i). Since
 * fundamental_i = mcap_i / ratio_i, this is exactly total market cap divided
 * by total earnings (PE) or total book equity (PB). Companies with a missing,
 * negative or absurd ratio (> maxRatio) are excluded from BOTH sums so the
 * numerator and denominator always cover the same companies.
 */
function capWeightedRatio(
  companies: { mcap: number; ratio: number | null }[],
  maxRatio: number,
): number | null {
  let totalMcap = 0;
  let totalFundamental = 0;
  let n = 0;
  for (const { mcap, ratio } of companies) {
    if (ratio != null && ratio > 0 && ratio < maxRatio) {
      totalMcap += mcap;
      totalFundamental += mcap / ratio;
      n += 1;
    }
  }
  if (totalFundamental <= 0 || n < 5) return null;
  return totalMcap / totalFundamental;
}

async function indexPeData(code: string): Promise<LiveIndicator | null> {
  const companies = await topDomestic(code, "price_earnings_ttm");
  const value = companies ? capWeightedRatio(companies, 300) : null;
  if (value == null) return null;
  return {
    value,
    changePct: null,
    yoyPct: null,
    unit: "",
    asOf: new Date().toISOString(),
    source: "TradingView (cap-weighted, top domestic)",
  };
}

async function indexPbData(code: string, country: string): Promise<LiveIndicator | null> {
  const companies = await topDomestic(code, "price_book_fq");
  const value = companies ? capWeightedRatio(companies, 100) : null;
  if (value != null) {
    return {
      value,
      changePct: null,
      yoyPct: null,
      unit: "",
      asOf: new Date().toISOString(),
      source: "TradingView (Σ market cap / Σ book equity, top domestic)",
    };
  }
  // Screener unavailable — extract the published index P/B from the open web,
  // accepting only values in a plausible P/B band.
  const web = await fromWebSearch(code, country, INDICATORS.indexpb);
  return web && web.value > 0.2 && web.value < 25 ? web : null;
}

/* ------------------------------- Caching -------------------------------- */

const CACHE_TTL = 2000; // ms — de-dupes 1s polling and concurrent metrics
type Entry = { at: number; data: LiveIndicator | null };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<LiveIndicator | null>>();

/** Resolve one indicator for a country, walking the source chain in order. */
export async function getIndicator(
  code: string,
  country: string,
  key: string,
): Promise<LiveIndicator | null> {
  const spec = INDICATORS[key];
  if (!spec || !code) return null;

  const cacheKey = `${key}:${code.toUpperCase()}`;
  const ttl = spec.ttl ?? CACHE_TTL;
  const hot = cache.get(cacheKey);
  if (hot && Date.now() - hot.at < ttl) return hot.data;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey)!;

  const job = (async () => {
    let data: LiveIndicator | null = null;
    if (spec.custom) {
      // Bespoke resolver (e.g. reserves) handles its own fetching.
      try {
        data = await spec.custom(code, country);
      } catch {
        data = null;
      }
    } else {
      for (const source of SOURCES) {
        try {
          data = await source(code, country, spec);
        } catch {
          data = null;
        }
        if (data) break;
      }
    }
    // On a total miss, keep serving the last good value rather than blanking.
    if (!data && hot?.data) data = hot.data;
    // Attach the country-specific descriptor (e.g. "RBI Repo Rate").
    if (data && spec.detail) data = { ...data, detail: spec.detail(code) };
    cache.set(cacheKey, { at: Date.now(), data });
    return data;
  })().finally(() => inflight.delete(cacheKey));

  inflight.set(cacheKey, job);
  return job;
}

/** Resolve several indicators for a country in parallel. */
export async function getIndicators(
  code: string,
  country: string,
  keys: string[],
): Promise<Record<string, LiveIndicator>> {
  const out: Record<string, LiveIndicator> = {};
  await Promise.all(
    keys.map(async (k) => {
      const v = await getIndicator(code, country, k);
      if (v) out[k] = v;
    }),
  );
  return out;
}

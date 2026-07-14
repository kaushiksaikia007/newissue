"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

/* ============================================================================
 * Country Brain — full macro/markets intelligence dashboard.
 *
 * This is the DESIGN layer: a compact, information-dense dashboard laid out to
 * match the "Country Brain – Complete Layout" spec. Every section reads from a
 * single `Brain` model built by `buildBrain(country)`. Right now that model is
 * deterministic mock data so the whole surface renders; wiring each field to a
 * live source is the next step (the "Ask <country> Brain" chat is already live
 * against /api/country/chat).
 * ========================================================================== */

interface Country {
  code: string;
  name: string;
  flag: string;
}

const COUNTRIES: Country[] = [
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "US", name: "USA", flag: "🇺🇸" },
  { code: "CN", name: "China", flag: "🇨🇳" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "RU", name: "Russia", flag: "🇷🇺" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "AE", name: "UAE", flag: "🇦🇪" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "HK", name: "Hong Kong", flag: "🇭🇰" },
  { code: "TR", name: "Turkey", flag: "🇹🇷" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
];

// Markets without a standard local-currency 10Y government bond benchmark —
// their 10Y Yield tile shows N/A instead of a dubious figure.
const NO_YIELD = new Set(["SA", "AE"]);

// Markets that publish an equity-volatility index available on TradingView.
// Others legitimately have none, so their Volatility tile shows N/A.
const VIX_COUNTRIES = new Set(["US", "IN", "AU", "DE", "HK"]);

// Markets with no usable listed-equity data for the cap-weighted Index PE/PB.
const NO_INDEX_VALUATION = new Set(["RU"]);

/* ------------------------------- Sentiment ------------------------------- */

type Tone = "up" | "flat" | "down" | "deepup" | "warn";
type Sentiment =
  | "Strong Bullish"
  | "Bullish"
  | "Neutral"
  | "Bearish"
  | "Strong Bearish";

const toneOf = (s: Sentiment): Tone =>
  s === "Strong Bullish" || s === "Bullish"
    ? "up"
    : s === "Neutral"
    ? "flat"
    : "down";

/* -------------------------------- Model ---------------------------------- */

interface Metric {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  /** When set, this tile is overridden by a live indicator (see useLiveMacro). */
  key?: string;
}
interface Driver {
  label: string;
  detail: string;
  tone: Tone;
}
/* Live sector impact (see /api/country/sectors + lib/sectorData.ts) */
interface SectorComponentData {
  label: string;
  score: number; // 0-100 bullishness
  weight: number;
}
interface SectorLive {
  name: string;
  score: number; // weighted composite 0-100
  sentiment: Sentiment;
  components: SectorComponentData[];
  missing: string[];
}
interface SectorImpactData {
  sectors: SectorLive[];
  asOf: string | null;
}
/* India sector→NSE-index layer (see /api/country/sector-index + lib/sectorIndices.ts) */
interface SectorIndexQuote {
  id: string;
  sector: string;
  indexName: string;
  nseSymbol: string;
  last: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  yearHigh: number;
  yearLow: number;
  pe: number | null;
  pb: number | null;
  divYield: number | null;
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
  perChange1w: number | null;
  perChange30d: number | null;
  perChange365d: number | null;
  live: boolean;
  /** ms timestamp of the last websocket tick (client-side only). */
  tickTs?: number;
}
interface SectorIndexListData {
  sectors: SectorIndexQuote[];
  asOf: string | null;
}
interface SectorNewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
}
interface SectorIndexDetailData {
  detail: SectorIndexQuote | null;
  news: SectorNewsItem[];
  asOf: string | null;
}
interface Forecast {
  horizon: string;
  s: Sentiment;
  conf: number;
}
/* Live risk radar (see /api/country/risk + lib/riskData.ts) */
interface RiskComponentData {
  label: string;
  score: number; // normalized 0-100 (higher = riskier)
  weight: number;
}
interface RiskAxisLive {
  label: string;
  score: number; // weighted composite 0-100
  components: RiskComponentData[];
  missing: string[]; // indicators unavailable for this country
}
interface RiskRadarData {
  axes: RiskAxisLive[];
  asOf: string | null;
}
/* Live upcoming events (see /api/country/events + lib/eventsData.ts) */
interface LiveEvent {
  title: string;
  date: string; // ISO release timestamp
  impact: "High" | "Medium" | "Low";
  source: string | null;
  sourceUrl: string | null;
}
interface EventsData {
  events: LiveEvent[];
  asOf: string | null;
}
interface SectorRank {
  name: string;
  changePct: number;
  spark: number[];
}
interface NewsRow {
  title: string;
  source: string;
  when: string;
  tone: Tone;
}
interface CompareRow {
  metric: string;
  values: string[];
}
interface Correlation {
  label: string;
  value: number; // -1..1
}
interface Opportunity {
  title: string;
  detail: string;
  tone: Tone;
  tag: string;
}
interface FeedItem {
  time: string;
  text: string;
  tone: Tone;
}
interface Conviction {
  buy: number;
  hold: number;
  sell: number;
}

interface Brain {
  country: Country;
  updated: string;
  score: number;
  overall: Sentiment;
  confidence: number;
  summary: string;
  tags: string[];
  drivers: Driver[];
  macro: Metric[];
  forecast: Forecast[];
  ranking: SectorRank[];
  flows: { fiiNet: number; diiNet: number; unit: string };
  news: NewsRow[];
  compare: { headers: string[]; rows: CompareRow[] };
  correlations: Correlation[];
  opportunities: Opportunity[];
  feed: FeedItem[];
  portfolio: Metric[];
  pattern: { title: string; match: number; note: string; series: number[] };
  conviction: Conviction;
  outlookHistory: number[];
}

/* --------------------------- Deterministic mock -------------------------- */
// A tiny seeded generator so each country renders a distinct-but-stable board.

function seeded(code: string) {
  let h = 2166136261;
  for (const ch of code) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
}

const SENTS: Sentiment[] = [
  "Strong Bearish",
  "Bearish",
  "Neutral",
  "Bullish",
  "Strong Bullish",
];

/* Reference peer figures for the comparison table. The two peers shown are
 * always drawn from this list minus the selected country, so a column (and its
 * React key) can never duplicate the selected country's. */
const PEER_STATS: { name: string; growth: string; inflation: string; rate: string; outlook: string }[] = [
  { name: "USA", growth: "2.5%", inflation: "3.1%", rate: "4.50%", outlook: "Neutral" },
  { name: "China", growth: "4.8%", inflation: "0.6%", rate: "3.10%", outlook: "Neutral" },
  { name: "Germany", growth: "1.2%", inflation: "2.4%", rate: "2.15%", outlook: "Neutral" },
];

function buildCompare(
  nm: string,
  between: (a: number, b: number, dp?: number) => number,
  overall: Sentiment,
): { headers: string[]; rows: CompareRow[] } {
  const peers = PEER_STATS.filter((p) => p.name !== nm).slice(0, 2);
  return {
    headers: [nm, ...peers.map((p) => p.name)],
    rows: [
      { metric: "Growth", values: [`${between(5, 8, 1)}%`, ...peers.map((p) => p.growth)] },
      { metric: "Inflation", values: [`${between(3, 5, 1)}%`, ...peers.map((p) => p.inflation)] },
      { metric: "Policy Rate", values: [`${between(5, 7, 2)}%`, ...peers.map((p) => p.rate)] },
      { metric: "Outlook", values: [overall.replace("Strong ", ""), ...peers.map((p) => p.outlook)] },
    ],
  };
}

function buildBrain(country: Country): Brain {
  const r = seeded(country.code);
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const between = (a: number, b: number, dp = 0) => {
    const v = a + r() * (b - a);
    return dp ? Number(v.toFixed(dp)) : Math.round(v);
  };
  const spark = (n = 12) =>
    Array.from({ length: n }, () => between(20, 100));
  const sentByScore = (s: number): Sentiment =>
    s >= 82 ? "Strong Bullish" : s >= 66 ? "Bullish" : s >= 45 ? "Neutral" : s >= 30 ? "Bearish" : "Strong Bearish";

  const score = between(58, 94);
  const overall = sentByScore(score);
  const nm = country.name;

  return {
    country,
    updated: "1 min ago",
    score,
    overall,
    confidence: between(74, 95),
    summary: `${nm} remains one of the strongest large economies. Growth is broad-based, inflation is cooling toward target, and institutional flows stay net positive. Short-term risks center on external rates and currency, while the medium-term structural story stays constructive.`,
    tags: ["Growth Strong", "Inflation Controlled", "Flows Positive", "Rates Stable"],
    drivers: [
      { label: "GDP Growth", detail: "Above trend, broad-based", tone: "up" },
      { label: "Institutional Buying", detail: "Net inflows continue", tone: "up" },
      { label: "Manufacturing", detail: "PMI in expansion", tone: "up" },
      { label: "Falling Inflation", detail: "Easing toward target", tone: "up" },
      { label: "Earnings", detail: "Beats outnumber misses", tone: "up" },
      { label: "Currency", detail: "Range-bound, stable", tone: "flat" },
    ],
    macro: [
      { key: "gdp", label: "GDP Growth", value: "…", sub: "YoY", tone: "up" },
      { key: "inflation", label: "Inflation", value: "…", sub: "CPI", tone: "flat" },
      { key: "policy", label: "Policy Rate", value: "…", sub: "Central bank", tone: "flat" },
      { key: "fx", label: "FX Rate", value: "…", sub: "vs USD", tone: "flat" },
      { key: "yield", label: "10Y Yield", value: NO_YIELD.has(country.code) ? "N/A" : "…", sub: "Govt bond", tone: "flat" },
      { key: "deficit", label: "Fiscal Deficit", value: "…", sub: "of GDP", tone: "flat" },
      { key: "reserves", label: "FX Reserves", value: "…", sub: "Total, USD", tone: "flat" },
      { key: "vix", label: "Volatility", value: VIX_COUNTRIES.has(country.code) ? "…" : "N/A", sub: "VIX", tone: "flat" },
      { key: "indexpe", label: "Index PE", value: NO_INDEX_VALUATION.has(country.code) ? "N/A" : "…", sub: "Trailing", tone: "flat" },
      { key: "indexpb", label: "Index PB", value: NO_INDEX_VALUATION.has(country.code) ? "N/A" : "…", sub: "Price/Book", tone: "flat" },
      { key: "marketcap", label: "Market Cap", value: NO_INDEX_VALUATION.has(country.code) ? "N/A" : "…", sub: "Total", tone: "flat" },
      { key: "account", label: "Current A/C", value: "…", sub: "of GDP", tone: "flat" },
    ],
    forecast: [
      { horizon: "24 Hours", s: pick(SENTS.slice(2)), conf: between(60, 85) },
      { horizon: "7 Days", s: "Bullish", conf: between(65, 85) },
      { horizon: "30 Days", s: "Neutral", conf: between(55, 75) },
      { horizon: "6 Months", s: "Bullish", conf: between(65, 88) },
      { horizon: "1 Year", s: overall, conf: between(70, 92) },
    ],
    ranking: [
      { name: "Banks", changePct: between(1, 4, 2), spark: spark() },
      { name: "Autos", changePct: between(1, 3, 2), spark: spark() },
      { name: "Energy", changePct: between(0.5, 3, 2), spark: spark() },
      { name: "Realty", changePct: between(0, 2, 2), spark: spark() },
      { name: "IT", changePct: between(-1, 1, 2), spark: spark() },
      { name: "Metals", changePct: between(-3, 0, 2), spark: spark() },
    ],
    flows: { fiiNet: between(-4000, 9000), diiNet: between(1000, 8000), unit: "Cr" },
    news: [
      { title: "Institutional inflows extend positive streak", source: "MarketWire", when: "12m", tone: "up" },
      { title: "Inflation eases for a third straight month", source: "EconDesk", when: "48m", tone: "up" },
      { title: "Bond yields tick up on global cues", source: "RatesToday", when: "1h", tone: "down" },
      { title: "Manufacturing PMI holds in expansion", source: "IndexPulse", when: "2h", tone: "up" },
      { title: "Currency steadies within recent range", source: "FXWatch", when: "3h", tone: "flat" },
    ],
    compare: buildCompare(nm, between, overall),
    correlations: [
      { label: "Crude Oil", value: between(-80, -30) / 100 },
      { label: "US 10Y", value: between(-70, -20) / 100 },
      { label: "Gold", value: between(20, 60) / 100 },
      { label: "EM Index", value: between(50, 90) / 100 },
      { label: "USD Index", value: between(-80, -40) / 100 },
    ],
    opportunities: [
      { title: "Banks momentum", detail: "Credit growth + inflows", tone: "up", tag: "Sector" },
      { title: "Duration trade", detail: "Yields near cycle peak", tone: "up", tag: "Rates" },
      { title: "Metals caution", detail: "Global demand softening", tone: "down", tag: "Risk" },
      { title: "FX carry", detail: "Stable currency, high yield", tone: "up", tag: "Macro" },
    ],
    feed: [
      { time: "09:15", text: `${nm} indices open higher on strong flows`, tone: "up" },
      { time: "10:02", text: "Banking stocks lead intraday gains", tone: "up" },
      { time: "11:30", text: "Bond yields inch up after auction", tone: "down" },
      { time: "12:45", text: "AI outlook nudged to Bullish (7-day)", tone: "up" },
      { time: "13:20", text: "Metals underperform on China data", tone: "down" },
    ],
    portfolio: [
      { label: "Overall Impact", value: `+${between(1, 3, 2)}%`, sub: "Est. today", tone: "up" },
      { label: "Best Exposure", value: "Banks", sub: `+${between(2, 4, 1)}%`, tone: "up" },
      { label: "Watch Exposure", value: "Metals", sub: `${between(-3, -1, 1)}%`, tone: "down" },
      { label: "Net Bias", value: overall.replace("Strong ", ""), sub: "Macro-aligned", tone: toneOf(overall) },
    ],
    pattern: {
      title: `Similar to Q4 setups`,
      match: between(78, 94),
      note: "Current macro mix resembles prior pre-rally phases: cooling inflation, positive flows, stable currency.",
      series: Array.from({ length: 16 }, (_, i) => 40 + i * 2 + Math.round(Math.sin(i) * 6) + between(-4, 4)),
    },
    conviction: (() => {
      const buy = between(45, 70);
      const sell = between(8, 25);
      return { buy, sell, hold: Math.max(0, 100 - buy - sell) };
    })(),
    outlookHistory: Array.from({ length: 20 }, (_, i) =>
      Math.max(35, Math.min(95, score - 18 + i * 1.1 + Math.round(Math.sin(i / 2) * 5) + between(-3, 3))),
    ),
  };
}

/* ------------------------------ Formatting ------------------------------- */

const fmtSigned = (n: number) =>
  `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/* ---------------------------- Live indicators ---------------------------- */

interface LiveIndicator {
  value: number;
  changePct: number | null;
  yoyPct: number | null;
  unit: string;
  asOf: string;
  source: string;
  detail?: string;
}

function fmtIndicator(li: LiveIndicator, key?: string): string {
  if (key === "fx") {
    const v = li.value;
    // Rates span 0.87 (USD/EUR) to 18,064 (USD/IDR) — scale decimals by size.
    const d = v >= 1000 ? 0 : v >= 10 ? 2 : 4;
    return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  if (key === "deficit" || key === "account") {
    // Balances — always show the sign (+ surplus, − deficit).
    return `${li.value > 0 ? "+" : ""}${Number(li.value.toFixed(2))}${li.unit}`;
  }
  if (key === "reserves" || key === "marketcap") {
    const v = li.value; // absolute USD
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(0)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
    return `$${Math.round(v)}`;
  }
  if (key === "indexpe") return li.value.toFixed(1);
  if (key === "indexpb") return li.value.toFixed(2);
  return `${Number(li.value.toFixed(2))}${li.unit}`;
}

/**
 * Index P/B valuation bands for a country/market index: lower = cheaper.
 *   <1.0 dark green (Deeply Undervalued) · 1.0–1.5 green (Undervalued) ·
 *   1.5–2.5 yellow (Fairly Valued) · 2.5–3.5 orange (Slightly Overvalued) ·
 *   ≥3.5 red (Overvalued).
 */
function pbBand(v: number): { tone: Tone; label: string } {
  if (v < 1) return { tone: "deepup", label: "Deeply Undervalued" };
  if (v < 1.5) return { tone: "up", label: "Undervalued" };
  if (v < 2.5) return { tone: "flat", label: "Fairly Valued" };
  if (v < 3.5) return { tone: "warn", label: "Slightly Overvalued" };
  return { tone: "down", label: "Overvalued" };
}

/**
 * Colour coding per indicator. For most series higher/positive is favourable
 * (green). Inflation is banded by level: green 0–2%, yellow >2–5%, red >5%.
 */
function toneForMetric(key: string | undefined, li: LiveIndicator, code: string): Tone {
  if (key === "gdp") {
    // Green >4% (strong), yellow >2–4% (moderate), red ≤2% (weak/contraction).
    return li.value > 4 ? "up" : li.value > 2 ? "flat" : "down";
  }
  if (key === "inflation") {
    return li.value > 5 ? "down" : li.value > 2 ? "flat" : "up";
  }
  if (key === "fx") {
    // Colour by the local currency's YoY appreciation vs USD. Pairs are quoted
    // USD/local, so a rising pair means the currency depreciated → invert it.
    // The US shows DXY (already USD strength), so it isn't inverted.
    if (li.yoyPct == null) return "flat";
    const appreciation = code === "US" ? li.yoyPct : -li.yoyPct;
    return appreciation > 5 ? "up" : appreciation < -5 ? "down" : "flat";
  }
  if (key === "reserves") {
    // Colour by YoY change in reserves: green >+10%, yellow ±10%, red <−10%.
    if (li.yoyPct == null) return "flat";
    return li.yoyPct > 10 ? "up" : li.yoyPct < -10 ? "down" : "flat";
  }
  if (key === "yield") {
    // Green <2% (accommodative), yellow 2–5% (normal), red >5% (tight).
    return li.value < 2 ? "up" : li.value > 5 ? "down" : "flat";
  }
  if (key === "deficit") {
    // Budget balance % of GDP: green ≥ −3% (surplus/healthy),
    // yellow −3% to −6% (moderate), red < −6% (high risk).
    return li.value >= -3 ? "up" : li.value >= -6 ? "flat" : "down";
  }
  if (key === "account") {
    // Current account % of GDP: green surplus, yellow mild deficit (to −3%),
    // red beyond — the classic sustainability threshold.
    return li.value > 0 ? "up" : li.value >= -3 ? "flat" : "down";
  }
  if (key === "indexpb") return pbBand(li.value).tone;
  // Policy rate, volatility, P/E and market-cap levels are neutral until a rule is set.
  if (key === "policy" || key === "vix" || key === "indexpe" || key === "marketcap") return "flat";
  return li.value > 0.05 ? "up" : li.value < -0.05 ? "down" : "flat";
}

/**
 * Polls the live macro endpoint every second for the given indicator keys and
 * returns the latest values. Resets when the country changes; keeps the last
 * good value if a poll fails.
 */
function useLiveMacro(code: string, keys: string[], name: string) {
  const keyStr = keys.join(",");
  const [live, setLive] = useState<Record<string, LiveIndicator>>({});

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setLive({});
    const tick = async () => {
      try {
        const r = await fetch(
          `/api/country/macro?code=${code}&name=${encodeURIComponent(name)}&keys=${keyStr}`,
          { cache: "no-store" },
        ).then((res) => res.json());
        if (alive && r?.indicators && Object.keys(r.indicators).length) {
          setLive(r.indicators);
        }
      } catch {
        /* keep last good value */
      }
      if (alive) timer = setTimeout(tick, 1000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [code, keyStr, name]);

  return live;
}

/* =============================== Primitives ============================== */

function Sent({ s }: { s: Sentiment }) {
  return <span className={`cbd-pill ${toneOf(s)}`}>{s}</span>;
}

function Card({
  n,
  title,
  hint,
  span,
  className = "",
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  span?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`cbd-card ${className}`} style={span ? { gridColumn: `span ${span}` } : undefined}>
      <header className="cbd-card-head">
        <span className="cbd-num">{n}</span>
        <h3>{title}</h3>
        {hint && <span className="cbd-hint">{hint}</span>}
      </header>
      <div className="cbd-card-body">{children}</div>
    </section>
  );
}

/* Semicircle score gauge */
function Gauge({ value, tone }: { value: number; tone: Tone }) {
  const r = 74;
  const len = Math.PI * r;
  const off = len * (1 - Math.min(100, Math.max(0, value)) / 100);
  return (
    <svg viewBox="0 0 180 100" className="cbd-gauge" aria-hidden>
      <path d="M16,92 A74,74 0 0 1 164,92" className="cbd-gauge-bg" />
      <path
        d="M16,92 A74,74 0 0 1 164,92"
        className={`cbd-gauge-fg ${tone}`}
        style={{ strokeDasharray: len, strokeDashoffset: off }}
      />
    </svg>
  );
}

/* ------------------------- Live risk radar ------------------------------- */

/** Poll the live risk endpoint (server caches 10 min; poll picks up syncs). */
function useLiveRisk(code: string, name: string): RiskRadarData | null {
  const [data, setData] = useState<RiskRadarData | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setData(null);
    const tick = async () => {
      try {
        const r = await fetch(
          `/api/country/risk?code=${code}&name=${encodeURIComponent(name)}`,
          { cache: "no-store" },
        ).then((res) => res.json());
        if (alive && r?.axes?.length) setData(r);
      } catch {
        /* keep last good radar */
      }
      if (alive) timer = setTimeout(tick, 60_000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [code, name]);
  return data;
}

/** Poll the live sector-impact endpoint (server caches 10 min). */
function useLiveSectors(code: string): SectorImpactData | null {
  const [data, setData] = useState<SectorImpactData | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setData(null);
    const tick = async () => {
      try {
        const r = await fetch(`/api/country/sectors?code=${code}`, { cache: "no-store" }).then(
          (res) => res.json(),
        );
        if (alive && r?.sectors?.length) setData(r);
      } catch {
        /* keep last good scores */
      }
      if (alive) timer = setTimeout(tick, 60_000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [code]);
  return data;
}

/**
 * Tick-by-tick stream of the India sector→index list. Every websocket tick the
 * server receives is pushed here over SSE the instant it lands; a full NSE
 * snapshot (OHLC, 52W, P/E, breadth) refreshes the rest every minute.
 * EventSource reconnects automatically if the connection drops. IN only.
 */
function useSectorIndexStream(code: string): SectorIndexListData | null {
  const [data, setData] = useState<SectorIndexListData | null>(null);
  useEffect(() => {
    setData(null);
    if (code !== "IN") return;
    const es = new EventSource(`/api/country/sector-index/stream?code=${code}`);
    es.addEventListener("snapshot", (e) => {
      try {
        const r = JSON.parse((e as MessageEvent).data) as SectorIndexListData;
        if (!r?.sectors?.length) return;
        // Keep newer tick prices if a stale-cached snapshot arrives mid-stream.
        setData((prev) => {
          if (!prev) return r;
          const old = new Map(prev.sectors.map((s) => [s.id, s]));
          return {
            ...r,
            sectors: r.sectors.map((s) => {
              const o = old.get(s.id);
              return o?.tickTs && o.tickTs > Date.now() - 10_000
                ? { ...s, last: o.last, change: o.change, changePct: o.changePct, live: true, tickTs: o.tickTs }
                : s;
            }),
          };
        });
      } catch {
        /* malformed frame — ignore */
      }
    });
    es.addEventListener("tick", (e) => {
      try {
        const t = JSON.parse((e as MessageEvent).data) as {
          id: string;
          last: number;
          change: number;
          changePct: number;
          ts: number;
        };
        setData((prev) =>
          prev
            ? {
                ...prev,
                sectors: prev.sectors.map((s) =>
                  s.id === t.id
                    ? {
                        ...s,
                        last: t.last,
                        change: t.change,
                        changePct: t.changePct,
                        high: Math.max(s.high, t.last),
                        low: s.low > 0 ? Math.min(s.low, t.last) : s.low,
                        live: true,
                        tickTs: t.ts,
                      }
                    : s,
                ),
              }
            : prev,
        );
      } catch {
        /* malformed frame — ignore */
      }
    });
    return () => es.close();
  }, [code]);
  return data;
}

/** Poll one sector's full index detail + live headlines while a popup is open. */
function useSectorIndexDetail(code: string, id: string | null): SectorIndexDetailData | null {
  const [data, setData] = useState<SectorIndexDetailData | null>(null);
  useEffect(() => {
    setData(null);
    if (!id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`/api/country/sector-index?code=${code}&id=${id}`, {
          cache: "no-store",
        }).then((res) => res.json());
        if (alive && r?.detail) setData(r);
      } catch {
        /* keep last good detail */
      }
      if (alive) timer = setTimeout(tick, 30_000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [code, id]);
  return data;
}

/** Poll the upcoming-events endpoint (server caches 30 min). */
function useLiveEvents(code: string): EventsData | null {
  const [data, setData] = useState<EventsData | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setData(null);
    const tick = async () => {
      try {
        const r = await fetch(`/api/country/events?code=${code}`, { cache: "no-store" }).then(
          (res) => res.json(),
        );
        if (alive && r?.events?.length) setData(r);
      } catch {
        /* keep last good list */
      }
      if (alive) timer = setTimeout(tick, 10 * 60_000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [code]);
  return data;
}

/** Compact host for a source link ("https://www.bls.gov" -> "bls.gov"). */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "Today 18:30" / "Tomorrow" / "In 12 days · Jul 25". */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return `Today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  const days = Math.round(
    (new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86_400_000,
  );
  return `In ${days} days · ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

/** Hover breakdown for a sector row (native tooltip). */
function sectorTitle(s: SectorLive): string {
  return [
    `${s.name} — ${s.score}/100 (${s.sentiment})`,
    ...s.components.map((c) => `${c.label}: ${c.score} × ${Math.round(c.weight * 100)}%`),
  ].join("\n");
}

/** Risk band → colour + wording (0 safest, 100 riskiest). */
function riskBand(score: number): { color: string; label: string } {
  if (score <= 20) return { color: "#0ca678", label: "Very Low Risk" };
  if (score <= 40) return { color: "#38d39f", label: "Low Risk" };
  if (score <= 60) return { color: "#f5c451", label: "Moderate Risk" };
  if (score <= 80) return { color: "#ff9f45", label: "High Risk" };
  return { color: "#ff5d5d", label: "Extreme Risk" };
}

/** Smoothly tween an array of values whenever the target changes. */
function useTweened(target: number[], ms = 700): number[] {
  const [vals, setVals] = useState(target);
  const current = useRef(target);
  const key = target.join(",");
  useEffect(() => {
    const from = current.current.length === target.length ? current.current : target;
    const to = target;
    let raf = 0;
    const t0 = performance.now();
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = ease(p);
      const cur = to.map((v, i) => from[i] + (v - from[i]) * e);
      current.current = cur;
      setVals(cur);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);
  return vals;
}

function agoLabel(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return mins < 1 ? "just now" : `${mins} min ago`;
}

/** Animated radar with per-axis hover tooltips and risk-banded colouring. */
function RiskRadar({ axes, asOf }: { axes: RiskAxisLive[]; asOf: string | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const levels = useTweened(axes.map((a) => a.score));
  const cx = 100, cy = 96, R = 74, n = axes.length;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, rad: number): [number, number] => [
    cx + rad * Math.cos(ang(i)),
    cy + rad * Math.sin(ang(i)),
  ];
  const ring = (frac: number) => axes.map((_, i) => pt(i, R * frac).join(",")).join(" ");
  const shape = levels.map((v, i) => pt(i, (R * Math.min(100, Math.max(0, v))) / 100).join(",")).join(" ");
  const avg = axes.reduce((s, a) => s + a.score, 0) / Math.max(1, n);
  const band = riskBand(avg);
  const tipAxis = hover != null ? axes[hover] : null;
  const tipPos = hover != null ? pt(hover, (R * axes[hover].score) / 100) : null;

  return (
    <div className="cbd-radar-wrap">
      <svg viewBox="0 0 200 200" className="cbd-radar">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={ring(f)} className="cbd-radar-grid" />
        ))}
        {axes.map((_, i) => {
          const [x, y] = pt(i, R);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="cbd-radar-grid" />;
        })}
        <polygon
          points={shape}
          className="cbd-radar-shape live"
          style={{ fill: `${band.color}2E`, stroke: band.color }}
        />
        {axes.map((a, i) => {
          const [x, y] = pt(i, (R * levels[i]) / 100);
          const c = riskBand(a.score).color;
          return (
            <circle
              key={a.label}
              cx={x}
              cy={y}
              r={hover === i ? 4.5 : 3}
              className="cbd-radar-dot"
              style={{ fill: c }}
            />
          );
        })}
        {axes.map((a, i) => {
          const [x, y] = pt(i, R + 12);
          return (
            <text key={a.label} x={x} y={y} className="cbd-radar-label" textAnchor="middle" dominantBaseline="middle">
              {a.label}
            </text>
          );
        })}
        {/* Invisible hover targets (drawn last so they win hit-testing). */}
        {axes.map((a, i) => {
          const [x, y] = pt(i, (R * a.score) / 100);
          return (
            <circle
              key={a.label}
              cx={x}
              cy={y}
              r={13}
              className="cbd-radar-hit"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>
      {tipAxis && tipPos && (
        <div
          className="cbd-radar-tip"
          style={{ left: `${(tipPos[0] / 200) * 100}%`, top: `${(tipPos[1] / 200) * 100}%` }}
        >
          <b>{tipAxis.label} Risk</b>
          <div className="cbd-radar-tip-score" style={{ color: riskBand(tipAxis.score).color }}>
            Score: {tipAxis.score} · {riskBand(tipAxis.score).label}
          </div>
          {tipAxis.components.map((c) => (
            <div key={c.label} className="cbd-radar-tip-row">
              <span>{c.label}</span>
              <b>{c.score}</b>
            </div>
          ))}
          <div className="cbd-radar-tip-upd">Updated {agoLabel(asOf)}</div>
        </div>
      )}
    </div>
  );
}

/* Conviction donut */
function Donut({ c }: { c: Conviction }) {
  const r = 46, C = 2 * Math.PI * r;
  const segs = [
    { v: c.buy, cls: "up" },
    { v: c.hold, cls: "flat" },
    { v: c.sell, cls: "down" },
  ];
  let acc = 0;
  return (
    <svg viewBox="0 0 120 120" className="cbd-donut" aria-hidden>
      <circle cx="60" cy="60" r={r} className="cbd-donut-track" />
      {segs.map((s, i) => {
        const dash = (s.v / 100) * C;
        const el = (
          <circle
            key={i}
            cx="60"
            cy="60"
            r={r}
            className={`cbd-donut-seg ${s.cls}`}
            style={{ strokeDasharray: `${dash} ${C - dash}`, strokeDashoffset: -acc }}
          />
        );
        acc += dash;
        return el;
      })}
      <text x="60" y="56" className="cbd-donut-big" textAnchor="middle">{c.buy}%</text>
      <text x="60" y="72" className="cbd-donut-sm" textAnchor="middle">Buy</text>
    </svg>
  );
}

/* Sparkline / line */
function Spark({ data, tone = "up", h = 22, w = 64 }: { data: number[]; tone?: Tone; h?: number; w?: number }) {
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / rng) * h}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`cbd-spark ${tone}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} />
    </svg>
  );
}

function AreaLine({ data }: { data: number[] }) {
  const w = 300, h = 90, pad = 4;
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const x = (i: number) => pad + (i / (data.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / rng) * (h - pad * 2);
  const line = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="cbd-arealine" preserveAspectRatio="none" aria-hidden>
      <polygon points={area} className="cbd-arealine-fill" />
      <polyline points={line} className="cbd-arealine-stroke" />
    </svg>
  );
}

/* ------------------------ Sector index detail popup ----------------------- */

const fmtIN = (n: number, d = 2) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

/** "14:23:05.412" — millisecond-precision stamp of the last websocket tick. */
const tickStamp = (ts: number) => {
  const d = new Date(ts);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

/** "2 h ago" / "35 min ago" / "Jul 12" from an RSS pubDate. */
function newsAgo(pubDate: string): string {
  const t = new Date(pubDate).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}

function PerfChip({ label, value }: { label: string; value: number | null }) {
  return (
    <div className={`cbd-si-perf ${value == null ? "" : value >= 0 ? "up" : "down"}`}>
      <span>{label}</span>
      <b>{value == null ? "—" : fmtPct(value)}</b>
    </div>
  );
}

function SectorIndexModal({
  code,
  sector,
  onClose,
}: {
  code: string;
  sector: SectorIndexQuote;
  onClose: () => void;
}) {
  const data = useSectorIndexDetail(code, sector.id);
  // Detail supplies the slow-moving fields (P/E, breadth, news); the streamed
  // `sector` prop overrides price fields so the popup ticks in real time.
  const base = data?.detail ?? sector;
  const d: SectorIndexQuote = {
    ...base,
    last: sector.last,
    change: sector.change,
    changePct: sector.changePct,
    high: Math.max(base.high, sector.high),
    low: base.low > 0 && sector.low > 0 ? Math.min(base.low, sector.low) : base.low || sector.low,
    live: sector.live || base.live,
    tickTs: sector.tickTs,
  };
  const tone = d.changePct >= 0 ? "up" : "down";

  // Flash the price green/red on every tick so movement is visible.
  const prevLast = useRef(d.last);
  const [flash, setFlash] = useState("");
  useEffect(() => {
    if (d.last === prevLast.current) return;
    setFlash(d.last > prevLast.current ? "flash-up" : "flash-down");
    prevLast.current = d.last;
    const t = setTimeout(() => setFlash(""), 500);
    return () => clearTimeout(t);
  }, [d.last]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const stats: { label: string; value: string }[] = [
    { label: "Open", value: fmtIN(d.open) },
    { label: "Day High", value: fmtIN(d.high) },
    { label: "Day Low", value: fmtIN(d.low) },
    { label: "Prev Close", value: fmtIN(d.previousClose) },
    { label: "52W High", value: fmtIN(d.yearHigh) },
    { label: "52W Low", value: fmtIN(d.yearLow) },
    { label: "P/E", value: d.pe == null ? "—" : fmtIN(d.pe) },
    { label: "P/B", value: d.pb == null ? "—" : fmtIN(d.pb) },
    { label: "Div Yield", value: d.divYield == null ? "—" : `${fmtIN(d.divYield)}%` },
  ];

  return (
    <div className="modal-overlay cbd-si-overlay" onClick={onClose}>
      <div className="modal cbd-si-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head cbd-si-head">
          <div>
            <div className="modal-title cbd-si-title">
              {d.sector} <span className="cbd-si-index">· {d.indexName}</span>
            </div>
            <div className="modal-sub cbd-si-sub">
              NSE · {d.nseSymbol}
              {d.live && <span className="cbd-si-live"><i className="cbd-live-dot" /> LIVE</span>}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body cbd-si-body">
          <div className="cbd-si-cols">
            <div className="cbd-si-left">
              <div className="cbd-si-hero">
                <b className={`cbd-si-price ${tone} ${flash}`}>{fmtIN(d.last)}</b>
                <span className={`cbd-si-chg ${tone}`}>
                  {d.change >= 0 ? "+" : "−"}{fmtIN(Math.abs(d.change))} ({fmtPct(d.changePct)})
                </span>
                <span className="cbd-si-asof">
                  {d.tickTs ? `tick ${tickStamp(d.tickTs)}` : data?.asOf ? `updated ${agoLabel(data.asOf)}` : ""}
                </span>
              </div>

              <div className="cbd-si-perfrow">
                <PerfChip label="1W" value={d.perChange1w} />
                <PerfChip label="1M" value={d.perChange30d} />
                <PerfChip label="1Y" value={d.perChange365d} />
                {d.advances != null && d.declines != null && (
                  <div className="cbd-si-perf breadth">
                    <span>Breadth</span>
                    <b>
                      <em className="up">▲ {d.advances}</em> / <em className="down">▼ {d.declines}</em>
                    </b>
                  </div>
                )}
              </div>

              <div className="cbd-si-stats">
                {stats.map((s) => (
                  <div key={s.label} className="cbd-si-stat">
                    <span>{s.label}</span>
                    <b>{s.value}</b>
                  </div>
                ))}
              </div>
            </div>

            <div className="cbd-si-right">
              <div className="cbd-si-news-head">
                <span>Top {d.sector} News</span>
                <small>Live · Google News</small>
              </div>
              {data ? (
                data.news.length ? (
                  <ul className="cbd-si-news">
                    {data.news.map((n) => (
                      <li key={n.link || n.title}>
                        <a href={n.link} target="_blank" rel="noopener noreferrer">
                          <b>{n.title}</b>
                          <small>
                            {n.source}
                            {newsAgo(n.publishedAt) && <> · {newsAgo(n.publishedAt)}</>}
                          </small>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="cbd-si-news-empty">No recent headlines for this sector.</div>
                )
              ) : (
                <div className="cbd-si-news-empty">Loading live headlines…</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =============================== Dashboard ============================== */

export default function CountryBrain() {
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const brain = useMemo(() => buildBrain(country), [country]);
  const liveKeys = useMemo(
    () => [
      "gdp", "inflation", "policy", "fx", "deficit", "reserves", "account",
      ...(NO_YIELD.has(country.code) ? [] : ["yield"]),
      ...(VIX_COUNTRIES.has(country.code) ? ["vix"] : []),
      ...(NO_INDEX_VALUATION.has(country.code) ? [] : ["indexpe", "indexpb", "marketcap"]),
    ],
    [country.code],
  );
  const live = useLiveMacro(country.code, liveKeys, country.name);
  const risk = useLiveRisk(country.code, country.name);
  const sectorsLive = useLiveSectors(country.code);
  const sectorIndices = useSectorIndexStream(country.code);
  const [openSectorId, setOpenSectorId] = useState<string | null>(null);
  // Live lookup: the modal re-renders on every tick of the streamed list.
  const openSector = openSectorId
    ? sectorIndices?.sectors.find((s) => s.id === openSectorId) ?? null
    : null;
  const eventsLive = useLiveEvents(country.code);

  // Country switch closes any open sector popup.
  useEffect(() => setOpenSectorId(null), [country.code]);

  return (
    <div className="wrap cbd-wrap">
      <BrainHeader country={country} brain={brain} onPick={setCountry} />

      <div className="cbd-grid">
        {/* Row A — headline: Score | Summary | Drivers */}
        <Card n={1} title="Macro Score" hint="0–100 outlook" span={3} className="cbd-score-card">
          <div className="cbd-score">
            <Gauge value={brain.score} tone={toneOf(brain.overall)} />
            <div className="cbd-score-mid">
              <b>{brain.score}</b>
              <span>/100</span>
            </div>
          </div>
          <div className="cbd-score-foot">
            <Sent s={brain.overall} />
            <div className="cbd-conf">
              <span>Confidence</span>
              <div className="cbd-bar"><i style={{ width: `${brain.confidence}%` }} /></div>
              <b>{brain.confidence}%</b>
            </div>
          </div>
        </Card>

        <Card n={2} title="AI Summary" hint={`What's happening in ${country.name}`} span={6}>
          <p className="cbd-summary">{brain.summary}</p>
          <div className="cbd-tags">
            {brain.tags.map((t) => (
              <span key={t} className="cbd-tag">{t}</span>
            ))}
          </div>
        </Card>

        <Card n={3} title="AI Drivers" hint="Why" span={3}>
          <ul className="cbd-drivers">
            {brain.drivers.map((d) => (
              <li key={d.label}>
                <span className={`cbd-arrow ${d.tone}`}>{d.tone === "up" ? "▲" : d.tone === "down" ? "▼" : "▬"}</span>
                <span className="cbd-driver-main">
                  <b>{d.label}</b>
                  <small>{d.detail}</small>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Row B — two tall cards: Live Macro | Risk Radar */}
        <Card n={4} title="Live Macro Dashboard" hint="Realtime · 1s" span={8}>
          <div className="cbd-metrics">
            {brain.macro.map((m) => {
              const li = m.key ? live[m.key] : undefined;
              const value = li ? fmtIndicator(li, m.key) : m.value;
              const tone = li ? toneForMetric(m.key, li, country.code) : m.tone;
              const sub = m.key === "indexpb" && li ? pbBand(li.value).label : li?.detail ?? m.sub;
              const title = li ? `${li.source} · ${new Date(li.asOf).toLocaleTimeString()}` : undefined;
              return (
                <div key={m.label} className={`cbd-metric${li ? " live" : ""}`} title={title}>
                  <span className="cbd-metric-label">
                    {m.label}
                    {li && <i className="cbd-live-dot" />}
                  </span>
                  <span className={`cbd-metric-val ${tone ?? ""}`}>{value}</span>
                  {sub && <span className="cbd-metric-sub">{sub}</span>}
                </div>
              );
            })}
          </div>
        </Card>

        <Card
          n={5}
          title="Risk Radar"
          hint={risk ? `Live · updated ${agoLabel(risk.asOf)}` : "Computing…"}
          span={4}
          className="cbd-radar-card"
        >
          {risk ? (
            <>
              <RiskRadar axes={risk.axes} asOf={risk.asOf} />
              <div className="cbd-risk-legend">
                {risk.axes.map((a) => (
                  <span key={a.label}>
                    <i style={{ background: riskBand(a.score).color }} />
                    {a.label} {a.score}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="cbd-radar-loading">Computing live risk…</div>
          )}
        </Card>

        {/* Row C — three even cards */}
        <Card
          n={6}
          title="Sector Impact"
          hint={
            country.code === "IN"
              ? sectorIndices
                ? "NSE · streaming ticks · click a sector"
                : "Loading…"
              : sectorsLive
              ? "Live · scored 0-100"
              : "Computing…"
          }
          span={4}
        >
          {country.code === "IN" ? (
            sectorIndices ? (
              <div className="cbd-sectors">
                {sectorIndices.sectors.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="cbd-sector-row cbd-sector-btn"
                    title={`${s.indexName} — click for live index details & news`}
                    onClick={() => setOpenSectorId(s.id)}
                  >
                    <span>{s.sector}</span>
                    <span className="cbd-sector-open">›</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="cbd-radar-loading">Loading NSE sector indices…</div>
            )
          ) : sectorsLive ? (
            <div className="cbd-sectors">
              {sectorsLive.sectors.map((s) => (
                <div key={s.name} className="cbd-sector-row" title={sectorTitle(s)}>
                  <span>{s.name}</span>
                  <span className="cbd-sector-right">
                    <b className="cbd-sector-score">{s.score}</b>
                    <Sent s={s.sentiment} />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="cbd-radar-loading">Computing live sector scores…</div>
          )}
        </Card>

        <Card n={7} title="AI Forecast" hint="By horizon" span={4}>
          <div className="cbd-forecast">
            {brain.forecast.map((f) => (
              <div key={f.horizon} className="cbd-fc-row">
                <span className="cbd-fc-h">{f.horizon}</span>
                <Sent s={f.s} />
                <span className="cbd-fc-conf">{f.conf}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card
          n={8}
          title="Upcoming Events"
          hint={eventsLive ? "Live calendar · top 5" : "Loading…"}
          span={4}
        >
          {eventsLive ? (
            <ul className="cbd-events">
              {eventsLive.events.map((e) => (
                <li key={`${e.title}${e.date}`}>
                  <span className="cbd-ev-main">
                    <b>{e.title}</b>
                    <small>{whenLabel(e.date)}</small>
                  </span>
                  {e.sourceUrl ? (
                    <a
                      className="cbd-ev-src"
                      href={e.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={e.source ?? e.sourceUrl}
                    >
                      {hostLabel(e.sourceUrl)} ↗
                    </a>
                  ) : (
                    <span className="cbd-ev-src plain">{e.source ?? "—"}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="cbd-radar-loading">Loading calendar…</div>
          )}
        </Card>

        {/* Row D — three even cards */}
        <Card n={9} title="Sector Ranking" hint="Momentum" span={4}>
          <ol className="cbd-ranking">
            {brain.ranking.map((s, i) => (
              <li key={s.name}>
                <span className="cbd-rank-i">{i + 1}</span>
                <span className="cbd-rank-name">{s.name}</span>
                <Spark data={s.spark} tone={s.changePct >= 0 ? "up" : "down"} />
                <span className={`cbd-rank-pct ${s.changePct >= 0 ? "up" : "down"}`}>{fmtPct(s.changePct)}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card n={10} title="News Intelligence" hint="Sentiment-tagged" span={4}>
          <ul className="cbd-news">
            {brain.news.map((nw) => (
              <li key={nw.title}>
                <i className={`cbd-news-dot ${nw.tone}`} />
                <span className="cbd-news-main">
                  <b>{nw.title}</b>
                  <small>{nw.source} · {nw.when}</small>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card n={11} title="AI Conviction Meter" hint="Aggregate" span={4} className="cbd-conv-card">
          <Donut c={brain.conviction} />
          <div className="cbd-conv-legend">
            <span><i className="up" /> Buy {brain.conviction.buy}%</span>
            <span><i className="flat" /> Hold {brain.conviction.hold}%</span>
            <span><i className="down" /> Sell {brain.conviction.sell}%</span>
          </div>
        </Card>


        {/* Row E — Ask (tall) | Opportunities (fills to match) */}
        <Card n={12} title={`Ask ${country.name} Brain`} hint="Live AI" span={6} className="cbd-ask-card">
          <AskBrain country={country} />
        </Card>

        <Card n={13} title="AI Opportunity Scanner" hint="Today" span={6}>
          <div className="cbd-opps">
            {brain.opportunities.map((o) => (
              <div key={o.title} className={`cbd-opp ${o.tone}`}>
                <span className="cbd-opp-tag">{o.tag}</span>
                <b>{o.title}</b>
                <small>{o.detail}</small>
              </div>
            ))}
          </div>
        </Card>

        {/* Row F — three even cards */}
        <Card n={14} title="Country Comparison" hint="Peers" span={4}>
          <table className="cbd-compare">
            <thead>
              <tr>
                <th></th>
                {brain.compare.headers.map((h, i) => (
                  <th key={h} className={i === 0 ? "me" : ""}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {brain.compare.rows.map((row) => (
                <tr key={row.metric}>
                  <td className="cbd-cmp-label">{row.metric}</td>
                  {row.values.map((v, i) => (
                    <td key={i} className={i === 0 ? "me" : ""}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card n={15} title="Correlation Map" hint="30-day" span={4}>
          <ul className="cbd-corr">
            {brain.correlations.map((c) => (
              <li key={c.label}>
                <span>{c.label}</span>
                <div className="cbd-corr-bar">
                  <i
                    className={c.value >= 0 ? "up" : "down"}
                    style={{ width: `${Math.abs(c.value) * 50}%`, [c.value >= 0 ? "left" : "right"]: "50%" } as React.CSSProperties}
                  />
                </div>
                <b className={c.value >= 0 ? "up" : "down"}>{c.value.toFixed(2)}</b>
              </li>
            ))}
          </ul>
        </Card>

        <Card n={16} title="Capital Flows" hint="Institutional" span={4}>
          <div className="cbd-flows">
            <FlowRow label="FII / FPI" value={brain.flows.fiiNet} unit={brain.flows.unit} />
            <FlowRow label="DII" value={brain.flows.diiNet} unit={brain.flows.unit} />
            <div className="cbd-flow-net">
              <span>Net</span>
              <b className={brain.flows.fiiNet + brain.flows.diiNet >= 0 ? "up" : "down"}>
                {fmtSigned(brain.flows.fiiNet + brain.flows.diiNet)} {brain.flows.unit}
              </b>
            </div>
          </div>
        </Card>

        {/* Row G — four even cards */}
        <Card n={17} title="Portfolio Impact" hint="Example" span={3}>
          <div className="cbd-portfolio">
            {brain.portfolio.map((m) => (
              <div key={m.label} className="cbd-pf">
                <span className="cbd-pf-label">{m.label}</span>
                <span className={`cbd-pf-val ${m.tone ?? ""}`}>{m.value}</span>
                {m.sub && <span className="cbd-pf-sub">{m.sub}</span>}
              </div>
            ))}
          </div>
        </Card>

        <Card n={18} title="Intelligence Feed" hint="Today" span={3}>
          <ul className="cbd-feed">
            {brain.feed.map((f, i) => (
              <li key={i}>
                <span className="cbd-feed-time">{f.time}</span>
                <i className={`cbd-feed-dot ${f.tone}`} />
                <span className="cbd-feed-text">{f.text}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card n={19} title="Pattern Matching" hint="Analog" span={3}>
          <div className="cbd-pattern-top">
            <b>{brain.pattern.title}</b>
            <span className="cbd-pill up">{brain.pattern.match}%</span>
          </div>
          <Spark data={brain.pattern.series} tone="up" h={40} w={280} />
          <p className="cbd-pattern-note">{brain.pattern.note}</p>
        </Card>

        <Card n={20} title="Intelligence Timeline" hint="Outlook changes" span={3}>
          <AreaLine data={brain.outlookHistory} />
          <div className="cbd-timeline-foot">
            <span>20d ago</span>
            <span className={`cbd-pill ${toneOf(brain.overall)}`}>{brain.overall}</span>
            <span>Now</span>
          </div>
        </Card>
      </div>

      {openSector && (
        <SectorIndexModal
          code={country.code}
          sector={openSector}
          onClose={() => setOpenSectorId(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------- Header --------------------------------- */

function BrainHeader({
  country,
  brain,
  onPick,
}: {
  country: Country;
  brain: Brain;
  onPick: (c: Country) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(s)) : COUNTRIES;
  }, [q]);

  return (
    <header className="header cbd-head">
      <div className="brand cbd-brand">
        <div className="coin" style={{ background: "radial-gradient(circle at 30% 28%,#a8c6ff,#2f5fd0)", color: "#06183f" }}>
          🌍
        </div>
        <div className="cbd-title-block">
          <h1>Country Brain</h1>
          <div className="cbd-picker" ref={ref}>
            <button type="button" className="cbd-picker-btn" onClick={() => setOpen((o) => !o)}>
              <span className="cbd-flag-sm">{country.flag}</span>
              <b>{country.name}</b>
              <span className={`cbd-pill ${toneOf(brain.overall)} sm`}>{brain.overall}</span>
              <span className="cbd-caret">▾</span>
            </button>
            {open && (
              <div className="cbd-menu">
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find a country…"
                  suppressHydrationWarning
                />
                <div className="cbd-menu-list">
                  {shown.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      className={c.code === country.code ? "on" : ""}
                      onClick={() => {
                        onPick(c);
                        setOpen(false);
                        setQ("");
                      }}
                    >
                      <span>{c.flag}</span> {c.name}
                    </button>
                  ))}
                  {shown.length === 0 && <div className="cbd-menu-empty">No match</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="cbd-head-right">
        <span className="cbd-live"><i /> LIVE</span>
        <span className="cbd-updated">Updated {brain.updated}</span>
        <button type="button" className="cbd-head-btn">★ Watchlist</button>
        <button type="button" className="cbd-head-btn primary">Share</button>
      </div>
    </header>
  );
}

function FlowRow({ label, value, unit }: { label: string; value: number; unit: string }) {
  const up = value >= 0;
  const pct = Math.min(100, (Math.abs(value) / 9000) * 100);
  return (
    <div className="cbd-flow-row">
      <span className="cbd-flow-label">{label}</span>
      <div className="cbd-flow-track">
        <i className={up ? "up" : "down"} style={{ width: `${pct}%` }} />
      </div>
      <b className={up ? "up" : "down"}>{fmtSigned(value)} {unit}</b>
    </div>
  );
}

/* ------------------------------ Ask Brain -------------------------------- */

interface Msg {
  role: "user" | "assistant";
  content: string;
  time: string;
}

const SUGGESTIONS = [
  "What's the macro outlook?",
  "Key risks right now?",
  "Which sectors look strongest?",
];

function AskBrain({ country }: { country: Country }) {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setInput("");
    setTyping(false);
  }, [country.code]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, typing]);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || typing) return;
    const history = [...messages, { role: "user" as const, content: text, time: now() }];
    setMessages(history);
    
    setInput("");
    setTyping(true);
    try {
      const r = await fetch("/api/country/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: country.code,
          name: country.name,
          session: getToken() ?? "",
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      }).then((res) => res.json());
      const reply = (r.reply ?? "…").toString();
      setMessages((m) => [...m, { role: "assistant", content: reply, time: now() }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Connection error — please try again.", time: now() },
      ]);
    } finally {
      setTyping(false);
    }
  };

  return (
    <div className="cbd-ask">
      <div className="cbd-ask-body" ref={bodyRef}>
        {messages.length === 0 && !typing && (
          <div className="cbd-ask-empty">
            <span>Ask about {country.name} — its economy and markets.</span>
            <div className="cbd-ask-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`cbd-ask-row ${m.role}`}>
            {m.role === "assistant" && <span className="cbd-ask-avatar">{country.flag}</span>}
            <div className={`cbd-ask-bubble ${m.role}`}>{m.content}</div>
          </div>
        ))}
        {typing && (
          <div className="cbd-ask-row assistant">
            <span className="cbd-ask-avatar">{country.flag}</span>
            <div className="cbd-ask-bubble assistant typing"><span /><span /><span /></div>
          </div>
        )}
      </div>
      <div className="cbd-ask-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Message the ${country.name} Brain…`}
          suppressHydrationWarning
        />
        <button type="button" onClick={() => send()} disabled={!input.trim() || typing} aria-label="Send">➤</button>
      </div>
    </div>
  );
}

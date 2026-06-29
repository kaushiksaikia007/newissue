import { tradingviewScanCols } from "../sources/tradingview";
import { ensureSubscribed, getQuote } from "../sources/tvSocket";
import { momentumScore } from "../analysis";
import {
  getSensexData,
  getSensexTechnicals,
  SENSEX_BENCH,
  SENSEX_SECTORS,
} from "./sensex";
import type { Metric } from "../types";

// ---------------------------------------------------------------------------
// Sensex Institutional Intelligence — collects, scores and aggregates eight
// institutional-grade categories into a single weighted bullish probability.
// ---------------------------------------------------------------------------

export interface IntelCategory {
  id: string;
  title: string;
  /** 0-10 (5 = neutral). */
  score: number;
  /** User-spec headline points (e.g. +15 / -10). */
  points: number;
  signal: "Bullish" | "Bearish" | "Neutral";
  detail: string;
  available: boolean;
}

export interface IntelReport {
  available: boolean;
  cmp: number;
  bullishProbability: number; // 0-100
  verdict: "LONG" | "SHORT" | "HOLD";
  confidence: "Very High" | "High" | "Moderate" | "Low";
  regime: "Trending" | "Range-Bound" | "Volatile";
  categories: IntelCategory[];
  weights: Record<string, number>;
  buckets: Record<string, number>;
  reasons: string[];
  summary: string;
  engine: "openai" | "deterministic";
  fetchedAt: string;
}

const clamp = (n: number, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Day change % from the streamed quote (price + absolute change). */
function pctFromQuote(ticker: string): number | null {
  const q = getQuote(ticker);
  if (!q) return null;
  const prev = q.price - q.change;
  if (!prev) return null;
  return (q.change / prev) * 100;
}

const GLOBAL = {
  sp500: "CME_MINI:ES1!",
  nasdaq: "CME_MINI:NQ1!",
  dow: "CBOT_MINI:YM1!",
  crude: "NYMEX:CL1!",
  dxy: "TVC:DXY",
  gold: "TVC:GOLD",
};

const WEIGHTS = {
  macro: 0.2,
  liquidity: 0.2,
  technical: 0.25,
  sentiment: 0.15,
  options: 0.1,
  global: 0.1,
};

let cache: { r: IntelReport; expires: number } | null = null;

export async function getSensexIntel(fresh = false): Promise<IntelReport> {
  if (!fresh && cache && cache.expires > Date.now()) return cache.r;
  const r = await build();
  cache = { r, expires: Date.now() + 30_000 };
  return r;
}

async function build(): Promise<IntelReport> {
  ensureSubscribed([SENSEX_BENCH, ...SENSEX_SECTORS.map((s) => s.ticker)]);

  const [bundle, tech] = await Promise.all([getSensexData(), getSensexTechnicals()]);
  const m = (id: string) => bundle.metrics.find((x) => x.id === id);

  if (!tech) {
    return {
      available: false,
      cmp: 0,
      bullishProbability: 50,
      verdict: "HOLD",
      confidence: "Low",
      regime: "Range-Bound",
      categories: [],
      weights: WEIGHTS,
      buckets: {},
      reasons: ["Live technicals are unavailable right now — try again shortly."],
      summary: "Market data feed is temporarily unreachable.",
      engine: "deterministic",
      fetchedAt: new Date().toISOString(),
    };
  }

  const cmp = tech.cmp;
  const idxChg = bundle.index.changePct ?? 0;

  // ---- Parallel external pulls (volume + global), best-effort ----
  const [volRows, globalRows] = await Promise.all([
    tradingviewScanCols(
      ["BSE:SENSEX"],
      ["close", "volume", "average_volume_10d_calc", "average_volume_30d_calc"],
      "india",
    ).catch(() => new Map()),
    tradingviewScanCols(Object.values(GLOBAL), ["close", "change"], "global").catch(
      () => new Map(),
    ),
  ]);

  const cats: IntelCategory[] = [];

  // === 1. INSTITUTIONAL LIQUIDITY (FII/DII) — proxied via USD/INR =========
  const liquidity = liquidityCat(m("usdinr"));
  cats.push(liquidity);

  // === 2. MARKET TREND STRUCTURE ========================================
  const trend = trendCat(tech);
  cats.push(trend);

  // === 3. VOLUME CONFIRMATION ===========================================
  const volume = volumeCat(volRows.get("BSE:SENSEX"), idxChg);
  cats.push(volume);

  // === 4. SECTOR ROTATION ===============================================
  const sector = sectorCat(idxChg);
  cats.push(sector);

  // === 5. GLOBAL MARKETS ================================================
  const global = globalCat(globalRows);
  cats.push(global);

  // === 6. OPTIONS SENTIMENT (PCR / Max Pain) — not connected ============
  const options: IntelCategory = {
    id: "options",
    title: "Options Sentiment",
    score: 5,
    points: 0,
    signal: "Neutral",
    detail:
      "PCR / Max Pain / OI require a live NSE option-chain feed, which isn't connected. Treated as neutral and excluded from conviction.",
    available: false,
  };
  cats.push(options);

  // === 7. MARKET REGIME =================================================
  const atrPct = (tech.atr / cmp) * 100;
  const regime: IntelReport["regime"] =
    tech.adx >= 25 ? "Trending" : atrPct >= 1.2 ? "Volatile" : "Range-Bound";
  cats.push({
    id: "regime",
    title: "Market Regime",
    score: 5,
    points: 0,
    signal: "Neutral",
    detail: `ADX ${tech.adx.toFixed(0)} and ATR ${atrPct.toFixed(2)}% of price → ${regime} market. ${
      regime === "Trending"
        ? "Trend-following setups are favoured."
        : regime === "Volatile"
          ? "Wider stops and smaller size are prudent."
          : "Range/mean-reversion tactics fit better than breakouts."
    }`,
    available: true,
  });

  // === MACRO bucket (from India macro indicators) =======================
  const macroScore = macroBucket(m);

  // === Momentum (RSI/MACD/ADX) for the technical bucket =================
  let momentum = momentumScore(tech.rsi);
  momentum += tech.macd > tech.macdSignal ? 1 : -1;
  if (tech.adx > 25) momentum += tech.macd > tech.macdSignal ? 0.5 : -0.5;
  momentum = clamp(momentum);

  // === Sentiment bucket: sector breadth + India VIX =====================
  const vix = m("indiavix")?.value ?? 14;
  const vixScore = clamp(5 + (15 - vix) * 0.4);
  const sentimentScore = clamp(sector.score * 0.7 + vixScore * 0.3);

  // === Technical bucket: trend + momentum + volume ======================
  const technicalScore = clamp(
    trend.score * 0.5 + momentum * 0.3 + volume.score * 0.2,
  );

  const buckets = {
    macro: r2(macroScore),
    liquidity: r2(liquidity.score),
    technical: r2(technicalScore),
    sentiment: r2(sentimentScore),
    options: r2(options.score),
    global: r2(global.score),
  };

  const final01 =
    (buckets.macro * WEIGHTS.macro +
      buckets.liquidity * WEIGHTS.liquidity +
      buckets.technical * WEIGHTS.technical +
      buckets.sentiment * WEIGHTS.sentiment +
      buckets.options * WEIGHTS.options +
      buckets.global * WEIGHTS.global) /
    10;
  const bullishProbability = Math.round(clamp(final01, 0, 1) * 100);

  const verdict: IntelReport["verdict"] =
    bullishProbability >= 60 ? "LONG" : bullishProbability <= 40 ? "SHORT" : "HOLD";

  const directionalAvail = [liquidity, trend, volume, sector, global].filter(
    (c) => c.available,
  ).length;
  const dist = Math.abs(bullishProbability - 50);
  let confidence: IntelReport["confidence"];
  if (dist >= 22 && directionalAvail >= 5) confidence = "Very High";
  else if (dist >= 14 && directionalAvail >= 4) confidence = "High";
  else if (dist >= 7) confidence = "Moderate";
  else confidence = "Low";

  const base: IntelReport = {
    available: true,
    cmp: cmp < 1000 ? r2(cmp) : Math.round(cmp),
    bullishProbability,
    verdict,
    confidence,
    regime,
    categories: cats,
    weights: WEIGHTS,
    buckets,
    reasons: templateReasons(cats, verdict, bullishProbability),
    summary: "",
    engine: "deterministic",
    fetchedAt: new Date().toISOString(),
  };

  const ai = await aiReasoning(base, regime);
  if (ai) {
    base.reasons = ai.reasons;
    base.summary = ai.summary;
    base.engine = "openai";
  } else {
    base.summary = `Weighted institutional read is ${bullishProbability}% bullish → ${verdict} (${confidence} confidence) in a ${regime.toLowerCase()} market.`;
  }
  return base;
}

// --------------------------- category scorers ------------------------------

function liquidityCat(usdinr: Metric | undefined): IntelCategory {
  const chg = usdinr?.changePct ?? 0;
  // Firmer rupee (USD/INR falling) → consistent with FII inflows.
  const score = clamp(5 - chg * 4);
  const signal = score >= 6 ? "Bullish" : score <= 4 ? "Bearish" : "Neutral";
  return {
    id: "liquidity",
    title: "Institutional Liquidity (FII/DII)",
    score,
    points: score >= 7 ? 10 : score <= 3 ? -10 : 0,
    signal,
    detail: `Live FII/DII cash figures aren't connected, so flows are proxied from the rupee: USD/INR ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% → ${
      chg < 0 ? "rupee firmer, consistent with foreign inflows" : chg > 0 ? "rupee weaker, hinting at outflows" : "flows broadly flat"
    }.`,
    available: true,
  };
}

function trendCat(tech: {
  cmp: number;
  ema20: number;
  ema50: number;
  ema200: number;
}): IntelCategory {
  const { cmp, ema20, ema50, ema200 } = tech;
  const stack = [cmp > ema20, ema20 > ema50, ema50 > ema200];
  const bull = stack.every(Boolean);
  const bear = cmp < ema20 && ema20 < ema50 && ema50 < ema200;
  const score = bull ? 10 : bear ? 0 : clamp(2 + stack.filter(Boolean).length * 2.5);
  return {
    id: "trend",
    title: "Market Trend Structure",
    score,
    points: bull ? 15 : bear ? -15 : 0,
    signal: bull ? "Bullish" : bear ? "Bearish" : "Neutral",
    detail: `Price ${Math.round(cmp)} vs 20EMA ${Math.round(ema20)} / 50DMA ${Math.round(ema50)} / 200DMA ${Math.round(ema200)}. ${
      bull
        ? "Perfect bullish stack (Price > 20 > 50 > 200)."
        : bear
          ? "Perfect bearish stack (Price < 20 < 50 < 200)."
          : "Moving averages are not cleanly aligned — mixed structure."
    }`,
    available: true,
  };
}

function volumeCat(d: (number | null)[] | undefined, idxChg: number): IntelCategory {
  if (!d || typeof d[1] !== "number") {
    return {
      id: "volume",
      title: "Volume Confirmation",
      score: 5,
      points: 0,
      signal: "Neutral",
      detail: "Volume data unavailable for this session.",
      available: false,
    };
  }
  const vol = d[1] as number;
  const a10 = typeof d[2] === "number" ? (d[2] as number) : vol;
  const a30 = typeof d[3] === "number" ? (d[3] as number) : vol;
  const avg20 = (a10 + a30) / 2 || vol; // ~20-day proxy
  const ratio = avg20 ? vol / avg20 : 1;
  const up = idxChg >= 0;
  let score = 5;
  let signal: IntelCategory["signal"] = "Neutral";
  if (ratio >= 1.5) {
    score = up ? 9 : 1;
    signal = up ? "Bullish" : "Bearish";
  } else if (ratio < 0.9) {
    score = 5;
    signal = "Neutral";
  } else {
    score = up ? 6 : 4;
    signal = up ? "Bullish" : "Bearish";
  }
  return {
    id: "volume",
    title: "Volume Confirmation",
    score,
    points: ratio >= 1.5 && up ? 10 : 0,
    signal,
    detail: `Volume ${(ratio).toFixed(2)}× the ~20-day average on a ${up ? "up" : "down"} day. ${
      ratio >= 1.5
        ? up
          ? "High-volume strength — genuine participation."
          : "High-volume selling — distribution risk."
        : "Volume is unremarkable, so the move lacks strong confirmation."
    }`,
    available: true,
  };
}

function sectorCat(idxChg: number): IntelCategory {
  const benchPct = pctFromQuote(SENSEX_BENCH) ?? idxChg;
  const reads = SENSEX_SECTORS.map((s) => ({
    label: s.label,
    pct: pctFromQuote(s.ticker),
  })).filter((s) => s.pct != null) as { label: string; pct: number }[];

  if (reads.length < 3) {
    return {
      id: "sector",
      title: "Sector Rotation",
      score: 5,
      points: 0,
      signal: "Neutral",
      detail: "Sector index stream is still warming up — rotation read unavailable.",
      available: false,
    };
  }
  const outperf = reads.filter((s) => s.pct > benchPct);
  const n = outperf.length;
  const score = clamp(2 + (n / reads.length) * 8);
  const signal = n >= 4 ? "Bullish" : n <= 1 ? "Bearish" : "Neutral";
  const leaders = [...reads].sort((a, b) => b.pct - a.pct).slice(0, 2).map((s) => s.label);
  return {
    id: "sector",
    title: "Sector Rotation",
    score,
    points: n >= 4 ? 10 : n <= 1 ? -5 : 0,
    signal,
    detail: `${n}/${reads.length} tracked sectors outperform Nifty (${benchPct >= 0 ? "+" : ""}${benchPct.toFixed(2)}%). ${
      n >= 4
        ? `Broad participation — leadership in ${leaders.join(" & ")}.`
        : n <= 1
          ? "Narrow rally — only a sliver of sectors leading."
          : `Mixed breadth; ${leaders.join(" & ")} are relatively strong.`
    }`,
    available: true,
  };
}

function globalCat(rows: Map<string, (number | null)[]>): IntelCategory {
  const g = (t: string) => {
    const d = rows.get(t);
    return d && typeof d[1] === "number" ? (d[1] as number) : null;
  };
  const us = [g(GLOBAL.sp500), g(GLOBAL.nasdaq), g(GLOBAL.dow)].filter(
    (x) => x != null,
  ) as number[];
  const dxy = g(GLOBAL.dxy);
  const crude = g(GLOBAL.crude);
  if (!us.length && dxy == null) {
    return {
      id: "global",
      title: "Global Markets",
      score: 5,
      points: 0,
      signal: "Neutral",
      detail: "Global futures feed unavailable right now.",
      available: false,
    };
  }
  const usAvg = us.length ? us.reduce((a, b) => a + b, 0) / us.length : 0;
  let score = 5;
  score += clamp(usAvg / 0.5, -1, 1) * 2.5;
  if (dxy != null) score -= clamp(dxy / 0.4, -1, 1) * 1.5;
  if (crude != null) score -= clamp(crude / 2, -1, 1) * 1.0;
  score = clamp(score);
  const signal = score >= 6 ? "Bullish" : score <= 4 ? "Bearish" : "Neutral";
  return {
    id: "global",
    title: "Global Markets",
    score,
    points: score >= 6.5 ? 10 : score <= 3.5 ? -10 : 0,
    signal,
    detail: `US futures avg ${usAvg >= 0 ? "+" : ""}${usAvg.toFixed(2)}%${
      dxy != null ? `, DXY ${dxy >= 0 ? "+" : ""}${dxy.toFixed(2)}%` : ""
    }${crude != null ? `, crude ${crude >= 0 ? "+" : ""}${crude.toFixed(2)}%` : ""}. ${
      score >= 6
        ? "Supportive global backdrop for Indian equities."
        : score <= 4
          ? "Risk-off / firmer dollar / pricier crude is a headwind."
          : "Mixed global cues."
    }`,
    available: true,
  };
}

function macroBucket(m: (id: string) => Metric | undefined): number {
  let s = 5;
  const infl = m("inflation")?.value ?? 4;
  s += infl <= 4 ? 1.5 : infl <= 5 ? 0 : -1.5;
  const repoChg = m("repo")?.change ?? 0;
  s += repoChg < 0 ? 1 : repoChg > 0 ? -1 : 0;
  const us10y = m("us10y")?.change ?? 0;
  s += us10y < 0 ? 1 : us10y > 0 ? -0.5 : 0;
  const in10y = m("in10y")?.change ?? 0;
  s += in10y < 0 ? 0.5 : in10y > 0 ? -0.5 : 0;
  return clamp(s);
}

function templateReasons(
  cats: IntelCategory[],
  verdict: string,
  prob: number,
): string[] {
  const out = cats
    .filter((c) => c.available && c.signal !== "Neutral")
    .map((c) => `${c.title}: ${c.signal.toLowerCase()} — ${c.detail}`);
  out.unshift(
    `Weighted institutional score ${prob}% → ${verdict}.`,
  );
  return out.slice(0, 8);
}

// ----------------------------- AI narrative -------------------------------

async function aiReasoning(
  r: IntelReport,
  regime: string,
): Promise<{ reasons: string[]; summary: string } | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const payload = JSON.stringify({
    asset: "BSE SENSEX",
    bullishProbability: r.bullishProbability,
    verdict: r.verdict,
    confidence: r.confidence,
    regime,
    weights: r.weights,
    buckets: r.buckets,
    categories: r.categories.map((c) => ({
      title: c.title,
      score: c.score,
      signal: c.signal,
      available: c.available,
      detail: c.detail,
    })),
  });
  const system = `You are a professional institutional trading analyst and quant
research assistant covering the BSE SENSEX. You are given a precomputed,
weighted institutional analysis (do NOT change the bullishProbability, verdict or
confidence — they are final). Write a clear, professional explanation that a desk
would act on.

Rules:
- Plain text only. No markdown, no asterisks, no disclaimers.
- Be specific and quantitative — cite the actual numbers from the data.
- Where a category is unavailable (e.g. live FII/DII cash or option-chain PCR),
  say so honestly and note it lowers conviction.
- Explain how the weighting (Macro 20, Liquidity 20, Technical 25, Sentiment 15,
  Options 10, Global 10) produced the verdict.

Return STRICT JSON:
{
  "reasons": ["6-8 short, punchy bullet reasons, each citing a number"],
  "summary": "3-4 sentence professional verdict explanation"
}`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: payload },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const json = await res.json();
    const p = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
    const reasons = Array.isArray(p.reasons)
      ? p.reasons.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 8)
      : [];
    if (!reasons.length || !p.summary) return null;
    return { reasons, summary: String(p.summary).trim() };
  } catch {
    return null;
  }
}

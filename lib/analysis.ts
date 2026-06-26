import type {
  FactorScore,
  GoldBias,
  GoldSignal,
  HorizonId,
  Metric,
  NewsItem,
  Recommendation,
} from "./types";
import { formatValue } from "./format";

/** The seven factors the Gold Bot scores, in display order. */
export const FACTORS: { id: string; label: string }[] = [
  { id: "dxy", label: "US Dollar (DXY)" },
  { id: "us10y", label: "US 10Y Treasury Yield" },
  { id: "fed", label: "Fed Expectations" },
  { id: "cpi", label: "CPI / Inflation" },
  { id: "nfp", label: "Nonfarm Payrolls (NFP)" },
  { id: "geopolitics", label: "Geopolitical Events" },
  { id: "risk", label: "Global Risk Sentiment" },
];

/** The three time horizons each scored independently. */
export const HORIZONS: { id: HorizonId; label: string; timeframe: string }[] = [
  { id: "intraday", label: "1 Day", timeframe: "Next 24 hours" },
  { id: "short", label: "Short-term", timeframe: "1–4 weeks" },
  { id: "long", label: "Long-term", timeframe: "More than 1 month" },
];

export function horizonMeta(id: HorizonId) {
  return HORIZONS.find((h) => h.id === id) ?? HORIZONS[0];
}

// Which live metric's reading to show next to each factor.
const GOLD_FACTOR_METRIC: Record<string, string> = {
  dxy: "dxy",
  us10y: "us10y",
  fed: "fed",
  cpi: "cpi",
  nfp: "nfp",
  risk: "vix",
};
const NIFTY_FACTOR_METRIC: Record<string, string> = {
  trend: "nifty",
  flows: "usdinr",
  rbi: "repo",
  fed: "us10y",
  inflation: "inflation",
  // breadth + momentum values are set by applyNiftyOverrides (computed factors).
};

/** Attach the live metric reading to each factor for display. */
function attachValues(
  signals: GoldSignal[],
  metrics: Metric[],
  map: Record<string, string>,
): GoldSignal[] {
  return signals.map((s) => ({
    ...s,
    factors: s.factors.map((f) => {
      const m = map[f.id] ? metrics.find((x) => x.id === map[f.id]) : undefined;
      return m ? { ...f, value: formatValue(m) } : f;
    }),
  }));
}

export function attachGoldValues(
  signals: GoldSignal[],
  metrics: Metric[],
): GoldSignal[] {
  return attachValues(signals, metrics, GOLD_FACTOR_METRIC);
}

export function attachNiftyValues(
  signals: GoldSignal[],
  metrics: Metric[],
): GoldSignal[] {
  return attachValues(signals, metrics, NIFTY_FACTOR_METRIC);
}

/** Count recent headlines flagging geopolitical tension. */
export function tensionCount(news: NewsItem[]): number {
  return news.filter((n) => TENSION_WORDS.test(n.title)).length;
}

/** Set the geopolitics factor's display value from the headline tension count. */
export function attachGeoValue(
  signals: GoldSignal[],
  news: NewsItem[],
): GoldSignal[] {
  const c = tensionCount(news);
  const value = c > 0 ? `${c} flag${c > 1 ? "s" : ""}` : "calm";
  return signals.map((s) => ({
    ...s,
    factors: s.factors.map((f) =>
      f.id === "geopolitics" ? { ...f, value } : f,
    ),
  }));
}

/** Conviction from how decisive the average is and how aligned the factors. */
export function computeConfidence(
  factors: FactorScore[],
  averageScore: number,
): number {
  const distance = Math.abs(averageScore - 5) / 5; // 0..1
  const bullish = factors.filter((f) => f.score > 5.5).length;
  const bearish = factors.filter((f) => f.score < 4.5).length;
  const agreement =
    factors.length > 0 ? Math.abs(bullish - bearish) / factors.length : 0;
  return Math.round(Math.min(100, 35 + distance * 45 + agreement * 20));
}

/** Assemble a full signal for one horizon from its factor scores. */
export function assembleSignal(
  horizon: HorizonId,
  factors: FactorScore[],
  opts: {
    summary?: string;
    confidence?: number;
    tradeNote?: string;
    keyRisks?: string[];
    engine: "openai" | "heuristic";
    model?: string;
  },
): GoldSignal {
  const meta = horizonMeta(horizon);
  const averageScore = averageOf(factors);
  const recommendation = recommendationFor(averageScore);
  const confidence =
    opts.confidence ?? computeConfidence(factors, averageScore);
  const summary =
    opts.summary ||
    `${meta.label} (${meta.timeframe}): gold scores ${averageScore.toFixed(1)}/10 → ${recommendation}. ${topDrivers(factors)}`;
  return {
    horizon: meta.id,
    horizonLabel: meta.label,
    timeframe: meta.timeframe,
    factors,
    averageScore,
    recommendation,
    summary,
    confidence,
    tradeNote: opts.tradeNote || watchNote(factors),
    keyRisks:
      opts.keyRisks && opts.keyRisks.length
        ? opts.keyRisks
        : defaultRisks(factors, recommendation),
    engine: opts.engine,
    model: opts.model,
  };
}

/** Risks = the strongest factors pulling against the current call. */
function defaultRisks(
  factors: FactorScore[],
  rec: Recommendation,
): string[] {
  const bullishCall = rec === "Buy" || rec === "Strong Buy";
  const opposing = factors
    .filter((f) => (bullishCall ? f.score < 4.5 : f.score > 5.5))
    .sort((a, b) => Math.abs(b.score - 5) - Math.abs(a.score - 5))
    .slice(0, 3)
    .map(
      (f) =>
        `${f.label} could ${bullishCall ? "cap upside" : "support a bounce"} (${f.score.toFixed(1)}/10).`,
    );
  return opposing.length
    ? opposing
    : ["Macro surprises or a sharp shift in risk sentiment could change the call."];
}

export function biasFromScore(score: number): GoldBias {
  if (score >= 6) return "bullish";
  if (score <= 4) return "bearish";
  return "neutral";
}

/** Map a 0-10 average to a trading recommendation (higher = buy gold). */
export function recommendationFor(avg: number): Recommendation {
  if (avg >= 8) return "Strong Buy";
  if (avg >= 6) return "Buy";
  if (avg >= 4) return "Hold";
  if (avg >= 2) return "Sell";
  return "Strong Sell";
}

export function averageOf(factors: FactorScore[]): number {
  if (factors.length === 0) return 5;
  return factors.reduce((s, f) => s + f.score, 0) / factors.length;
}

/** Clamp a -1..1 bullishness into a 0-10 score (5 = neutral). */
function toScore(bullishness: number): number {
  const s = 5 + bullishness * 5;
  return Math.round(Math.max(0, Math.min(10, s)) * 10) / 10;
}

function scaled(delta: number, sensitivity: number): number {
  return Math.max(-1, Math.min(1, delta / sensitivity));
}

const TENSION_WORDS =
  /\b(war|conflict|sanction|attack|strike|missile|nuclear|invasion|tension|crisis|escalat|troops|airstrike|hostage|coup|terror)/i;

// How strongly each factor weighs in each horizon (1 = neutral). Fast movers
// (risk, geopolitics, yields) matter more intraday; slow macro (CPI, Fed,
// dollar) matters more long-term. Used by the heuristic fallback so the three
// horizons differ meaningfully.
const HORIZON_WEIGHTS: Record<HorizonId, Record<string, number>> = {
  intraday: {
    risk: 1.35,
    geopolitics: 1.35,
    us10y: 1.1,
    dxy: 1.0,
    fed: 0.5,
    cpi: 0.4,
    nfp: 0.5,
  },
  short: {
    risk: 1.0,
    geopolitics: 1.0,
    us10y: 1.0,
    dxy: 1.0,
    fed: 1.0,
    cpi: 1.0,
    nfp: 1.0,
  },
  long: {
    risk: 0.6,
    geopolitics: 0.7,
    us10y: 0.9,
    dxy: 1.1,
    fed: 1.35,
    cpi: 1.35,
    nfp: 1.05,
  },
};

/** Re-weight factor scores around neutral (5) using a per-factor weight map. */
function weightFactors(
  factors: FactorScore[],
  weights: Record<string, number>,
): FactorScore[] {
  return factors.map((f) => {
    const score =
      Math.round(
        Math.max(0, Math.min(10, 5 + (f.score - 5) * (weights[f.id] ?? 1))) * 10,
      ) / 10;
    return { ...f, score, bias: biasFromScore(score) };
  });
}

/**
 * Deterministic fallback used when OpenAI is unavailable. Produces one signal
 * per horizon from the same base factor scores, re-weighted per horizon.
 */
export function buildGoldSignals(
  metrics: Metric[],
  news: NewsItem[] = [],
): GoldSignal[] {
  const base = computeFactors(metrics, news);
  return HORIZONS.map((h) =>
    assembleSignal(h.id, weightFactors(base, HORIZON_WEIGHTS[h.id]), {
      engine: "heuristic",
    }),
  );
}

/** Score the seven factors 0-10 from the live metrics and headlines. */
export function computeFactors(
  metrics: Metric[],
  news: NewsItem[] = [],
): FactorScore[] {
  const by = (id: string) => metrics.find((m) => m.id === id);
  const factors: FactorScore[] = [];

  const push = (id: string, bullishness: number, rationale: string) => {
    const label = FACTORS.find((f) => f.id === id)?.label ?? id;
    const score = toScore(bullishness);
    factors.push({ id, label, score, bias: biasFromScore(score), rationale });
  };

  const dxy = by("dxy");
  if (dxy?.changePct != null) {
    push(
      "dxy",
      -scaled(dxy.changePct, 0.5),
      `Dollar ${dir(dxy.trend)} (${pct(dxy.changePct)}). A ${dxy.trend === "down" ? "weaker" : "stronger"} dollar is ${dxy.trend === "down" ? "supportive of" : "a headwind for"} gold.`,
    );
  }

  const y = by("us10y");
  if (y?.change != null) {
    push(
      "us10y",
      -scaled(y.change, 0.1),
      `10Y yield ${dir(y.trend)} (${chg(y.change, "pp")}). ${y.trend === "down" ? "Lower yields reduce the cost of holding gold." : "Higher yields raise gold's opportunity cost."}`,
    );
  }

  const fed = by("fed");
  if (fed?.change != null) {
    push(
      "fed",
      -scaled(fed.change, 0.2),
      `Market-implied Fed rate ${dir(fed.trend)} (${chg(fed.change, "pp")}). ${fed.trend === "down" ? "Dovish repricing is bullish for gold." : fed.trend === "up" ? "Hawkish repricing pressures gold." : "Steady expectations are neutral."}`,
    );
  }

  const cpi = by("cpi");
  if (cpi?.changePct != null) {
    push(
      "cpi",
      scaled(cpi.changePct, 0.4),
      `CPI ${cpi.trend === "up" ? "accelerating" : "softening"} (${pct(cpi.changePct)} m/m). ${cpi.trend === "up" ? "Hotter inflation supports gold as a hedge." : "Cooling inflation eases hedge demand."}`,
    );
  }

  const nfp = by("nfp");
  if (nfp?.change != null) {
    push(
      "nfp",
      -scaled(nfp.changePct ?? 0, 0.3),
      `Payrolls ${nfp.trend === "up" ? "rose" : "fell"} (${chg(nfp.change, "k")}). ${nfp.trend === "up" ? "A strong labor market leans hawkish — a headwind." : "A soft labor market leans dovish — supportive."}`,
    );
  }

  // Geopolitics: tension keywords in recent headlines lift the gold score.
  const hits = news.filter((n) => TENSION_WORDS.test(n.title)).length;
  const geoBull = Math.min(1, hits * 0.18);
  push(
    "geopolitics",
    geoBull,
    hits > 0
      ? `${hits} recent headline(s) flag geopolitical tension — safe-haven supportive for gold.`
      : "Headlines show no major geopolitical escalation right now.",
  );

  const vix = by("vix");
  if (vix?.changePct != null) {
    push(
      "risk",
      scaled(vix.changePct, 10),
      `VIX ${dir(vix.trend)} (${pct(vix.changePct)}). ${vix.trend === "up" ? "Risk-off conditions boost safe-haven demand." : "Calmer markets reduce safe-haven flows."}`,
    );
  }

  return factors;
}

/** Pick the most decisive factor as the thing to watch next. */
function watchNote(factors: FactorScore[]): string {
  const top = [...factors].sort(
    (a, b) => Math.abs(b.score - 5) - Math.abs(a.score - 5),
  )[0];
  if (!top) return "Watch incoming macro data for direction.";
  return `Watch ${top.label} — currently the most decisive driver (${top.score.toFixed(1)}/10).`;
}

function topDrivers(factors: FactorScore[]): string {
  const ranked = [...factors].sort(
    (a, b) => Math.abs(b.score - 5) - Math.abs(a.score - 5),
  );
  const top = ranked.slice(0, 2).map((f) => f.label);
  return top.length ? `Key drivers: ${top.join(", ")}.` : "";
}

function dir(t: string): string {
  return t === "up" ? "rising" : t === "down" ? "falling" : "flat";
}
function pct(p: number | null): string {
  if (p == null) return "n/a";
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}
function chg(c: number | null, unit: string): string {
  if (c == null) return "n/a";
  return `${c >= 0 ? "+" : ""}${c.toFixed(unit === "k" ? 0 : 2)} ${unit}`;
}

/* ======================================================================
 * NIFTY 50 — equity index. Note the relationships are different from gold:
 * a risk asset rises on positive trend/breadth/momentum/inflows, dovish
 * RBI/Fed, low inflation and calm geopolitics.
 * ==================================================================== */

export const NIFTY_FACTORS: { id: string; label: string }[] = [
  { id: "trend", label: "Trend" },
  { id: "breadth", label: "Breadth" },
  { id: "flows", label: "Institutional Flows" },
  { id: "momentum", label: "Momentum" },
  { id: "rbi", label: "RBI" },
  { id: "fed", label: "Fed" },
  { id: "inflation", label: "Inflation" },
  { id: "geopolitics", label: "Geopolitics" },
];

const NIFTY_HORIZON_WEIGHTS: Record<HorizonId, Record<string, number>> = {
  intraday: {
    trend: 1.3,
    momentum: 1.35,
    breadth: 1.15,
    geopolitics: 1.2,
    flows: 1.0,
    rbi: 0.6,
    fed: 0.6,
    inflation: 0.5,
  },
  short: {
    trend: 1.0,
    momentum: 1.0,
    breadth: 1.0,
    geopolitics: 1.0,
    flows: 1.0,
    rbi: 1.0,
    fed: 1.0,
    inflation: 1.0,
  },
  long: {
    trend: 0.8,
    momentum: 0.6,
    breadth: 0.85,
    geopolitics: 0.8,
    flows: 1.1,
    rbi: 1.3,
    fed: 1.3,
    inflation: 1.35,
  },
};

/** Map breadth % (stocks above 50-EMA) to a 0-10 score. */
export function breadthScore(pct: number): number {
  if (pct > 90) return 10;
  if (pct >= 80) return 9;
  if (pct >= 60) return 7;
  if (pct >= 40) return 5;
  if (pct >= 20) return 3;
  return 1;
}

export function breadthLabel(pct: number): string {
  if (pct > 80) return "Strong Bullish";
  if (pct >= 60) return "Bullish";
  if (pct >= 40) return "Neutral";
  if (pct >= 20) return "Bearish";
  return "Strong Bearish / Oversold";
}

/** Map RSI(14) to a 0-10 momentum score (per the defined scale). */
export function momentumScore(rsi: number): number {
  if (rsi > 70) return 3; // overbought
  if (rsi >= 60) return 8; // strong bullish
  if (rsi >= 50) return 7; // bullish
  if (rsi >= 40) return 5; // neutral
  if (rsi >= 30) return 3; // bearish
  return 8; // oversold — bullish reversal possible
}

export function momentumVerdict(rsi: number): string {
  if (rsi > 70) return "Overbought";
  if (rsi >= 60) return "Strong Bullish";
  if (rsi >= 50) return "Bullish";
  if (rsi >= 40) return "Neutral";
  if (rsi >= 30) return "Bearish";
  return "Oversold (bullish reversal possible)";
}

/**
 * Override the breadth and momentum factors with deterministic readings from
 * real market internals (% above 50-EMA, and RSI-14), then recompute each
 * horizon's average + recommendation. This guarantees the recommendation uses
 * the true values regardless of what the engine returned.
 */
export function applyNiftyOverrides(
  signals: GoldSignal[],
  metrics: Metric[],
): GoldSignal[] {
  const breadthM = metrics.find((m) => m.id === "breadth" && !m.mock);
  const rsiM = metrics.find((m) => m.id === "rsi" && !m.mock);

  return signals.map((s) => {
    const factors = s.factors.map((f) => {
      if (f.id === "breadth" && breadthM) {
        const score = breadthScore(breadthM.value);
        return {
          ...f,
          score,
          bias: biasFromScore(score),
          value: `${Math.round(breadthM.value)}% > 50-EMA`,
          rationale: `${Math.round(breadthM.value)}% of Nifty 50 stocks are above their 50-day EMA — ${breadthLabel(breadthM.value)}.`,
        };
      }
      if (f.id === "momentum" && rsiM) {
        const score = momentumScore(rsiM.value);
        return {
          ...f,
          score,
          bias: biasFromScore(score),
          value: `RSI ${rsiM.value.toFixed(1)}`,
          rationale: `Nifty RSI(14) at ${rsiM.value.toFixed(1)} — ${momentumVerdict(rsiM.value)}.`,
        };
      }
      return f;
    });
    const averageScore = averageOf(factors);
    return {
      ...s,
      factors,
      averageScore,
      recommendation: recommendationFor(averageScore),
    };
  });
}

export function buildNiftySignals(
  metrics: Metric[],
  news: NewsItem[] = [],
): GoldSignal[] {
  const base = computeNiftyFactors(metrics, news);
  return HORIZONS.map((h) =>
    assembleSignal(h.id, weightFactors(base, NIFTY_HORIZON_WEIGHTS[h.id]), {
      engine: "heuristic",
    }),
  );
}

/** Score the eight Nifty factors 0-10 (10 = bullish for the index). */
export function computeNiftyFactors(
  metrics: Metric[],
  news: NewsItem[] = [],
): FactorScore[] {
  const by = (id: string) => metrics.find((m) => m.id === id);
  const factors: FactorScore[] = [];
  const push = (id: string, bullishness: number, rationale: string) => {
    const label = NIFTY_FACTORS.find((f) => f.id === id)?.label ?? id;
    const score = toScore(bullishness);
    factors.push({ id, label, score, bias: biasFromScore(score), rationale });
  };

  const nifty = by("nifty");
  const bank = by("banknifty");
  const vix = by("indiavix");
  const usdinr = by("usdinr");
  const in10y = by("in10y");
  const us10y = by("us10y");

  push(
    "trend",
    scaled(nifty?.changePct ?? 0, 0.8),
    `Nifty ${dir(nifty?.trend ?? "flat")} (${pct(nifty?.changePct ?? null)}). ${(nifty?.changePct ?? 0) >= 0 ? "Price action is constructive." : "Index is under pressure."}`,
  );
  const breadthM = by("breadth");
  if (breadthM && !breadthM.mock) {
    const sc = breadthScore(breadthM.value);
    factors.push({
      id: "breadth",
      label: "Breadth",
      score: sc,
      bias: biasFromScore(sc),
      rationale: `${Math.round(breadthM.value)}% of Nifty 50 stocks above their 50-day EMA — ${breadthLabel(breadthM.value)}.`,
    });
  } else {
    push(
      "breadth",
      scaled(bank?.changePct ?? 0, 1.0),
      `Bank Nifty ${dir(bank?.trend ?? "flat")} (${pct(bank?.changePct ?? null)}) — breadth proxy (constituent data unavailable).`,
    );
  }
  push(
    "flows",
    -scaled(usdinr?.changePct ?? 0, 0.3),
    `USD/INR ${dir(usdinr?.trend ?? "flat")} (${pct(usdinr?.changePct ?? null)}). ${(usdinr?.changePct ?? 0) <= 0 ? "A firmer rupee is consistent with FII inflows." : "Rupee weakness hints at foreign outflows."}`,
  );
  const rsiM = by("rsi");
  if (rsiM && !rsiM.mock) {
    const sc = momentumScore(rsiM.value);
    factors.push({
      id: "momentum",
      label: "Momentum",
      score: sc,
      bias: biasFromScore(sc),
      rationale: `Nifty RSI(14) at ${rsiM.value.toFixed(1)} — ${momentumVerdict(rsiM.value)}.`,
    });
  } else {
    push(
      "momentum",
      scaled(nifty?.changePct ?? 0, 1.0) - 0.5 * scaled(vix?.changePct ?? 0, 18),
      `India VIX ${dir(vix?.trend ?? "flat")} (${pct(vix?.changePct ?? null)}); ${(vix?.changePct ?? 0) <= 0 ? "falling volatility supports momentum." : "rising volatility threatens momentum."}`,
    );
  }
  const repo = by("repo");
  if (repo) {
    push(
      "rbi",
      -scaled(repo.change ?? 0, 0.5),
      `RBI repo rate ${repo.value.toFixed(2)}% (${chg(repo.change ?? null, "pp")}). ${(repo.change ?? 0) < 0 ? "A cut is accommodative — supportive of equities." : (repo.change ?? 0) > 0 ? "A hike tightens conditions — a headwind." : "Policy on hold; India 10Y at " + (in10y ? in10y.value.toFixed(2) + "%." : "n/a.")}`,
    );
  } else {
    push(
      "rbi",
      -scaled(in10y?.change ?? 0, 0.1),
      `India 10Y ${dir(in10y?.trend ?? "flat")} (${chg(in10y?.change ?? null, "pp")}). ${(in10y?.change ?? 0) <= 0 ? "Lower yields point to an accommodative RBI." : "Rising yields point to tighter conditions."}`,
    );
  }
  push(
    "fed",
    -scaled(us10y?.change ?? 0, 0.1),
    `US 10Y ${dir(us10y?.trend ?? "flat")} (${chg(us10y?.change ?? null, "pp")}). ${(us10y?.change ?? 0) <= 0 ? "Softer US rates ease global liquidity for EM equities." : "Higher US rates tighten global liquidity."}`,
  );
  const infl = by("inflation");
  if (infl) {
    // ~4% is the RBI's target midpoint: above it is a headwind, below supportive.
    push(
      "inflation",
      -scaled(infl.value - 4, 3),
      `India CPI ~${infl.value.toFixed(1)}% YoY — ${infl.value > 5 ? "elevated, a headwind for equities" : infl.value < 3 ? "benign, supportive of easier policy" : "near the RBI's target"}.`,
    );
  } else {
    push("inflation", 0, "Awaiting the latest CPI print.");
  }

  const hits = news.filter((n) => TENSION_WORDS.test(n.title)).length;
  push(
    "geopolitics",
    -Math.min(1, hits * 0.18),
    hits > 0
      ? `${hits} headline(s) flag geopolitical tension — a risk-off headwind for equities.`
      : "No major geopolitical escalation in recent headlines.",
  );

  return factors;
}

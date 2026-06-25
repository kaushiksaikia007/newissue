export type Trend = "up" | "down" | "flat";

/** A single macro indicator with its latest reading and prior reading. */
export interface Metric {
  /** Stable key used by the analysis engine. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  /** Latest value. */
  value: number;
  /** Previous value (prior observation), for computing change. */
  previous: number | null;
  /** Absolute change vs previous. */
  change: number | null;
  /** Percent change vs previous. */
  changePct: number | null;
  /** Units / formatting hint, e.g. "%", "index", "k jobs". */
  unit: string;
  /** Date of the latest observation (ISO yyyy-mm-dd). */
  asOf: string;
  /** Short human description of what this measures. */
  description: string;
  /** Direction of the latest move. */
  trend: Trend;
  /** Name of the live website/provider the value came from. */
  source: string;
  /** True when the value is mock/fallback (no API key or fetch failed). */
  mock: boolean;
}

export type GoldBias = "bullish" | "bearish" | "neutral";

export type Recommendation =
  | "Strong Sell"
  | "Sell"
  | "Hold"
  | "Buy"
  | "Strong Buy";

/** A single factor scored 0-10 for how bullish it is for gold (10 = bullish). */
export interface FactorScore {
  id: string;
  label: string;
  /** 0-10, where 0 = strongly bearish for gold, 5 = neutral, 10 = bullish. */
  score: number;
  bias: GoldBias;
  rationale: string;
  /** Formatted live reading of the underlying metric driving this factor. */
  value?: string;
}

export type HorizonId = "intraday" | "short" | "long";

export interface GoldSignal {
  /** Which time horizon this call is for. */
  horizon: HorizonId;
  /** Display name, e.g. "1 Day", "Short-term", "Long-term". */
  horizonLabel: string;
  /** Human timeframe, e.g. "Next 24 hours", "1–4 weeks", "6–12 months". */
  timeframe: string;
  factors: FactorScore[];
  /** Mean of the factor scores, 0-10. */
  averageScore: number;
  recommendation: Recommendation;
  summary: string;
  /** 0-100 conviction in the call. */
  confidence: number;
  /** Short "what to watch next" note. */
  tradeNote: string;
  /** 2-3 key risks that could invalidate the call. */
  keyRisks: string[];
  /** Which engine produced the analysis. */
  engine: "openai" | "heuristic";
  /** Model id when engine === "openai". */
  model?: string;
}


export interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
}

/** Fast lane — live values, polled every second. */
export interface ValuesResponse {
  metrics: Metric[];
  /** Live spot/futures gold price (the subject), shown in the hero. */
  gold: Metric | null;
  usingMockData: boolean;
  fetchedAt: string;
}

/** Slow lane — the OpenAI recommendations (one per horizon), every 60 seconds. */
export interface SignalResponse {
  signals: GoldSignal[];
  fetchedAt: string;
}

import {
  assembleSignal,
  biasFromScore,
  buildGoldSignals,
  buildNiftySignals,
  FACTORS,
  HORIZONS,
  NIFTY_FACTORS,
} from "./analysis";
import type {
  FactorScore,
  GoldSignal,
  HorizonId,
  Metric,
  NewsItem,
} from "./types";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const GOLD_PROMPT = `You are a buy-side macro strategist who specializes in gold
(XAU/USD). You produce institutional-grade, deeply reasoned analysis. You receive
live market data and recent geopolitical headlines and must score how BULLISH
each factor is for gold across THREE separate time horizons.

Score each factor 0-10: 0 = strongly BEARISH for gold, 5 = neutral, 10 = strongly
BULLISH for gold.

Core mechanisms (BULLISH for gold; opposite is bearish):
  - US Dollar (DXY) weakening; US 10Y yield falling; dovish Fed expectations;
    rising CPI/inflation; weak Nonfarm Payrolls; escalating geopolitical tension;
    risk-off sentiment (rising VIX).

Factor ids: dxy, us10y, fed, cpi, nfp, geopolitics, risk.`;

const NIFTY_PROMPT = `You are a buy-side India equity strategist covering the
NIFTY 50 index. You produce institutional-grade, deeply reasoned analysis. You
receive live market data and recent headlines and must score how BULLISH each
factor is for the Nifty 50 across THREE separate time horizons.

Score each factor 0-10: 0 = strongly BEARISH for the index, 5 = neutral, 10 =
strongly BULLISH.

NIFTY 50 is a RISK ASSET — relationships differ from gold. BULLISH when:
  - Trend: index trending up / above key moving averages.
  - Breadth: the "Market Breadth" indicator is the % of Nifty 50 stocks above
    their 50-day EMA (>80% strong bullish, 60-80% bullish, 40-60% neutral,
    20-40% bearish, <20% strongly bearish). Higher = broader participation.
  - Institutional Flows: FII/DII net buying; a firm/strengthening rupee (USD/INR
    falling) is consistent with foreign inflows.
  - Momentum: based on the index RSI(14) ("Nifty RSI (14)"): 60-70 strong
    bullish, 50-60 bullish, 40-50 neutral, 30-40 bearish, >70 overbought,
    <30 oversold (possible bullish reversal).
  - RBI: dovish/accommodative (rate cuts, falling India 10Y yields).
  - Fed: dovish (easier global liquidity, softer US yields/dollar supports EM).
  - Inflation: LOW or falling Indian inflation (allows easier policy); high or
    rising inflation is BEARISH.
  - Geopolitics: calm; escalating tension / conflict / oil spikes are BEARISH
    (risk-off hurts equities — the OPPOSITE of gold).

Factor ids: trend, breadth, flows, momentum, rbi, fed, inflation, geopolitics.`;

const SHARED_RULES = `
Analytical requirements: use the ACTUAL levels and the size of the latest move
(not just direction); consider second-order effects and interactions; distinguish
the horizons (fast movers dominate intraday, structural forces dominate the
long-term view) so the same factor can score very differently across horizons.
Be decisive but calibrated; reserve scores below 2 or above 8 for clearly strong
signals; make each rationale specific and quantitative.

The three horizons are: "intraday" (next 24 hours), "short" (next 1-4 weeks),
"long" (next 6-12 months).

Return ONLY strict JSON of this exact shape (use the factor ids listed above, in
that order, for every horizon):
{
  "intraday": {
    "factors": [ { "id": "<id>", "score": 0-10, "rationale": "..." }, ... ],
    "summary": "3-4 sentence thesis citing the key data",
    "confidence": 0-100,
    "tradeNote": "one short 'what to watch next' sentence",
    "keyRisks": ["risk that would invalidate the call", "another risk"]
  },
  "short": { ...same shape... },
  "long": { ...same shape... }
}
Do not include any text outside the JSON.`;

interface HorizonJson {
  factors: { id: string; score: number; rationale: string }[];
  summary?: string;
  confidence?: number;
  tradeNote?: string;
  keyRisks?: string[];
}
type OpenAIJson = Record<HorizonId, HorizonJson>;

/** Build the compact data payload sent to the model. */
function buildUserContent(
  priceLabel: string,
  price: Metric,
  metrics: Metric[],
  news: NewsItem[],
): string {
  const data = metrics.map((m) => ({
    id: m.id,
    label: m.label,
    value: m.value,
    change: m.change,
    changePct: m.changePct,
    unit: m.unit,
    asOf: m.asOf,
  }));
  const headlines = news.slice(0, 15).map((n) => n.title);
  return JSON.stringify(
    {
      [priceLabel]: { value: price.value, change: price.change, asOf: price.asOf },
      indicators: data,
      headlines,
    },
    null,
    2,
  );
}

interface AnalyzeConfig {
  systemPrompt: string;
  factors: { id: string; label: string }[];
  priceLabel: string;
  fallback: (metrics: Metric[], news: NewsItem[]) => GoldSignal[];
}

async function analyze(
  cfg: AnalyzeConfig,
  metrics: Metric[],
  price: Metric,
  news: NewsItem[],
): Promise<GoldSignal[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return cfg.fallback(metrics, news);

  const model = process.env.OPENAI_MODEL || "gpt-4o";
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 2600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: cfg.systemPrompt + SHARED_RULES },
          {
            role: "user",
            content: buildUserContent(cfg.priceLabel, price, metrics, news),
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI -> ${res.status}`);
    const json = await res.json();
    const content: string = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as OpenAIJson;

    return HORIZONS.map((h) => {
      const block = parsed[h.id];
      const factors = normalizeFactors(block?.factors, cfg.factors);
      if (factors.length < cfg.factors.length) {
        throw new Error(`OpenAI returned incomplete factors for ${h.id}`);
      }
      const confidence =
        typeof block.confidence === "number"
          ? Math.round(Math.max(0, Math.min(100, block.confidence)))
          : undefined;
      const keyRisks = Array.isArray(block.keyRisks)
        ? block.keyRisks
            .map((r) => (r ?? "").toString().trim())
            .filter(Boolean)
            .slice(0, 3)
        : undefined;
      return assembleSignal(h.id, factors, {
        summary: block.summary?.trim(),
        confidence,
        tradeNote: block.tradeNote?.trim(),
        keyRisks,
        engine: "openai",
        model,
      });
    });
  } catch {
    return cfg.fallback(metrics, news);
  }
}

/** Gold: OpenAI as the main brain, heuristic fallback. */
export function analyzeGold(
  metrics: Metric[],
  gold: Metric,
  news: NewsItem[],
): Promise<GoldSignal[]> {
  return analyze(
    {
      systemPrompt: GOLD_PROMPT,
      factors: FACTORS,
      priceLabel: "goldPrice",
      fallback: buildGoldSignals,
    },
    metrics,
    gold,
    news,
  );
}

/** Nifty 50: OpenAI as the main brain, heuristic fallback. */
export function analyzeNifty(
  metrics: Metric[],
  index: Metric,
  news: NewsItem[],
): Promise<GoldSignal[]> {
  return analyze(
    {
      systemPrompt: NIFTY_PROMPT,
      factors: NIFTY_FACTORS,
      priceLabel: "niftyIndex",
      fallback: buildNiftySignals,
    },
    metrics,
    index,
    news,
  );
}

/** Validate, clamp and order the model's factor scores against a factor list. */
function normalizeFactors(
  raw: HorizonJson["factors"] | undefined,
  factorList: { id: string; label: string }[],
): FactorScore[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(raw.map((f) => [f.id, f]));
  const out: FactorScore[] = [];
  for (const def of factorList) {
    const f = byId.get(def.id);
    if (!f || typeof f.score !== "number" || Number.isNaN(f.score)) continue;
    const score = Math.round(Math.max(0, Math.min(10, f.score)) * 10) / 10;
    out.push({
      id: def.id,
      label: def.label,
      score,
      bias: biasFromScore(score),
      rationale: (f.rationale ?? "").toString().trim(),
    });
  }
  return out;
}

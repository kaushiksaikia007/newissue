import {
  getNiftyData,
  getNiftyBreadth,
  getNiftyTechnicals,
  type NiftyTechnicals,
} from "./instruments/nifty";
import { getGoldTechnicals } from "./instruments/gold";
import { getMetrics } from "./macro";
import { getNiftyNews, getNews } from "./sources/news";
import { breadthScore, momentumScore, tensionCount } from "./analysis";

export type Horizon = "intraday" | "short" | "long";
export type Instrument = "nifty" | "gold";

export interface Strategy {
  show: boolean;
  side: "buy" | "sell";
  entry_zone: string;
  entry_mid: number;
  stop_loss: number;
  target_1: number;
  target_2: number;
  risk_reward: string;
  probability: number;
}
export interface StrategyReport {
  thesis: string;
  risks: string[];
  stop_rationale: string;
  targets_view: string;
  invalidation: string;
  hold: string;
}
export interface StrategyResponse {
  recommendation: {
    verdict: "BUY" | "SELL" | "HOLD";
    confidence: number;
    market_bias: "Bullish" | "Bearish" | "Neutral";
  };
  market_summary: Record<string, string>;
  buy_strategy: Strategy;
  sell_strategy: Strategy;
  report: StrategyReport;
  no_trade: boolean;
  no_trade_reason: string;
  market_open: boolean;
  minutes_to_close: number;
  session: string;
  inputs: Record<string, number | string>;
  scores: Record<string, number>;
  horizon: Horizon;
  instrument: Instrument;
  engine: "openai" | "deterministic";
  available: boolean;
  fetchedAt: string;
}

interface Extra {
  key: string;
  label: string;
  score: number;
  word: string;
}

const HLABEL: Record<Horizon, string> = {
  intraday: "Intraday",
  short: "Short Term (1-4 weeks)",
  long: "Long Term (more than 1 month)",
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Data-driven baseline for how long to hold (refined by the AI). */
function estimateHold(
  instrument: Instrument,
  horizon: Horizon,
  target: number,
  atr: number,
  adx: number,
  sess: { open: boolean; minutesToClose: number },
): string {
  if (horizon === "intraday") {
    if (instrument === "nifty") {
      return sess.open && sess.minutesToClose > 0
        ? `Intraday — exit before the 15:30 close (~${sess.minutesToClose} min left)`
        : "Intraday — within the next live session";
    }
    return "Intraday — roughly the next 6–12 hours";
  }
  // Diffusion estimate: range grows ~ ATR x sqrt(sessions); strong trends are faster.
  let sessions = Math.round((target / atr) ** 2);
  if (adx >= 25) sessions = Math.round(sessions * 0.7);
  sessions = Math.max(2, sessions);
  if (horizon === "short") {
    if (sessions <= 6) return `about ${Math.max(2, sessions - 1)}–${sessions + 1} trading sessions`;
    const wk = Math.max(1, Math.round(sessions / 5));
    return `about ${wk}–${wk + 1} weeks`;
  }
  const wks = Math.max(2, Math.round(sessions / 5));
  if (wks <= 8) return `about ${wks}–${wks + 2} weeks`;
  const mo = Math.max(1, Math.round(wks / 4.3));
  return `about ${mo}–${mo + 1} months`;
}

function nseSession(): { open: boolean; minutesToClose: number; label: string } {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const day = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const openM = 9 * 60 + 15;
  const closeM = 15 * 60 + 30;
  if (day < 1 || day > 5) return { open: false, minutesToClose: 0, label: "Closed (weekend)" };
  if (mins < openM) return { open: false, minutesToClose: 0, label: "Pre-market" };
  if (mins >= closeM) return { open: false, minutesToClose: 0, label: "Closed" };
  const ttc = closeM - mins;
  const h = Math.floor(ttc / 60);
  return { open: true, minutesToClose: ttc, label: `Open · closes in ${h ? `${h}h ` : ""}${ttc % 60}m` };
}

function extraWord(score: number): string {
  if (score >= 7) return "Strong";
  if (score >= 5.5) return "Positive";
  if (score >= 4.5) return "Neutral";
  if (score >= 3) return "Soft";
  return "Weak";
}

async function technicalsFor(inst: Instrument): Promise<NiftyTechnicals | null> {
  return inst === "gold" ? getGoldTechnicals() : getNiftyTechnicals();
}

async function fundamentalsFor(inst: Instrument): Promise<Extra[]> {
  if (inst === "nifty") {
    const [bundle, breadth, news] = await Promise.all([
      getNiftyData(),
      getNiftyBreadth(),
      getNiftyNews(),
    ]);
    const m = (id: string) => bundle.metrics.find((x) => x.id === id);
    const usdinrChg = m("usdinr")?.changePct ?? 0;
    const inflation = (m("inflation")?.value ?? 4) as number;
    const repoChange = m("repo")?.change ?? 0;
    const us10yChange = m("us10y")?.change ?? 0;
    const geo = tensionCount(news);

    const breadthSc = breadth ? breadthScore(breadth.pct) : 5;
    const instSc = clamp(5 - usdinrChg * 3, 0, 10);
    let macroSc = 5;
    macroSc += inflation <= 4 ? 1.5 : inflation <= 5 ? 0 : -1.5;
    macroSc += repoChange < 0 ? 1 : repoChange > 0 ? -1 : 0;
    macroSc += us10yChange < 0 ? 1 : -0.5;
    macroSc -= Math.min(2, geo * 0.4);
    macroSc = clamp(macroSc, 0, 10);
    return [
      { key: "breadth", label: "Breadth", score: breadthSc, word: extraWord(breadthSc) },
      { key: "institutional_flows", label: "Inst. Flows", score: instSc, word: extraWord(instSc) },
      { key: "macro_outlook", label: "Macro", score: macroSc, word: extraWord(macroSc) },
    ];
  }
  // Gold
  const [bundle, news] = await Promise.all([getMetrics(), getNews()]);
  const m = (id: string) => bundle.metrics.find((x) => x.id === id);
  const dxyChg = m("dxy")?.changePct ?? 0;
  const y10Chg = m("us10y")?.change ?? 0;
  const fedChg = m("fed")?.change ?? 0;
  const cpiChg = m("cpi")?.changePct ?? 0;
  const vixChg = m("vix")?.changePct ?? 0;
  const geo = tensionCount(news);
  const sc = (bull: number) => clamp(5 + bull * 5, 0, 10);

  const dollar = sc(-clamp(dxyChg / 0.5, -1, 1));
  const rates = sc(
    -0.6 * clamp(y10Chg / 0.1, -1, 1) - 0.4 * clamp(fedChg / 0.25, -1, 1),
  );
  const inflation = sc(clamp(cpiChg / 0.4, -1, 1));
  const sentiment = sc(
    0.6 * clamp(vixChg / 10, -1, 1) + 0.4 * Math.min(1, geo * 0.18),
  );
  return [
    { key: "dollar", label: "US Dollar", score: dollar, word: extraWord(dollar) },
    { key: "rates", label: "Rates / Fed", score: rates, word: extraWord(rates) },
    { key: "inflation", label: "Inflation", score: inflation, word: extraWord(inflation) },
    { key: "sentiment", label: "Risk / Geo", score: sentiment, word: extraWord(sentiment) },
  ];
}

export async function buildStrategy(
  instrument: Instrument,
  horizon: Horizon,
  profitPct: number,
): Promise<StrategyResponse> {
  const [tech, extras] = await Promise.all([
    technicalsFor(instrument),
    fundamentalsFor(instrument),
  ]);
  const sess = instrument === "gold"
    ? { open: true, minutesToClose: 999, label: "Open (spot, ~23h)" }
    : nseSession();

  if (!tech) return unavailable(instrument, horizon, sess);

  // Scale-aware rounding: decimals for small (per-gram) prices, integers for indices.
  const rnd =
    tech.cmp < 1000
      ? (n: number) => Math.round(n * 100) / 100
      : (n: number) => Math.round(n);

  // --- Technical scores ---
  const stack = [
    tech.cmp > tech.ema20,
    tech.cmp > tech.ema50,
    tech.cmp > tech.ema200,
    tech.ema20 > tech.ema50,
    tech.ema50 > tech.ema200,
  ];
  const trendScore = stack.filter(Boolean).length * 2;
  const trendBullish = stack.every(Boolean);
  const trendBearish = stack.every((x) => !x);

  let momentumSc = momentumScore(tech.rsi);
  momentumSc += tech.macd > tech.macdSignal ? 1 : -1;
  if (tech.adx > 25) momentumSc += tech.macd > tech.macdSignal ? 0.5 : -0.5;
  momentumSc = clamp(momentumSc, 0, 10);

  const atrPct = (tech.atr / tech.cmp) * 100;
  const volScore =
    atrPct < 0.5 ? 9 : atrPct < 0.8 ? 7 : atrPct < 1.2 ? 5 : atrPct < 1.8 ? 3 : 1;
  const volWord =
    volScore >= 7 ? "Low" : volScore >= 5 ? "Medium" : volScore >= 3 ? "Elevated" : "High";

  const avgExtras = extras.reduce((s, e) => s + e.score, 0) / (extras.length || 1);
  const all = [trendScore, momentumSc, volScore, ...extras.map((e) => e.score)];
  const avg = all.reduce((a, b) => a + b, 0) / all.length;

  // --- Verdict ---
  let verdict: "BUY" | "SELL" | "HOLD";
  if (trendScore >= 7 && momentumSc >= 6 && avgExtras >= 6) verdict = "BUY";
  else if (trendScore <= 4 && momentumSc <= 4 && avgExtras <= 4) verdict = "SELL";
  else verdict = "HOLD";

  const market_bias: "Bullish" | "Bearish" | "Neutral" = trendBullish
    ? "Bullish"
    : trendBearish
      ? "Bearish"
      : avg >= 5.5
        ? "Bullish"
        : avg <= 4.5
          ? "Bearish"
          : "Neutral";

  // --- ATR-based levels, sized to volatility AND the horizon ---
  // (daily ATR scaled down for intraday, up modestly for longer holds — this
  // is what keeps targets realistic instead of inflated.)
  const cmp = tech.cmp;
  const atr = tech.atr;
  const SL_ATR: Record<Horizon, number> = { intraday: 0.4, short: 1.0, long: 1.8 };
  const TGT_ATR: Record<Horizon, number> = { intraday: 0.7, short: 2.0, long: 3.6 };
  const slDist = atr * SL_ATR[horizon];
  // Realistic volatility target. The user's desired % can only make it tighter
  // (more conservative), never inflate it; floor keeps reward:risk >= 1.2.
  let finalTarget = atr * TGT_ATR[horizon];
  if (profitPct > 0) finalTarget = Math.min(finalTarget, cmp * (profitPct / 100));
  finalTarget = Math.max(finalTarget, slDist * 1.2);
  // Nearest pivots/extremes kept for the report's context only.
  const supports = [tech.s1, tech.s2, tech.low1m].filter((x) => x < cmp);
  const nearestSupport = supports.length ? Math.max(...supports) : cmp - slDist;
  const resistances = [tech.r1, tech.r2, tech.high1m].filter((x) => x > cmp);
  const nearestResist = resistances.length ? Math.min(...resistances) : cmp + slDist;

  const entry = `${rnd(cmp * 0.999)} - ${rnd(cmp * 1.001)}`;
  const buySL = cmp - slDist;
  const sellSL = cmp + slDist;
  const buyT2 = cmp + finalTarget;
  const sellT2 = cmp - finalTarget;
  const buyRR = (buyT2 - cmp) / (cmp - buySL);
  const sellRR = (cmp - sellT2) / (sellSL - cmp);

  let buyProb = clamp(
    Math.round(
      45 +
        (trendScore - 5) * 4 +
        (momentumSc - 5) * 3.5 +
        (avgExtras - 5) * 5 +
        (volScore - 5) * 1,
    ),
    5,
    95,
  );
  let sellProb = clamp(100 - buyProb, 5, 95);

  let timeNote = "";
  if (instrument === "nifty" && horizon === "intraday" && sess.open && sess.minutesToClose < 75) {
    const penalty = Math.round((75 - sess.minutesToClose) / 4);
    buyProb = clamp(buyProb - penalty, 5, 95);
    sellProb = clamp(sellProb - penalty, 5, 95);
    timeNote = `Only ~${sess.minutesToClose} min to the close, so intraday targets have limited time to play out — size down.`;
  }

  // Both instruments are real-money: demand strong confluence, not just a
  // probability edge. Require an aligned EMA trend, a real ADX trend, matching
  // momentum (RSI band + MACD), and a high conviction bar.
  const strict = true;
  const minProb = instrument === "gold" ? 65 : 60;
  const adxOk = tech.adx >= 20;
  const buyConfirm =
    !strict ||
    (trendScore >= 6 &&
      adxOk &&
      tech.rsi >= 45 &&
      tech.rsi <= 72 &&
      tech.macd > tech.macdSignal &&
      buyRR >= 1.5);
  const sellConfirm =
    !strict ||
    (trendScore <= 4 &&
      adxOk &&
      tech.rsi >= 28 &&
      tech.rsi <= 55 &&
      tech.macd < tech.macdSignal &&
      sellRR >= 1.5);

  const intradayOk = instrument === "gold" || horizon !== "intraday" || sess.open;
  const buyEligible =
    (verdict === "BUY" || (verdict === "HOLD" && market_bias === "Bullish")) &&
    buyProb >= minProb && buyConfirm && intradayOk;
  const sellEligible =
    (verdict === "SELL" || (verdict === "HOLD" && market_bias === "Bearish")) &&
    sellProb >= minProb && sellConfirm && intradayOk;

  const noTrade = !buyEligible && !sellEligible;
  let noTradeReason = "";
  if (noTrade) {
    const dom = buyProb >= sellProb ? "BUY" : "SELL";
    const domP = Math.max(buyProb, sellProb);
    const scoreLine = `Trend ${trendScore}/10, momentum ${momentumSc.toFixed(1)}/10, volatility ${volScore}/10, ${extras.map((e) => `${e.label.toLowerCase()} ${e.score.toFixed(1)}/10`).join(", ")}.`;
    if (instrument === "nifty" && horizon === "intraday" && !sess.open) {
      noTradeReason = `Intraday trading needs a live NSE session — it is currently ${sess.label.toLowerCase()}. Try Short or Long, or wait for the 09:15 IST open.`;
    } else if (strict) {
      const miss: string[] = [];
      if (domP < minProb) miss.push(`win probability (${domP}%) is below the ${minProb}% high-conviction bar`);
      if (!adxOk) miss.push(`trend strength is weak (ADX ${tech.adx.toFixed(0)} < 20 — choppy/rangebound)`);
      if (trendScore > 4 && trendScore < 6) miss.push("price is not cleanly aligned above/below its 20/50/200-EMAs");
      if (tech.macd > tech.macdSignal && tech.rsi > 72) miss.push("momentum is overbought");
      if (miss.length === 0) miss.push("the trend, momentum and macro signals do not yet line up");
      const label = instrument === "gold" ? "GOLD" : "NIFTY 50";
      noTradeReason = `No high-conviction ${label} setup. With real capital at stake, this engine only signals on strong confluence — ${miss.join("; ")}. ${scoreLine} Standing aside protects your capital; wait for a clean trend + momentum + ADX alignment.`;
    } else {
      const why =
        market_bias === "Neutral"
          ? "signals are balanced/conflicting with no directional edge"
          : `the ${market_bias.toLowerCase()} lean is not strong enough to clear the ${minProb}% edge`;
      noTradeReason = `No high-probability setup right now: the best side (${dom}) only reaches ${domP}% win probability, and ${why}. ${scoreLine}${timeNote ? " " + timeNote : ""} Staying flat is the higher-probability choice.`;
    }
  }

  const confidence =
    verdict === "BUY" ? buyProb : verdict === "SELL" ? sellProb
      : clamp(Math.round(40 + Math.abs(avg - 5) * 10), 30, 70);

  const market_summary: Record<string, string> = {
    trend: trendBullish ? "Bullish" : trendBearish ? "Bearish" : "Neutral",
    momentum: momentumSc >= 7 ? "Strong" : momentumSc >= 5 ? "Moderate" : "Weak",
    volatility: volWord,
  };
  for (const e of extras) market_summary[e.key] = e.word;

  const inputs: Record<string, number | string> = {
    cmp: rnd(cmp),
    ema20: rnd(tech.ema20),
    ema50: rnd(tech.ema50),
    ema200: rnd(tech.ema200),
    rsi: Math.round(tech.rsi * 10) / 10,
    adx: Math.round(tech.adx * 10) / 10,
    atr: rnd(atr),
    finalTargetPts: rnd(finalTarget),
    nearestSupport: rnd(nearestSupport),
    nearestResist: rnd(nearestResist),
    horizon: HLABEL[horizon],
    profitPct,
  };
  const scores: Record<string, number> = {
    trend: trendScore,
    momentum: Math.round(momentumSc * 10) / 10,
    volatility: volScore,
    average: Math.round(avg * 10) / 10,
  };
  for (const e of extras) scores[e.key] = Math.round(e.score * 10) / 10;

  const buy_strategy: Strategy = {
    show: buyEligible, side: "buy", entry_zone: entry, entry_mid: rnd(cmp),
    stop_loss: rnd(buySL), target_1: rnd(cmp + finalTarget * 0.5), target_2: rnd(buyT2),
    risk_reward: `1:${buyRR.toFixed(1)}`, probability: buyProb,
  };
  const sell_strategy: Strategy = {
    show: sellEligible, side: "sell", entry_zone: entry, entry_mid: rnd(cmp),
    stop_loss: rnd(sellSL), target_1: rnd(cmp - finalTarget * 0.5), target_2: rnd(sellT2),
    risk_reward: `1:${sellRR.toFixed(1)}`, probability: sellProb,
  };

  const holdBaseline = estimateHold(instrument, horizon, finalTarget, atr, tech.adx, sess);

  const base: StrategyResponse = {
    recommendation: { verdict, confidence, market_bias },
    market_summary, buy_strategy, sell_strategy,
    report: { thesis: "", risks: [], stop_rationale: "", targets_view: "", invalidation: "", hold: holdBaseline },
    no_trade: noTrade, no_trade_reason: noTradeReason,
    market_open: sess.open, minutes_to_close: sess.minutesToClose, session: sess.label,
    inputs, scores, horizon, instrument, engine: "deterministic", available: true,
    fetchedAt: new Date().toISOString(),
  };

  const ai = await writeReport(base, instrument, timeNote, holdBaseline);
  base.report = ai ?? templateReport(base, holdBaseline);
  if (ai) base.engine = "openai";
  // No setup -> drop the trade-specific sections; keep the analysis (thesis + risks).
  if (noTrade) {
    base.report.stop_rationale = "";
    base.report.targets_view = "";
    base.report.invalidation = "";
    base.report.hold = "";
  }
  return base;
}

async function writeReport(
  s: StrategyResponse,
  instrument: Instrument,
  timeNote: string,
  holdBaseline: string,
): Promise<StrategyReport | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const asset = instrument === "gold" ? "spot gold (per gram)" : "the NIFTY 50 index";
  const payload = JSON.stringify({
    asset, recommendation: s.recommendation, market_summary: s.market_summary,
    scores: s.scores, inputs: s.inputs, buy: s.buy_strategy, sell: s.sell_strategy,
    horizon: s.horizon, session: s.session, timeNote, noTrade: s.no_trade,
  });
  const factorNote =
    instrument === "gold"
      ? "trend (CMP vs EMA20/50/200 stack), momentum (RSI/MACD/ADX), the US dollar, real yields/Fed policy, inflation, and risk/geopolitical sentiment"
      : "trend (CMP vs EMA20/50/200 stack & structure), market breadth (% of Nifty stocks above their 50-EMA), momentum (RSI/MACD/ADX), institutional flows (FII/DII, USD/INR), RBI policy, US Fed/global liquidity, India inflation, and geopolitical risk";
  const system = `You are a veteran buy-side strategist with 30+ years trading ${asset}.
This is a REAL-MONEY decision; people act on it, so reason like a seasoned
professional, not a generalist. Work through ${factorNote}. Demand CONFLUENCE
(multiple factors agreeing) before endorsing a side; if the picture is mixed,
weak-trend (low ADX), counter-trend, or overextended, state that the disciplined
move is to STAND ASIDE and protect capital. Targets must be sized to volatility
(ATR) and market structure — never arbitrary; comment if they look too ambitious
for the horizon. Reference the actual numbers (CMP, EMAs, RSI, ADX, ATR, the
scores) in your reasoning.

If "noTrade" is true, the disciplined call is to STAND ASIDE: make the "thesis" a
thorough but SIMPLE, plain-English walkthrough — go factor by factor (trend &
EMAs, momentum RSI/MACD/ADX, breadth/flows, macro, volatility), explain in easy
words what each is saying and exactly why they don't line up for a high-conviction
trade, and what you'd need to see to take one. In that case set "stop_rationale",
"targets_view" and "invalidation" to empty strings "".

Given the precomputed analysis JSON, return STRICT JSON with these fields (plain
text, NO markdown, NO asterisks, NO disclaimers, use the exact numeric levels):
{
  "thesis": "if a trade: 3-5 sentences on the stance + confluence (cite numbers). If noTrade: a clear, simple, detailed factor-by-factor read of why there's no setup.",
  "risks": ["specific risk 1", "specific risk 2", "specific risk 3"],
  "stop_rationale": "1-2 sentences on why the stop sits where it does (ATR-based distance vs structure).",
  "targets_view": "1-2 sentences on whether the targets are realistic given ATR and the horizon, and the reward:risk.",
  "invalidation": "1 sentence on the precise condition that invalidates the setup.",
  "hold": "the SPECIFIC expected holding time YOU decide for this trade by weighing ATR (speed of moves), ADX (trend strength), momentum and the distance to target — e.g. 'intraday, exit before close', '3-5 trading sessions', '2-3 weeks'. Not a generic range."
}
A rough model-based baseline is "${holdBaseline}" — refine it using the data; do not just copy it.
Be precise, specific and professional.`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, temperature: 0.35,
        max_tokens: 1100,
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
    const risks = Array.isArray(p.risks)
      ? p.risks.map((r: unknown) => String(r).trim()).filter(Boolean).slice(0, 4)
      : [];
    if (!p.thesis || risks.length === 0) return null;
    return {
      thesis: String(p.thesis).trim(), risks,
      stop_rationale: String(p.stop_rationale ?? "").trim(),
      targets_view: String(p.targets_view ?? "").trim(),
      invalidation: String(p.invalidation ?? "").trim(),
      hold: String(p.hold ?? "").trim() || holdBaseline,
    };
  } catch {
    return null;
  }
}

function templateReport(s: StrategyResponse, holdBaseline: string): StrategyReport {
  const r = s.recommendation;
  const i = s.inputs;
  return {
    thesis: `Verdict ${r.verdict} with a ${r.market_bias} bias (confidence ${r.confidence}%). CMP ${i.cmp} vs EMA20 ${i.ema20} / EMA50 ${i.ema50} / EMA200 ${i.ema200}; momentum ${s.scores.momentum}/10.`,
    risks: [
      `${s.market_summary.volatility} volatility can widen swings.`,
      `Trend is ${s.market_summary.trend.toLowerCase()} — sentiment can flip on fresh data.`,
    ],
    stop_rationale: `Stop sits ${i.atr} (1 ATR-scaled) from entry to stay outside normal noise.`,
    targets_view: `Targets are sized to ATR for this horizon (${i.finalTargetPts} pts), keeping reward:risk sound.`,
    invalidation: `A sustained close beyond the stop, or a sharp shift in the drivers, invalidates the setup.`,
    hold: holdBaseline,
  };
}

function unavailable(
  instrument: Instrument,
  horizon: Horizon,
  sess: { open: boolean; minutesToClose: number; label: string },
): StrategyResponse {
  const blank: Strategy = {
    show: false, side: "buy", entry_zone: "—", entry_mid: 0, stop_loss: 0,
    target_1: 0, target_2: 0, risk_reward: "—", probability: 0,
  };
  return {
    recommendation: { verdict: "HOLD", confidence: 0, market_bias: "Neutral" },
    market_summary: {},
    buy_strategy: blank, sell_strategy: { ...blank, side: "sell" },
    report: { thesis: "", risks: [], stop_rationale: "", targets_view: "", invalidation: "", hold: "" },
    no_trade: true,
    no_trade_reason: "Live technicals are unavailable right now (the feed may be unreachable).",
    market_open: sess.open, minutes_to_close: sess.minutesToClose, session: sess.label,
    inputs: {}, scores: {}, horizon, instrument, engine: "deterministic",
    available: false, fetchedAt: new Date().toISOString(),
  };
}

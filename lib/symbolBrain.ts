import type { TvSymbol } from "./sources/tvSymbol";
import type { SymbolTechnicals } from "./symbol";
import { webSearch } from "./chat";

// Disciplined signal engine for any TradingView symbol. The BUY/SELL decision is
// made in code from technical confluence — we only call a direction when several
// independent reads agree AND the market is actually trending, so a signal means
// a genuinely high-probability setup. Everything else is "Hold / Wait". The LLM
// only writes the human narrative and answers follow-up questions; it never
// invents the signal.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export type Signal = "Buy" | "Sell" | "Hold / Wait";

export interface SymbolVerdict {
  signal: Signal;
  confidence: number; // 0-100
  summary: string;
  reasons: string[];
  risks: string[];
  factors: string[]; // raw technical reads
  entry: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  rr: number | null; // reward:risk on target1
  horizon: string;
  engine: "ai" | "rules";
}

const decimals = (p: number) => (p >= 100 ? 2 : p >= 1 ? 3 : 6);
const round = (n: number, p: number) => {
  const d = decimals(p);
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Pure-technical confluence verdict. This is the source of truth for the signal. */
export function ruleVerdict(t: SymbolTechnicals): SymbolVerdict {
  const num = (x: number) => Number.isFinite(x);
  const price = t.price;
  const atr = num(t.atr) && t.atr > 0 ? t.atr : price * 0.015;

  // Individual reads (only count those we actually have data for).
  const buyChecks: [boolean, string][] = [
    [num(t.ema20) && price > t.ema20, "Price above the 20-EMA"],
    [num(t.ema50) && t.ema20 > t.ema50, "20-EMA above 50-EMA (short-term up)"],
    [num(t.ema200) && t.ema50 > t.ema200, "50-EMA above 200-EMA (primary uptrend)"],
    [num(t.macd) && num(t.macdSignal) && t.macd > t.macdSignal, "MACD above its signal (bullish momentum)"],
    [num(t.rsi) && t.rsi >= 50 && t.rsi <= 70, `RSI ${num(t.rsi) ? t.rsi.toFixed(0) : "?"} — firm but not overbought`],
    [num(t.adx) && t.adx >= 20, `ADX ${num(t.adx) ? t.adx.toFixed(0) : "?"} — a real trend, not chop`],
  ];
  const sellChecks: [boolean, string][] = [
    [num(t.ema20) && price < t.ema20, "Price below the 20-EMA"],
    [num(t.ema50) && t.ema20 < t.ema50, "20-EMA below 50-EMA (short-term down)"],
    [num(t.ema200) && t.ema50 < t.ema200, "50-EMA below 200-EMA (primary downtrend)"],
    [num(t.macd) && num(t.macdSignal) && t.macd < t.macdSignal, "MACD below its signal (bearish momentum)"],
    [num(t.rsi) && t.rsi <= 50 && t.rsi >= 30, `RSI ${num(t.rsi) ? t.rsi.toFixed(0) : "?"} — weak but not oversold`],
    [num(t.adx) && t.adx >= 20, `ADX ${num(t.adx) ? t.adx.toFixed(0) : "?"} — a real trend, not chop`],
  ];

  const buyScore = buyChecks.filter(([ok]) => ok).length;
  const sellScore = sellChecks.filter(([ok]) => ok).length;
  const trending = num(t.adx) ? t.adx >= 20 : false;
  const rsiOk = num(t.rsi);

  let signal: Signal = "Hold / Wait";
  let confidence = 45;
  let factors: string[] = [];

  // High-probability gate: >=5 of 6 reads aligned AND a confirmed trend.
  if (buyScore >= 5 && trending && (!rsiOk || t.rsi < 72)) {
    signal = "Buy";
    confidence = buyScore >= 6 ? 85 : 73;
    factors = buyChecks.filter(([ok]) => ok).map(([, s]) => s);
  } else if (sellScore >= 5 && trending && (!rsiOk || t.rsi > 28)) {
    signal = "Sell";
    confidence = sellScore >= 6 ? 85 : 73;
    factors = sellChecks.filter(([ok]) => ok).map(([, s]) => s);
  } else {
    // Show whichever side is leaning, so the user sees why it's a wait.
    const lean = buyScore >= sellScore ? buyChecks : sellChecks;
    factors = lean.filter(([ok]) => ok).map(([, s]) => s);
    confidence = 40 + Math.max(buyScore, sellScore) * 3;
  }

  let entry: number | null = null;
  let stop: number | null = null;
  let target1: number | null = null;
  let target2: number | null = null;
  let rr: number | null = null;

  if (signal === "Buy") {
    entry = round(price, price);
    stop = round(price - 1.5 * atr, price);
    target1 = round(price + 2 * atr, price);
    target2 = round(price + 3.5 * atr, price);
    rr = round((target1 - entry) / (entry - stop), 100);
  } else if (signal === "Sell") {
    entry = round(price, price);
    stop = round(price + 1.5 * atr, price);
    target1 = round(price - 2 * atr, price);
    target2 = round(price - 3.5 * atr, price);
    rr = round((entry - target1) / (stop - entry), 100);
  }

  return {
    signal,
    confidence,
    summary: "",
    reasons: [],
    risks: [],
    factors,
    entry,
    stop,
    target1,
    target2,
    rr,
    horizon: "swing (days to a few weeks)",
    engine: "rules",
  };
}

function templatedNarrative(meta: TvSymbol, t: SymbolTechnicals, v: SymbolVerdict) {
  const name = meta.description || meta.ticker;
  if (v.signal === "Hold / Wait") {
    v.summary = `${name} isn't offering a high-probability setup right now — the trend and momentum reads don't line up strongly enough on either side, so the disciplined call is to wait.`;
    v.reasons = v.factors.length ? v.factors : ["Mixed technical picture — no clear edge."];
    v.risks = ["Forcing a trade in a choppy/range-bound tape is where accounts bleed."];
  } else {
    const dir = v.signal === "Buy" ? "long" : "short";
    v.summary = `${name} shows a high-confluence ${v.signal.toLowerCase()} setup (${v.confidence}% confidence): multiple trend and momentum reads agree. Plan a ${dir} from ${v.entry} with a stop at ${v.stop} and targets ${v.target1} / ${v.target2}.`;
    v.reasons = v.factors;
    v.risks = [
      "A close back through the stop invalidates the setup — honour it.",
      "News/earnings or a broad-market reversal can override the technicals.",
    ];
  }
  return v;
}

/** Full verdict: rule-based signal + (optional) AI-written narrative. */
export async function analyzeSymbol(
  meta: TvSymbol,
  t: SymbolTechnicals,
): Promise<SymbolVerdict> {
  const v = ruleVerdict(t);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return templatedNarrative(meta, t, v);

  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const payload = {
    instrument: { symbol: meta.symbol, name: meta.description, type: meta.type, currency: meta.currency },
    computedSignal: { signal: v.signal, confidence: v.confidence, entry: v.entry, stop: v.stop, target1: v.target1, target2: v.target2 },
    technicals: t,
  };
  const system = `You are a veteran buy-side technical strategist. A disciplined rule engine has ALREADY decided the signal for this instrument — your job is ONLY to explain it clearly and professionally. NEVER contradict or change the signal, levels, or direction you are given.

Rules:
- Plain, confident English. No hype, no disclaimers, no markdown headings.
- Reference the ACTUAL numbers (price vs EMAs, RSI, MACD, ADX, ATR, pivots).
- If the signal is "Hold / Wait", make clear there is no high-probability edge right now and why.
- A Buy/Sell is only ever issued on strong confluence, so frame it as a genuine high-probability setup, while being honest about what would invalidate it.

Return ONLY strict JSON:
{"summary":"2-3 sentence thesis citing the key numbers","reasons":["specific quantitative reason", "..."],"risks":["what would invalidate this", "..."]}`;

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const j = await res.json();
    const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
    v.summary = (parsed.summary ?? "").toString().trim() || v.summary;
    v.reasons = Array.isArray(parsed.reasons) && parsed.reasons.length
      ? parsed.reasons.map((r: unknown) => String(r).trim()).filter(Boolean)
      : v.reasons;
    v.risks = Array.isArray(parsed.risks) && parsed.risks.length
      ? parsed.risks.map((r: unknown) => String(r).trim()).filter(Boolean)
      : v.risks;
    v.engine = "ai";
    if (!v.summary) templatedNarrative(meta, t, v);
    return v;
  } catch {
    return templatedNarrative(meta, t, v);
  }
}

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/** Conversational follow-up about the symbol, with live web search. */
export async function chatSymbol(
  meta: TvSymbol,
  t: SymbolTechnicals,
  verdict: SymbolVerdict,
  messages: ChatMsg[],
): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return "The AI brain needs an OpenAI key configured on the server.";
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const name = meta.description || meta.ticker;

  const system = `You are the dedicated analyst for ${name} (${meta.symbol}). You ONLY discuss this instrument.

Current live read (use the real numbers; the signal below was set by a disciplined rule engine — never contradict it):
${JSON.stringify({ price: t.price, changePct: t.changePct, rsi: t.rsi, ema20: t.ema20, ema50: t.ema50, ema200: t.ema200, macd: t.macd, macdSignal: t.macdSignal, adx: t.adx, atr: t.atr, signal: verdict.signal, confidence: verdict.confidence, entry: verdict.entry, stop: verdict.stop, target1: verdict.target1, target2: verdict.target2 })}

How to answer:
- Plain, concise English. No markdown headings, no fluff.
- Only call a Buy or Sell when there is genuinely high-probability confluence; otherwise say it's a wait and why. Be honest about risk.
- For facts not in the live read (history, all-time highs, earnings dates, news), call web_search instead of guessing. Never invent numbers.
- If asked about anything other than ${name}, briefly steer back.`;

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "web_search",
        description: `Search the live internet for facts about ${name} not in the live read — history, records, earnings, recent news. Use instead of guessing.`,
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "a focused search query" } },
          required: ["query"],
        },
      },
    },
  ];

  const convo: unknown[] = [
    { role: "system", content: system },
    ...messages.filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content).slice(-12),
  ];

  try {
    for (let round = 0; round < 4; round++) {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, temperature: 0.4, max_tokens: 500, tools, tool_choice: "auto", messages: convo }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const j = await res.json();
      const msg = j.choices?.[0]?.message;
      const calls = (msg?.tool_calls ?? []) as Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      if (!calls.length) {
        return (msg?.content ?? "").toString().trim() || "Sorry, I couldn't generate a reply — try again.";
      }
      convo.push(msg);
      for (const c of calls) {
        let result = "Unknown tool.";
        if (c.function?.name === "web_search") {
          let q = "";
          try {
            q = (JSON.parse(c.function?.arguments || "{}").query ?? "").toString();
          } catch {
            /* ignore */
          }
          result = q ? await webSearch(q, key) : "No query provided.";
        }
        convo.push({ role: "tool", tool_call_id: c.id, content: result });
      }
    }
    return "Sorry, I couldn't pull that together just now — please try again.";
  } catch {
    return "The analyst is unreachable right now. Please try again in a moment.";
  }
}

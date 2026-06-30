import { getMetrics } from "./macro";
import { getNiftyData } from "./instruments/nifty";
import { getSensexData } from "./instruments/sensex";
import { getNews, getNiftyNews } from "./sources/news";
import {
  averageOf,
  computeFactors,
  computeNiftyFactors,
  recommendationFor,
} from "./analysis";
import { addAlert, ensureAlertMonitor } from "./alerts";

export type Inst = "nifty" | "gold" | "sensex";
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Live internet lookup for facts the snapshot doesn't carry (all-time highs,
 * historical prices, records, recent events). Uses OpenAI's web-search model,
 * so it needs only the existing OPENAI_API_KEY. Returns grounded text (with the
 * sources the model cites) or a short "unavailable" note — never throws.
 */
export async function webSearch(query: string, key: string): Promise<string> {
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        // Search-grounded models don't accept temperature/tools — keep it minimal.
        model: process.env.WEB_SEARCH_MODEL || "gpt-4o-search-preview",
        web_search_options: {},
        messages: [
          {
            role: "system",
            content:
              "Search the web and answer with current, factual data. Give the specific number(s), the exact date, and the unit, and name the source. Be concise.",
          },
          { role: "user", content: query },
        ],
      }),
    });
    if (!res.ok) throw new Error(`search ${res.status}`);
    const j = await res.json();
    const text = (j.choices?.[0]?.message?.content ?? "").toString().trim();
    return text || "No results found.";
  } catch {
    return "Web search is unavailable right now — do not guess; tell the user you couldn't verify this.";
  }
}

/** Build a compact live-data snapshot the brain is preloaded with. */
async function context(instrument: Inst) {
  if (instrument === "gold") {
    const [b, news] = await Promise.all([getMetrics(), getNews()]);
    const f = computeFactors(b.metrics, news);
    return {
      asset: "Gold — spot XAU, priced in USD per gram",
      price: b.gold ? { perGram: r2(b.gold.value), changePct: b.gold.changePct } : null,
      indicators: b.metrics.map((m) => ({
        name: m.label,
        value: r2(m.value),
        changePct: m.changePct == null ? null : r2(m.changePct),
      })),
      factors: f.map((x) => ({ name: x.label, score: x.score, lean: x.bias })),
      overallLean: recommendationFor(averageOf(f)),
      headlines: news.slice(0, 8).map((n) => n.title),
    };
  }
  const [b, news] = await Promise.all([
    instrument === "sensex" ? getSensexData() : getNiftyData(),
    getNiftyNews(),
  ]);
  const f = computeNiftyFactors(b.metrics, news);
  return {
    asset:
      instrument === "sensex"
        ? "BSE Sensex — BSE 30-stock benchmark index (points)"
        : "Nifty 50 — NSE benchmark index (points)",
    price: b.index ? { level: r2(b.index.value), changePct: b.index.changePct } : null,
    indicators: b.metrics.map((m) => ({
      name: m.label,
      value: r2(m.value),
      changePct: m.changePct == null ? null : r2(m.changePct),
    })),
    factors: f.map((x) => ({ name: x.label, score: x.score, lean: x.bias })),
    overallLean: recommendationFor(averageOf(f)),
    headlines: news.slice(0, 8).map((n) => n.title),
  };
}

export async function answerChat(
  instrument: Inst,
  messages: ChatMessage[],
  userEmail?: string | null,
): Promise<{ reply: string }> {
  const key = process.env.OPENAI_API_KEY;
  const name =
    instrument === "gold" ? "Gold" : instrument === "sensex" ? "BSE Sensex" : "Nifty 50";
  if (!key) {
    return { reply: "The AI brain needs an OpenAI key configured on the server." };
  }
  ensureAlertMonitor();
  const ctx = await context(instrument);
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const unit = instrument === "gold" ? "USD per gram" : "index points";
  const sfx = instrument === "gold" ? " /g" : "";
  const priceObj = ctx.price as { perGram?: number; level?: number } | null;
  const cur = priceObj ? priceObj.perGram ?? priceObj.level ?? null : null;

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "set_price_alert",
        description: `Create an email price alert for ${name}. Use whenever the user asks to be alerted/notified/emailed when the ${name} price reaches, crosses, goes above, or drops below a level. The alert is automatically sent to the signed-in user's registered email — never ask the user for an email address.`,
        parameters: {
          type: "object",
          properties: {
            threshold: { type: "number", description: `the ${name} price level to watch (${unit})` },
            direction: { type: "string", enum: ["above", "below"], description: "fire when price goes above or below the threshold" },
          },
          required: ["threshold", "direction"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "web_search",
        description: `Search the live internet for facts about ${name} that are NOT in the live data snapshot you were given — e.g. the all-time high, historical or past prices, records, specific dates, or recent news figures. ALWAYS use this instead of guessing or relying on memory whenever you are not certain a number is correct and current.`,
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: `a focused web search query, e.g. "${name} all-time high price and date"`,
            },
          },
          required: ["query"],
        },
      },
    },
  ];

  const unitNote =
    instrument === "gold"
      ? `IMPORTANT — units: the live price above is in USD per GRAM. The global market normally quotes gold in USD per TROY OUNCE (1 troy ounce = 31.1035 grams). Always state which unit you mean, and convert when the user's framing implies the other unit. Historical figures (e.g. the all-time high) are almost always quoted per ounce.`
      : `IMPORTANT — units: the live level above is in index points.`;

  const system = `You are the dedicated AI brain for ${name}. You ONLY talk about ${name} (${ctx.asset}).

Here is the CURRENT live data — use it whenever relevant and quote the real numbers:
${JSON.stringify(ctx)}

${unitNote}

Accuracy rules (critical):
- The snapshot above only has CURRENT values. It does NOT contain historical data, all-time highs, past prices, or records.
- For ANY fact that isn't in the snapshot — all-time high, historical/past prices, records, specific dates, recent news figures — or whenever you are not certain a number is correct and current, you MUST call web_search and base your answer on what it returns. Do NOT answer such questions from memory.
- Never invent or guess a number. If web_search comes back empty or unavailable, say you couldn't verify it rather than making something up.
- When you cite a figure from web_search, include the date/context and (briefly) the source.

How to answer:
- Very simple, plain English. Short and to the point. No fluff, no filler, no disclaimers, no markdown headings.
- Prefer 1-4 short sentences or a tight bullet list. Quote real numbers when useful.
- If the user asks for a price alert, call set_price_alert with just the level and direction. It goes to their registered email automatically — never ask them for an email address.
- If the user asks about anything not related to ${name}, briefly say you only cover ${name} and steer back.`;

  const trimmed = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-12);

  // Running transcript, extended each time the model calls a tool.
  const convo: unknown[] = [{ role: "system", content: system }, ...trimmed];

  try {
    // Allow a few tool rounds (web searches) before the model must answer.
    for (let round = 0; round < 4; round++) {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: 500,
          tools,
          tool_choice: "auto",
          messages: convo,
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const json = await res.json();
      const msg = json.choices?.[0]?.message;

      const calls = (msg?.tool_calls ?? []) as Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;

      // No tool call -> this is the final answer.
      if (!calls.length) {
        const reply = (msg?.content ?? "").toString().trim();
        return { reply: reply || "Sorry, I couldn't generate a reply — try again." };
      }

      // A price-alert request is terminal — handle it and return immediately.
      const alertCall = calls.find((c) => c.function?.name === "set_price_alert");
      if (alertCall) {
        let args: { threshold?: number; direction?: string } = {};
        try {
          args = JSON.parse(alertCall.function?.arguments || "{}");
        } catch {
          /* ignore */
        }
        const threshold = Number(args.threshold);
        const email = String(userEmail ?? "").trim();
        const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
        if (!emailOk) {
          return {
            reply: "Please sign in so I can send the alert to your registered email address.",
          };
        }
        if (!Number.isFinite(threshold) || threshold <= 0) {
          return { reply: "What price level should I set the alert at?" };
        }
        // Derive direction from the live price when we have it (most reliable).
        const direction: "above" | "below" =
          cur != null ? (threshold >= cur ? "above" : "below") : args.direction === "below" ? "below" : "above";
        const id = await addAlert(instrument, email, threshold, direction);
        if (!id) {
          return { reply: "Sorry, I couldn't save that alert right now. Please try again." };
        }
        return {
          reply: `Done. I'll email ${email} as soon as ${name} goes ${direction} ${threshold}${sfx}.${cur != null ? ` (Now: ${cur}${sfx}.)` : ""}`,
        };
      }

      // Otherwise run the (web_search) tool calls and feed the results back.
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

    // Exhausted the tool rounds without the model settling on an answer.
    return { reply: "Sorry, I couldn't pull that together just now — please try again." };
  } catch {
    return { reply: "The brain is unreachable right now. Please try again in a moment." };
  }
}

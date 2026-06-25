import { getMetrics } from "./macro";
import { getNiftyData } from "./instruments/nifty";
import { getNews, getNiftyNews } from "./sources/news";
import {
  averageOf,
  computeFactors,
  computeNiftyFactors,
  recommendationFor,
} from "./analysis";
import { addAlert, ensureAlertMonitor } from "./alerts";

export type Inst = "nifty" | "gold";
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

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
  const [b, news] = await Promise.all([getNiftyData(), getNiftyNews()]);
  const f = computeNiftyFactors(b.metrics, news);
  return {
    asset: "Nifty 50 — NSE benchmark index (points)",
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
): Promise<{ reply: string }> {
  const key = process.env.OPENAI_API_KEY;
  const name = instrument === "gold" ? "Gold" : "Nifty 50";
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
        description: `Create an email price alert for ${name}. Use whenever the user asks to be alerted/notified/emailed when the ${name} price reaches, crosses, goes above, or drops below a level. The user MUST give an email address — if they have not, do NOT call this; ask them for their email first.`,
        parameters: {
          type: "object",
          properties: {
            threshold: { type: "number", description: `the ${name} price level to watch (${unit})` },
            direction: { type: "string", enum: ["above", "below"], description: "fire when price goes above or below the threshold" },
            email: { type: "string", description: "the user's email address" },
          },
          required: ["threshold", "direction", "email"],
        },
      },
    },
  ];

  const system = `You are the dedicated AI brain for ${name}. You ONLY talk about ${name} (${ctx.asset}).

Here is the CURRENT live data — use it whenever relevant and quote the real numbers:
${JSON.stringify(ctx)}

How to answer:
- Very simple, plain English. Short and to the point. No fluff, no filler, no disclaimers, no markdown headings.
- Prefer 1-4 short sentences or a tight bullet list. Quote live numbers when useful.
- If you genuinely don't have a figure, say so — never invent data.
- If the user asks about anything not related to ${name}, briefly say you only cover ${name} and steer back.`;

  const trimmed = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-12);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 450,
        tools,
        tool_choice: "auto",
        messages: [{ role: "system", content: system }, ...trimmed],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const json = await res.json();
    const msg = json.choices?.[0]?.message;

    const calls = (msg?.tool_calls ?? []) as Array<{
      function?: { name?: string; arguments?: string };
    }>;
    const call = calls.find((c) => c.function?.name === "set_price_alert");
    if (call) {
      let args: { threshold?: number; direction?: string; email?: string } = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        /* ignore */
      }
      const threshold = Number(args.threshold);
      const email = String(args.email ?? "").trim();
      const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
      if (!emailOk || !Number.isFinite(threshold) || threshold <= 0) {
        return {
          reply: "To set that alert I need a valid email and a price level — what email should I send it to?",
        };
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

    const reply = (msg?.content ?? "").toString().trim();
    return { reply: reply || "Sorry, I couldn't generate a reply — try again." };
  } catch {
    return { reply: "The brain is unreachable right now. Please try again in a moment." };
  }
}

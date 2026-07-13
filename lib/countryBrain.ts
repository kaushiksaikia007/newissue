import { tvQuotes, type FullQuote } from "./sources/tvQuote";
import { getFiiDii } from "./sources/nseFiiDii";
import { findStock, suggestStocks } from "./sources/nseStocks";
import { webSearch, type ChatMessage } from "./chat";
import type { CountryBrainConfig } from "./countryBrainStore";

// Dedicated macro/markets brain for a country. India ("IN") is preloaded with a
// live-data snapshot (VIX, USD/INR, 10Y yield, Brent, FII/DII flows); other
// countries have no live data and must use web_search for any current figures.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

// TradingView symbols behind the four live India market values.
const INDIA_SYMBOLS = ["NSE:INDIAVIX", "FX_IDC:USDINR", "TVC:IN10Y", "TVC:UKOIL"];

const quote = (q: FullQuote | undefined, dp: number) =>
  q ? { value: round(q.price, dp), change: round(q.change, dp), changePct: round(q.changePct, 2) } : null;

/** The same five live values shown in the India headline, for the brain's context. */
async function indiaLiveData() {
  const [quotes, fii] = await Promise.all([tvQuotes(INDIA_SYMBOLS), getFiiDii()]);
  return {
    asOf: new Date().toISOString(),
    indiaVIX: quote(quotes.get("NSE:INDIAVIX"), 4),
    usdInr: quote(quotes.get("FX_IDC:USDINR"), 4),
    india10YearBondYieldPercent: quote(quotes.get("TVC:IN10Y"), 3),
    brentCrudeOilUsdPerBarrel: quote(quotes.get("TVC:UKOIL"), 2),
    fiiDiiCapitalMarketSegment: fii
      ? {
          date: fii.rows[0]?.date ?? null,
          unit: "INR crore",
          rows: fii.rows.map((r) => ({
            category: r.category, // "FII/FPI" | "DII"
            buyValue: r.buyValue,
            sellValue: r.sellValue,
            netValue: r.netValue,
          })),
        }
      : null,
  };
}

const WEB_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "web_search",
    description:
      "Search the live internet for facts NOT in the live-data snapshot you were given — historical/past prices, all-time highs, records, specific dates, recent news figures, or anything about the country's economy you are not certain is current. ALWAYS use this instead of guessing.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "a focused web search query" },
      },
      required: ["query"],
    },
  },
};

// India only: local knowledge base of NSE-listed company profiles.
const NSE_STOCK_TOOL = {
  type: "function" as const,
  function: {
    name: "lookup_nse_stock",
    description:
      "Look up the profile of an NSE-listed Indian company from the local knowledge base. Use this for ANY question about a specific Indian stock/company — its sector, industry, ISIN, symbol, market-cap category, founding year, headquarters, website, or what the business does. Accepts either the trading symbol (e.g. LICHSGFIN) or the company name (e.g. LIC Housing Finance). Prefer this over web_search for company profile facts.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "the NSE trading symbol or company name to look up",
        },
      },
      required: ["query"],
    },
  },
};

/** Runs the lookup and returns a compact, model-readable result. */
async function runStockLookup(query: string): Promise<string> {
  const q = (query ?? "").toString().trim();
  if (!q) return "No query provided.";
  const stock = await findStock(q);
  if (stock) return stock.raw;
  const suggestions = await suggestStocks(q);
  if (suggestions.length) {
    const list = suggestions.map((s) => `${s.symbol} (${s.name})`).join(", ");
    return `No exact match for "${q}" in the NSE knowledge base. Did you mean one of these? ${list}. If so, look it up by its symbol.`;
  }
  return `No NSE-listed company matching "${q}" was found in the local knowledge base. Do not guess its details.`;
}

/** A compact description of the user's customized brain, for the system prompt. */
function brainScopeBlock(brain: CountryBrainConfig | null | undefined): string {
  if (!brain || !brain.companies?.length) return "";
  const companies = brain.companies
    .map((c) => `${c.name} (${c.ticker}${c.sector ? `, ${c.sector}` : ""})`)
    .join("; ");
  const sectors = brain.sectors?.join(", ") || "—";
  const commodities = brain.commodities?.map((c) => c.name).join(", ") || "—";
  return `The user has CUSTOMIZED this brain. Focus your answers on their selected scope:
- Companies: ${companies}
- Sectors: ${sectors}
- Key commodities: ${commodities}
When the user asks a general question, relate it to these companies, sectors and commodities. You may still use your tools (web_search / stock lookup) for figures about them.`;
}

export async function answerCountryChat(
  code: string,
  name: string,
  messages: ChatMessage[],
  brain?: CountryBrainConfig | null,
): Promise<{ reply: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { reply: "The AI brain needs an OpenAI key configured on the server." };
  }

  const isIndia = code.toUpperCase() === "IN";
  const live = isIndia ? await indiaLiveData() : null;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const scope = brainScopeBlock(brain);

  const liveBlock = live
    ? `Here is the CURRENT live market data for ${name} — quote these real numbers whenever relevant:
${JSON.stringify(live)}

What each field means:
- indiaVIX: India VIX, the NSE volatility index (higher = more expected volatility/fear).
- usdInr: USD/INR exchange rate (rupees per 1 US dollar). A higher value means a weaker rupee.
- india10YearBondYieldPercent: India 10-year government bond yield, in percent.
- brentCrudeOilUsdPerBarrel: Brent crude oil (CFD), US dollars per barrel — a key input for India (a big oil importer).
- fiiDiiCapitalMarketSegment: latest FII/FPI and DII trading activity on NSE's Capital Market Segment — buyValue/sellValue/netValue in INR crore for the given date. FII/FPI = foreign investors, DII = domestic institutions. Net = buy − sell.

You also have a local knowledge base of NSE-listed company profiles. For ANY question about a specific Indian stock or company (its sector, industry, ISIN, symbol, market-cap category, founding year, headquarters, website, or what the business does), call lookup_nse_stock with the symbol or company name and answer strictly from what it returns. Do not guess a company's profile details.`
    : `You have NO preloaded live-data snapshot for ${name}. For any current figure, you MUST use web_search.`;

  const system = `You are the dedicated macro and markets AI brain for ${name}. You focus on ${name}'s economy and financial markets.

${liveBlock}
${scope ? `\n${scope}\n` : ""}
Accuracy rules (critical):
- The live snapshot (if present) contains ONLY current values. It has NO historical data, past prices, records, or all-time highs.
- For ANY fact not in the snapshot, or whenever you are not certain a number is current, call web_search and base your answer on what it returns. Never invent or guess a number, and never rely on memory for figures.
- If web_search is empty or unavailable, say you couldn't verify it rather than making something up. When you cite a web_search figure, include the date/context and briefly the source.

How to answer:
- Plain, simple English. Short and to the point. No fluff, no disclaimers, no markdown headings.
- Prefer 1-4 short sentences or a tight bullet list. Quote the real live numbers when they help.
- If the user asks about a country other than ${name}, briefly say you focus on ${name} and steer back.`;

  const trimmed = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-12);

  const convo: unknown[] = [{ role: "system", content: system }, ...trimmed];
  const tools = isIndia ? [WEB_SEARCH_TOOL, NSE_STOCK_TOOL] : [WEB_SEARCH_TOOL];

  try {
    // Allow a few tool rounds (web search / stock lookup) before the model answers.
    for (let attempt = 0; attempt < 4; attempt++) {
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

      if (!calls.length) {
        const reply = (msg?.content ?? "").toString().trim();
        return { reply: reply || "Sorry, I couldn't generate a reply — try again." };
      }

      convo.push(msg);
      for (const c of calls) {
        let result = "Unknown tool.";
        let args: { query?: string } = {};
        try {
          args = JSON.parse(c.function?.arguments || "{}");
        } catch {
          /* ignore */
        }
        const q = (args.query ?? "").toString();
        if (c.function?.name === "web_search") {
          result = q ? await webSearch(q, key) : "No query provided.";
        } else if (c.function?.name === "lookup_nse_stock") {
          result = await runStockLookup(q);
        }
        convo.push({ role: "tool", tool_call_id: c.id, content: result });
      }
    }
    return { reply: "Sorry, I couldn't pull that together just now — please try again." };
  } catch {
    return { reply: "The brain is unreachable right now. Please try again in a moment." };
  }
}

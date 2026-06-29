import { lookupIsin, type InstrumentDetails } from "./isin";

export interface IsinVerdict {
  available: boolean;
  recommendation: "Invest" | "Avoid" | "Hold / Watch" | "Insufficient data";
  confidence: "Very High" | "High" | "Moderate" | "Low";
  summary: string;
  reasons: string[];
  risks: string[];
  engine: "openai" | "deterministic";
  fetchedAt: string;
}

function monthsToMaturity(d?: string): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return (t - Date.now()) / (1000 * 60 * 60 * 24 * 30.44);
}

/** Deterministic fallback when no OpenAI key is configured. */
function fallback(d: InstrumentDetails): IsinVerdict {
  const reasons: string[] = [];
  const risks: string[] = [];
  const mm = monthsToMaturity(d.maturityDate);
  if (d.issuerName) reasons.push(`Issuer: ${d.issuerName}${d.jurisdiction ? ` (${d.jurisdiction})` : ""}.`);
  if (d.instrumentType) reasons.push(`${d.instrumentType}${d.instrumentCategory ? ` · ${d.instrumentCategory}` : ""}${d.interestType ? ` · ${d.interestType}` : ""}.`);
  if (d.notionalCurrency) reasons.push(`Denominated in ${d.notionalCurrency}.`);
  if (mm != null) reasons.push(`~${Math.max(0, Math.round(mm))} months to maturity/termination.`);
  if (d.leiStatus && d.leiStatus !== "ISSUED" && d.leiStatus !== "LAPSED")
    risks.push(`Issuer LEI registration status is ${d.leiStatus}.`);
  if (d.leiStatus === "LAPSED") risks.push("Issuer LEI is LAPSED — reduced transparency.");
  risks.push("Coupon rate, yield and issue size aren't available from the reference data, so price/return can't be assessed here.");
  return {
    available: true,
    recommendation: "Insufficient data",
    confidence: "Low",
    summary:
      "Reference data was found, but without a live coupon/yield and price an investment call can't be made automatically. Review the instrument details and current market quote before deciding.",
    reasons,
    risks,
    engine: "deterministic",
    fetchedAt: new Date().toISOString(),
  };
}

export async function analyzeIsin(rawIsin: string): Promise<IsinVerdict> {
  const d = await lookupIsin(rawIsin);
  if (!d.found) {
    return {
      available: false,
      recommendation: "Insufficient data",
      confidence: "Low",
      summary: d.error ?? "Instrument not found.",
      reasons: [],
      risks: [],
      engine: "deterministic",
      fetchedAt: new Date().toISOString(),
    };
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallback(d);

  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const mm = monthsToMaturity(d.maturityDate);
  const payload = JSON.stringify({
    isin: d.isin,
    issuer: d.issuerName,
    jurisdiction: d.jurisdiction,
    leiStatus: d.leiStatus,
    instrumentType: d.instrumentType,
    instrumentCategory: d.instrumentCategory,
    interestType: d.interestType,
    currency: d.notionalCurrency,
    maturityDate: d.maturityDate,
    monthsToMaturity: mm == null ? null : Math.round(mm),
    competentAuthority: d.competentAuthority,
    tradingVenues: d.venues.length,
    status: d.status,
    unavailable: ["coupon/interest rate", "yield", "total issued nominal", "nominal value per unit", "live price"],
  });

  const system = `You are a fixed-income / securities investment analyst. You are
given the ESMA FIRDS + GLEIF reference data for one instrument (identified by
ISIN) and must give a clear, honest "should I invest now?" view.

Important constraints:
- The reference data has NO coupon rate, NO yield, NO issue size and NO live
  price. Be explicit that a precise valuation needs those. Do NOT invent numbers.
- Base your view on what IS known: issuer identity & jurisdiction (sovereign vs
  corporate, country risk), LEI registration status, instrument type/category,
  interest type (fixed/floating/zero), currency, time to maturity, and listing
  status. Reason like a credit/markets analyst.
- For a sovereign issuer, comment on country/credit risk qualitatively. For
  corporates, note that issuer fundamentals/ratings should be checked.

Return STRICT JSON (plain text, no markdown):
{
  "recommendation": one of "Invest" | "Avoid" | "Hold / Watch" | "Insufficient data",
  "confidence": one of "Very High" | "High" | "Moderate" | "Low",
  "summary": "3-4 sentence professional verdict, stating clearly what's missing",
  "reasons": ["4-7 specific, data-grounded points"],
  "risks": ["3-5 concrete risks to check before investing"]
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
    const arr = (x: unknown): string[] =>
      Array.isArray(x) ? x.map((v) => String(v).trim()).filter(Boolean).slice(0, 7) : [];
    const rec = ["Invest", "Avoid", "Hold / Watch", "Insufficient data"].includes(p.recommendation)
      ? p.recommendation
      : "Hold / Watch";
    const conf = ["Very High", "High", "Moderate", "Low"].includes(p.confidence)
      ? p.confidence
      : "Low";
    if (!p.summary) return fallback(d);
    return {
      available: true,
      recommendation: rec,
      confidence: conf,
      summary: String(p.summary).trim(),
      reasons: arr(p.reasons),
      risks: arr(p.risks),
      engine: "openai",
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return fallback(d);
  }
}

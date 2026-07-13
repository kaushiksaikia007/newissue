import { NextResponse } from "next/server";
import { emailFromSession } from "@/lib/watchlist";
import {
  deleteBrain,
  loadBrain,
  saveBrain,
  sectorsFromCompanies,
  type SavedCompany,
} from "@/lib/countryBrainStore";
import { commoditiesFor, type Commodity } from "@/lib/countryCommodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Load / save / delete a user's customized country brain. Persisted as local
// JSON on the server, keyed by the signed-in email (or "guest").

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim();
  const email = await emailFromSession(url.searchParams.get("session") ?? "");
  if (!code) return NextResponse.json({ brain: null });
  const brain = await loadBrain(email, code);
  return NextResponse.json({ brain });
}

function cleanCompanies(input: unknown): SavedCompany[] {
  if (!Array.isArray(input)) return [];
  const out: SavedCompany[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const c = raw as Partial<SavedCompany>;
    const symbol = String(c?.symbol ?? "").trim();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({
      symbol,
      ticker: String(c?.ticker ?? symbol.split(":").pop() ?? "").trim(),
      name: String(c?.name ?? c?.ticker ?? symbol).trim(),
      sector: String(c?.sector ?? "").trim(),
    });
  }
  return out.slice(0, 40);
}

// Only keep commodities the user actually chose (by symbol) from the country's
// allocated set — never trust arbitrary client symbols.
function pickCommodities(code: string, symbols: unknown): Commodity[] {
  const allowed = commoditiesFor(code);
  if (!Array.isArray(symbols)) return allowed;
  const want = new Set(symbols.map((s) => String(s).toUpperCase()));
  const chosen = allowed.filter((c) => want.has(c.symbol.toUpperCase()));
  return chosen.length ? chosen : allowed;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = await emailFromSession(String(body.session ?? ""));
  const code = String(body.code ?? "").trim();
  if (!code) return NextResponse.json({ error: "Missing country code" }, { status: 400 });

  const action = body.action ?? "save";
  if (action === "delete") {
    await deleteBrain(email, code);
    return NextResponse.json({ brain: null });
  }

  const companies = cleanCompanies(body.companies);
  if (!companies.length) {
    return NextResponse.json({ error: "Select at least one company" }, { status: 400 });
  }
  const sectors = sectorsFromCompanies(companies);
  const commodities = pickCommodities(code, body.commodities);

  const brain = await saveBrain(email, { code, companies, sectors, commodities });
  return NextResponse.json({ brain });
}

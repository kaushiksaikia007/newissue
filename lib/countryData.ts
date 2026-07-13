import { promises as fs } from "fs";
import path from "path";
import { tradingviewScreen } from "./sources/tradingview";

// Discovers the top companies of a country straight from TradingView's public
// scanner (no OpenAI/API key). Results are cached in memory and on disk so the
// picker is instant and TradingView isn't hammered. Each country maps to one of
// TradingView's country "screeners".

export const COUNTRY_SCREENER: Record<string, string> = {
  IN: "india",
  US: "america",
  CN: "china",
  JP: "japan",
  DE: "germany",
  GB: "uk",
  FR: "france",
  CA: "canada",
  AU: "australia",
  BR: "brazil",
  RU: "russia",
  KR: "korea",
  IT: "italy",
  ES: "spain",
  MX: "mexico",
  ID: "indonesia",
  SA: "ksa",
  AE: "uae",
  CH: "switzerland",
  NL: "netherlands",
  SG: "singapore",
  HK: "hongkong",
  TR: "turkey",
  ZA: "rsa",
};

export interface Company {
  /** "EXCHANGE:TICKER" — used for live quotes. */
  symbol: string;
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  marketCap: number | null;
}

// Where collected data is cached on disk. Mirrors the configurable-root
// convention of lib/sources/nseStocks.ts.
const DATA_DIR = process.env.COUNTRY_DATA_DIR || path.join(process.cwd(), ".data");
const CACHE_DIR = path.join(DATA_DIR, "tv-cache");
const DISK_TTL = 6 * 3600_000; // 6h
const MEM_TTL = 30 * 60_000; // 30m

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const mem = new Map<string, { at: number; companies: Company[] }>();
const inflight = new Map<string, Promise<Company[]>>();

async function readDisk(slug: string): Promise<Company[] | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `companies-${slug}.json`), "utf8");
    const j = JSON.parse(raw) as { at?: number; companies?: Company[] };
    if (!j.at || Date.now() - j.at > DISK_TTL || !Array.isArray(j.companies)) return null;
    return j.companies;
  } catch {
    return null;
  }
}

async function writeDisk(slug: string, companies: Company[]): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(
      path.join(CACHE_DIR, `companies-${slug}.json`),
      JSON.stringify({ at: Date.now(), companies }),
      "utf8",
    );
  } catch {
    /* cache is best-effort */
  }
}

// Upper bound on rows pulled per country. Comfortably above the largest market
// (US ~12k) so the whole listed universe is captured, while bounding memory.
const MAX_ROWS = 60_000;

/** Query TradingView's scanner for ALL of a country's listed companies. */
async function fetchCompanies(slug: string): Promise<Company[]> {
  const rows = await tradingviewScreen(
    slug,
    ["name", "description", "sector", "industry", "market_cap_basic"],
    {
      filter: [{ left: "type", operation: "equal", right: "stock" }],
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      range: [0, MAX_ROWS],
    },
  );

  const out: Company[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const [name, description, sector, industry, marketCap] = r.values;
    const ticker = str(name) || r.symbol.split(":").pop() || "";
    if (!ticker) continue;
    // Collapse dual listings (e.g. NSE:X / BSE:X) to the first (higher-ranked).
    const dedupeKey = `${ticker}|${str(description)}`.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      symbol: r.symbol,
      ticker,
      name: str(description) || ticker,
      sector: str(sector),
      industry: str(industry),
      marketCap: num(marketCap),
    });
  }
  return out;
}

/** Top companies for a country code (e.g. "IN"). Cached; never throws. */
export async function listCompanies(code: string): Promise<Company[]> {
  const slug = COUNTRY_SCREENER[code?.toUpperCase()];
  if (!slug) return [];

  const hot = mem.get(slug);
  if (hot && Date.now() - hot.at < MEM_TTL) return hot.companies;

  if (inflight.has(slug)) return inflight.get(slug)!;

  const job = (async () => {
    const disk = await readDisk(slug);
    if (disk) {
      mem.set(slug, { at: Date.now(), companies: disk });
      return disk;
    }
    try {
      const companies = await fetchCompanies(slug);
      if (companies.length) {
        mem.set(slug, { at: Date.now(), companies });
        void writeDisk(slug, companies);
      }
      return companies;
    } catch {
      // On failure, serve a stale disk copy if any exists, else empty.
      return (await readDisk(slug)) ?? [];
    }
  })().finally(() => inflight.delete(slug));

  inflight.set(slug, job);
  return job;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Filter a country's ENTIRE listed universe by ticker/name substring. With no
 * query we return the biggest companies (already sorted by market cap) as the
 * default view; typing searches across every listed stock, ranking exact/prefix
 * matches first.
 */
export async function searchCompanies(code: string, query: string): Promise<Company[]> {
  const all = await listCompanies(code);
  const q = norm(query);
  if (!q) return all.slice(0, 80);

  const scored: { c: Company; score: number }[] = [];
  for (const c of all) {
    const t = norm(c.ticker);
    const n = norm(c.name);
    let score = 0;
    if (t === q) score = 100;
    else if (t.startsWith(q)) score = 90;
    else if (n.startsWith(q)) score = 80;
    else if (t.includes(q)) score = 60;
    else if (n.includes(q)) score = 50;
    if (score) scored.push({ c, score });
  }
  // Higher score first; within a score, keep market-cap order (already sorted).
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 100).map((s) => s.c);
}

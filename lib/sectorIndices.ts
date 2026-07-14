import { getNseIndices, type NseIndexRow } from "./sources/nseIndices";
import { tvQuotes } from "./sources/tvQuote";
import { searchNews } from "./sources/news";
import type { NewsItem } from "./types";

/**
 * India Sector→Index data-ingestion layer.
 *
 * Each sector maps to its official NSE sectoral index. Quotes come from the
 * official NSE allIndices feed (OHLC, 52-week range, P/E, P/B, dividend
 * yield, advances/declines, 1W/1M/1Y performance); the TradingView streaming
 * socket overlays a fresher last price when available. Headlines come live
 * from Google News RSS with a per-sector query.
 *
 * India-only for now; the shape is country-keyed so other markets can be
 * added later.
 */

export interface SectorIndexDef {
  id: string;
  sector: string; // "Banking"
  indexName: string; // "NIFTY Bank"
  /** Key into the NSE allIndices feed. */
  nseSymbol: string; // "NIFTY BANK"
  /** TradingView symbol for the live-price socket overlay. */
  tvSymbol: string; // "NSE:BANKNIFTY"
  /** Google News search for this sector's headlines. */
  newsQuery: string;
}

const q = (terms: string[]) => `(${terms.map((t) => `"${t}"`).join(" OR ")}) when:7d`;

export const IN_SECTOR_INDICES: SectorIndexDef[] = [
  { id: "banking", sector: "Banking", indexName: "NIFTY Bank", nseSymbol: "NIFTY BANK", tvSymbol: "NSE:BANKNIFTY",
    newsQuery: q(["Nifty Bank", "Bank Nifty", "Indian banks", "banking sector India", "RBI banks"]) },
  { id: "it", sector: "IT", indexName: "NIFTY IT", nseSymbol: "NIFTY IT", tvSymbol: "NSE:CNXIT",
    newsQuery: q(["Nifty IT", "Indian IT sector", "IT stocks India", "TCS", "Infosys"]) },
  { id: "pharma", sector: "Pharma", indexName: "NIFTY Pharma", nseSymbol: "NIFTY PHARMA", tvSymbol: "NSE:CNXPHARMA",
    newsQuery: q(["Nifty Pharma", "pharma sector India", "Indian pharma stocks", "Sun Pharma", "Cipla"]) },
  { id: "auto", sector: "Auto", indexName: "NIFTY Auto", nseSymbol: "NIFTY AUTO", tvSymbol: "NSE:CNXAUTO",
    newsQuery: q(["Nifty Auto", "auto sector India", "Indian automakers", "Maruti Suzuki", "Tata Motors"]) },
  { id: "fmcg", sector: "FMCG", indexName: "NIFTY FMCG", nseSymbol: "NIFTY FMCG", tvSymbol: "NSE:CNXFMCG",
    newsQuery: q(["Nifty FMCG", "FMCG sector India", "consumer goods India", "Hindustan Unilever", "ITC"]) },
  { id: "financial-services", sector: "Financial Services", indexName: "NIFTY Financial Services", nseSymbol: "NIFTY FIN SERVICE", tvSymbol: "NSE:CNXFINANCE",
    newsQuery: q(["Nifty Financial Services", "financial services India", "NBFC India", "Bajaj Finance", "HDFC"]) },
  { id: "realty", sector: "Realty", indexName: "NIFTY Realty", nseSymbol: "NIFTY REALTY", tvSymbol: "NSE:CNXREALTY",
    newsQuery: q(["Nifty Realty", "real estate sector India", "Indian realty stocks", "DLF", "housing market India"]) },
  { id: "psu-banks", sector: "PSU Banks", indexName: "NIFTY PSU Bank", nseSymbol: "NIFTY PSU BANK", tvSymbol: "NSE:CNXPSUBANK",
    newsQuery: q(["Nifty PSU Bank", "PSU banks India", "public sector banks India", "SBI", "Bank of Baroda"]) },
  { id: "metal", sector: "Metal", indexName: "NIFTY Metal", nseSymbol: "NIFTY METAL", tvSymbol: "NSE:CNXMETAL",
    newsQuery: q(["Nifty Metal", "metal stocks India", "steel sector India", "Tata Steel", "Hindalco"]) },
  { id: "media", sector: "Media", indexName: "NIFTY Media", nseSymbol: "NIFTY MEDIA", tvSymbol: "NSE:CNXMEDIA",
    newsQuery: q(["Nifty Media", "media stocks India", "Indian media sector", "Zee Entertainment", "Sun TV"]) },
  { id: "oil-gas", sector: "Oil & Gas", indexName: "NIFTY Oil & Gas", nseSymbol: "NIFTY OIL AND GAS", tvSymbol: "NSE:NIFTY_OIL_AND_GAS",
    newsQuery: q(["Nifty Oil Gas", "oil and gas India", "ONGC", "Reliance Industries", "oil stocks India"]) },
  { id: "healthcare", sector: "Healthcare", indexName: "NIFTY Healthcare", nseSymbol: "NIFTY HEALTHCARE", tvSymbol: "NSE:NIFTY_HEALTHCARE",
    newsQuery: q(["Nifty Healthcare", "healthcare sector India", "hospital stocks India", "Apollo Hospitals", "Max Healthcare"]) },
  { id: "consumer-durables", sector: "Consumer Durables", indexName: "NIFTY Consumer Durables", nseSymbol: "NIFTY CONSR DURBL", tvSymbol: "NSE:NIFTY_CONSR_DURBL",
    newsQuery: q(["Nifty Consumer Durables", "consumer durables India", "Titan", "Havells", "Voltas"]) },
];

const byId = new Map(IN_SECTOR_INDICES.map((d) => [d.id, d]));

/* --------------------------------- Quotes -------------------------------- */

export interface SectorIndexQuote {
  id: string;
  sector: string;
  indexName: string;
  nseSymbol: string;
  last: number;
  change: number; // absolute vs previous close
  changePct: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  yearHigh: number;
  yearLow: number;
  pe: number | null;
  pb: number | null;
  divYield: number | null;
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
  perChange1w: number | null;
  perChange30d: number | null;
  perChange365d: number | null;
  /** True when the TradingView socket overlaid a fresher price. */
  live: boolean;
}

export interface SectorIndexList {
  sectors: SectorIndexQuote[];
  asOf: string | null;
}

export interface SectorIndexDetail {
  detail: SectorIndexQuote | null;
  news: NewsItem[];
  asOf: string | null;
}

function toQuote(def: SectorIndexDef, row: NseIndexRow): SectorIndexQuote {
  // 1W change isn't published directly — derive it from the level a week ago.
  const perChange1w =
    row.oneWeekAgoVal && row.oneWeekAgoVal > 0
      ? ((row.last - row.oneWeekAgoVal) / row.oneWeekAgoVal) * 100
      : null;
  return {
    id: def.id,
    sector: def.sector,
    indexName: def.indexName,
    nseSymbol: def.nseSymbol,
    last: row.last,
    change: row.variation,
    changePct: row.percentChange,
    open: row.open,
    high: row.high,
    low: row.low,
    previousClose: row.previousClose,
    yearHigh: row.yearHigh,
    yearLow: row.yearLow,
    pe: row.pe,
    pb: row.pb,
    divYield: row.dy,
    advances: row.advances,
    declines: row.declines,
    unchanged: row.unchanged,
    perChange1w,
    perChange30d: row.perChange30d,
    perChange365d: row.perChange365d,
    live: false,
  };
}

/** Overlay the streaming TradingView price when it's usable. */
function overlayLive(quote: SectorIndexQuote, live?: { price: number; change: number } | null): SectorIndexQuote {
  if (!live || live.price <= 0) return quote;
  const prev = quote.previousClose > 0 ? quote.previousClose : live.price - live.change;
  const change = prev > 0 ? live.price - prev : live.change;
  return {
    ...quote,
    last: live.price,
    change,
    changePct: prev > 0 ? (change / prev) * 100 : quote.changePct,
    high: Math.max(quote.high, live.price),
    low: quote.low > 0 ? Math.min(quote.low, live.price) : quote.low,
    live: true,
  };
}

/** All 13 India sector indices with live quotes. */
export async function getSectorIndexList(code: string): Promise<SectorIndexList> {
  if (code.toUpperCase() !== "IN") return { sectors: [], asOf: null };

  const [nse, live] = await Promise.all([
    getNseIndices(),
    tvQuotes(IN_SECTOR_INDICES.map((d) => d.tvSymbol)).catch(
      () => new Map<string, { price: number; change: number; changePct: number }>(),
    ),
  ]);
  if (!nse) return { sectors: [], asOf: null };

  const sectors: SectorIndexQuote[] = [];
  for (const def of IN_SECTOR_INDICES) {
    const row = nse.rows.get(def.nseSymbol);
    if (!row) continue; // feed dropped an index — skip rather than fake it
    sectors.push(overlayLive(toQuote(def, row), live.get(def.tvSymbol)));
  }
  return { sectors, asOf: new Date(nse.at).toISOString() };
}

/** One sector's full index detail plus its live headlines. */
export async function getSectorIndexDetail(code: string, id: string): Promise<SectorIndexDetail> {
  const def = byId.get(id);
  if (code.toUpperCase() !== "IN" || !def) return { detail: null, news: [], asOf: null };

  const [list, news] = await Promise.all([
    getSectorIndexList(code),
    searchNews(`sector:${def.id}`, def.newsQuery, "IN"),
  ]);
  return {
    detail: list.sectors.find((s) => s.id === id) ?? null,
    news,
    asOf: list.asOf,
  };
}

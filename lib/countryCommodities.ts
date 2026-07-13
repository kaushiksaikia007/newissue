import { tvQuotes } from "./sources/tvQuote";

// The commodities that matter most to each country's economy, expressed as
// TradingView symbols so we can pull live prices (no OpenAI). Every country also
// gets the universal energy/precious set as a baseline.

export interface Commodity {
  name: string;
  /** "EXCHANGE:TICKER" for live quotes. */
  symbol: string;
}

export interface CommodityQuote extends Commodity {
  price: number | null;
  changePct: number | null;
}

// Reusable definitions (all TradingView-scanner-verified symbols).
const GOLD: Commodity = { name: "Gold", symbol: "TVC:GOLD" };
const SILVER: Commodity = { name: "Silver", symbol: "TVC:SILVER" };
const BRENT: Commodity = { name: "Brent Crude", symbol: "ICEEUR:BRN1!" };
const WTI: Commodity = { name: "WTI Crude", symbol: "NYMEX:CL1!" };
const NATGAS: Commodity = { name: "Natural Gas", symbol: "NYMEX:NG1!" };
const COPPER: Commodity = { name: "Copper", symbol: "COMEX:HG1!" };
const PLATINUM: Commodity = { name: "Platinum", symbol: "TVC:PLATINUM" };
const PALLADIUM: Commodity = { name: "Palladium", symbol: "TVC:PALLADIUM" };
const IRON_ORE: Commodity = { name: "Iron Ore", symbol: "SGX:FEF1!" };
const ALUMINIUM: Commodity = { name: "Aluminium", symbol: "LME:AH1!" };
const SOYBEANS: Commodity = { name: "Soybeans", symbol: "CBOT:ZS1!" };
const CORN: Commodity = { name: "Corn", symbol: "CBOT:ZC1!" };
const WHEAT: Commodity = { name: "Wheat", symbol: "CBOT:ZW1!" };
const COFFEE: Commodity = { name: "Coffee", symbol: "ICEUS:KC1!" };
const COTTON: Commodity = { name: "Cotton", symbol: "ICEUS:CT1!" };
const SUGAR: Commodity = { name: "Sugar", symbol: "ICEUS:SB1!" };

const UNIVERSAL: Commodity[] = [GOLD, BRENT, WTI];

// Curated by economic relevance (top imports/exports & production).
const MAP: Record<string, Commodity[]> = {
  IN: [GOLD, BRENT, SILVER, COPPER, NATGAS], // big importer of gold & crude
  US: [WTI, NATGAS, GOLD, CORN, SOYBEANS, WHEAT],
  CN: [COPPER, IRON_ORE, BRENT, GOLD, SOYBEANS, ALUMINIUM],
  JP: [BRENT, NATGAS, GOLD, COPPER],
  DE: [NATGAS, BRENT, GOLD, COPPER],
  GB: [BRENT, NATGAS, GOLD, SILVER],
  FR: [BRENT, NATGAS, GOLD, WHEAT],
  CA: [WTI, NATGAS, GOLD, WHEAT, COPPER],
  AU: [IRON_ORE, GOLD, COPPER, NATGAS, WHEAT],
  BR: [SOYBEANS, IRON_ORE, BRENT, GOLD, SUGAR, COFFEE],
  RU: [BRENT, NATGAS, GOLD, WHEAT, PALLADIUM],
  KR: [BRENT, NATGAS, COPPER, GOLD],
  IT: [BRENT, NATGAS, GOLD],
  ES: [BRENT, NATGAS, GOLD, WTI],
  MX: [WTI, GOLD, SILVER, COPPER],
  ID: [BRENT, NATGAS, COPPER, GOLD, PALLADIUM],
  SA: [BRENT, WTI, NATGAS, GOLD],
  AE: [BRENT, WTI, NATGAS, GOLD],
  CH: [GOLD, SILVER, PLATINUM, PALLADIUM],
  NL: [BRENT, NATGAS, GOLD],
  SG: [BRENT, WTI, GOLD, NATGAS],
  HK: [GOLD, BRENT, COPPER],
  TR: [GOLD, BRENT, NATGAS, COTTON],
  ZA: [GOLD, PLATINUM, PALLADIUM, COPPER, IRON_ORE],
};

/** The commodities allocated to a country (falls back to the universal set). */
export function commoditiesFor(code: string): Commodity[] {
  return MAP[code?.toUpperCase()] ?? UNIVERSAL;
}

/** Country commodities with live prices attached. Never throws. */
export async function commodityQuotesFor(code: string): Promise<CommodityQuote[]> {
  const list = commoditiesFor(code);
  let quotes: Awaited<ReturnType<typeof tvQuotes>> = new Map();
  try {
    quotes = await tvQuotes(list.map((c) => c.symbol));
  } catch {
    /* prices are best-effort */
  }
  return list.map((c) => {
    const q = quotes.get(c.symbol.toUpperCase());
    return { ...c, price: q?.price ?? null, changePct: q?.changePct ?? null };
  });
}

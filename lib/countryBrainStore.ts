import { promises as fs } from "fs";
import path from "path";
import type { Company } from "./countryData";
import type { Commodity } from "./countryCommodities";

// Per-user persistence of a "customized brain": the country plus the companies,
// sectors and commodities the user assembled. Saved as local JSON on the server
// (like the tv-cache), keyed by the signed-in email (or "guest").

const DATA_DIR = process.env.COUNTRY_DATA_DIR || path.join(process.cwd(), ".data");
const BRAINS_DIR = path.join(DATA_DIR, "brains");

export interface SavedCompany {
  symbol: string;
  ticker: string;
  name: string;
  sector: string;
}

export interface CountryBrainConfig {
  code: string;
  companies: SavedCompany[];
  sectors: string[];
  commodities: Commodity[];
  createdAt: number;
  updatedAt: number;
}

/** Filesystem-safe key for a user (email or "guest"). */
function userKey(email: string | null): string {
  const e = (email || "").trim().toLowerCase();
  if (!e) return "guest";
  return e.replace(/[^a-z0-9._-]+/g, "_");
}

function fileFor(email: string | null, code: string): string {
  const safeCode = code.toUpperCase().replace(/[^A-Z]/g, "");
  return path.join(BRAINS_DIR, userKey(email), `${safeCode}.json`);
}

/** Derive the unique, sorted sector list from a set of companies. */
export function sectorsFromCompanies(companies: Pick<Company, "sector">[]): string[] {
  const set = new Set<string>();
  for (const c of companies) {
    const s = (c.sector || "").trim();
    if (s) set.add(s);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Load a user's saved brain for a country, or null. */
export async function loadBrain(
  email: string | null,
  code: string,
): Promise<CountryBrainConfig | null> {
  try {
    const raw = await fs.readFile(fileFor(email, code), "utf8");
    const j = JSON.parse(raw) as CountryBrainConfig;
    return j && Array.isArray(j.companies) ? j : null;
  } catch {
    return null;
  }
}

/** Save (upsert) a user's brain for a country and return the stored config. */
export async function saveBrain(
  email: string | null,
  config: {
    code: string;
    companies: SavedCompany[];
    sectors: string[];
    commodities: Commodity[];
  },
): Promise<CountryBrainConfig> {
  const existing = await loadBrain(email, config.code);
  const now = Date.now();
  const stored: CountryBrainConfig = {
    code: config.code.toUpperCase(),
    companies: config.companies,
    sectors: config.sectors,
    commodities: config.commodities,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const file = fileFor(email, config.code);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(stored, null, 2), "utf8");
  return stored;
}

/** Delete a user's saved brain for a country. */
export async function deleteBrain(email: string | null, code: string): Promise<void> {
  try {
    await fs.unlink(fileFor(email, code));
  } catch {
    /* already gone */
  }
}

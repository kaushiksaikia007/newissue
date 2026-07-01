import { promises as fs } from "fs";
import path from "path";

// Local knowledge base of NSE-listed companies. Each stock lives in
//   <ROOT>/<SYMBOL>/profile.txt
// as "Key: Value" lines (Company Name, Sector, Industry, ISIN, Description, …).
// We read a single profile on demand and build a lightweight symbol/name index
// (cached) so users can ask by ticker OR by company name.

const ROOT = process.env.NSE_STOCKS_DIR || "D:\\India Brain\\NSE";
const INDEX_TTL = 30 * 60_000; // rebuild the name index at most every 30 min

const KNOWN_KEYS = new Set([
  "Company Name",
  "Exchange",
  "Symbol",
  "ISIN",
  "Sector",
  "Industry",
  "Market Cap Category",
  "Founded Year",
  "Headquarters",
  "Website",
  "Description",
]);

export interface StockProfile {
  symbol: string;
  name: string;
  fields: Record<string, string>;
  raw: string;
}

interface IndexEntry {
  symbol: string;
  symbolLc: string;
  name: string;
  nameLc: string;
}

let index: IndexEntry[] | null = null;
let indexAt = 0;
let indexBuilding: Promise<IndexEntry[]> | null = null;

/** Parse the "Key: Value" profile, folding wrapped Description lines back in. */
function parseProfile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let lastKey = "";
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    const maybeKey = idx > 0 ? line.slice(0, idx).trim() : "";
    if (maybeKey && KNOWN_KEYS.has(maybeKey)) {
      lastKey = maybeKey;
      out[lastKey] = line.slice(idx + 1).trim();
    } else if (lastKey && line.trim()) {
      out[lastKey] += " " + line.trim();
    }
  }
  return out;
}

/** Run async work over items with bounded concurrency (avoids EMFILE). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let idx = i++; idx < items.length; idx = i++) out[idx] = await fn(items[idx]);
  });
  await Promise.all(workers);
  return out;
}

/** Read and parse one symbol's profile.txt, or null if missing. */
export async function readProfile(symbol: string): Promise<StockProfile | null> {
  const sym = symbol.trim();
  if (!sym) return null;
  try {
    const raw = await fs.readFile(path.join(ROOT, sym, "profile.txt"), "utf8");
    const fields = parseProfile(raw);
    return {
      symbol: fields["Symbol"] || sym,
      name: fields["Company Name"] || sym,
      fields,
      raw: raw.trim(),
    };
  } catch {
    return null;
  }
}

async function buildIndex(): Promise<IndexEntry[]> {
  let dirs: string[] = [];
  try {
    const entries = await fs.readdir(ROOT, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const rows = await mapLimit(dirs, 48, async (symbol) => {
    // Cheap read: we only need the Company Name line for the index.
    try {
      const raw = await fs.readFile(path.join(ROOT, symbol, "profile.txt"), "utf8");
      const m = raw.match(/^Company Name:\s*(.+)$/im);
      const name = (m?.[1] || symbol).trim();
      return { symbol, symbolLc: symbol.toLowerCase(), name, nameLc: name.toLowerCase() };
    } catch {
      return { symbol, symbolLc: symbol.toLowerCase(), name: symbol, nameLc: symbol.toLowerCase() };
    }
  });
  return rows;
}

async function ensureIndex(): Promise<IndexEntry[]> {
  if (index && Date.now() - indexAt < INDEX_TTL) return index;
  if (!indexBuilding) {
    indexBuilding = buildIndex()
      .then((rows) => {
        index = rows;
        indexAt = Date.now();
        return rows;
      })
      .finally(() => {
        indexBuilding = null;
      });
  }
  return indexBuilding;
}

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(limited|ltd|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Best-matching stock for a symbol or company-name query, or null. */
export async function findStock(query: string): Promise<StockProfile | null> {
  const q = query.trim();
  if (!q) return null;

  // Fast path: exact symbol = folder name.
  const direct = await readProfile(q.toUpperCase());
  if (direct) return direct;

  const rows = await ensureIndex();
  const ql = q.toLowerCase();
  const qc = clean(q);

  let best: IndexEntry | null = null;
  let bestScore = 0;
  for (const r of rows) {
    const nc = clean(r.name);
    let score = 0;
    if (r.symbolLc === ql || r.nameLc === ql || nc === qc) score = 100;
    else if (r.nameLc.startsWith(ql) || nc.startsWith(qc)) score = 80;
    else if (r.symbolLc.startsWith(ql)) score = 70;
    else if (nc.includes(qc) && qc.length >= 3) score = 55;
    else if (r.symbolLc.includes(ql) && ql.length >= 3) score = 40;
    if (score === 0) continue;
    // Prefer higher score; break ties toward the shorter (more canonical) name.
    if (score > bestScore || (score === bestScore && best && r.name.length < best.name.length)) {
      best = r;
      bestScore = score;
    }
  }

  return best ? readProfile(best.symbol) : null;
}

/** Up to `limit` symbol/name suggestions for a query (used when no exact hit). */
export async function suggestStocks(query: string, limit = 6): Promise<{ symbol: string; name: string }[]> {
  const rows = await ensureIndex();
  const qc = clean(query);
  if (!qc) return [];
  return rows
    .filter((r) => clean(r.name).includes(qc) || r.symbolLc.includes(query.toLowerCase()))
    .slice(0, limit)
    .map((r) => ({ symbol: r.symbol, name: r.name }));
}

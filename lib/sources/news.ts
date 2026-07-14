import type { NewsItem } from "../types";

// Keyless Google News RSS. Each instrument has its own query + region so the
// headlines (and the geopolitics factor) are relevant to that market.
export const GOLD_QUERY =
  '(geopolitical OR war OR sanctions OR conflict OR "central bank" OR gold) when:2d';
export const NIFTY_QUERY =
  '(Nifty OR Sensex OR "Indian stock market" OR NSE OR RBI OR FII OR "Indian economy" OR "India markets" OR "Indian rupee") when:2d';

function feedUrl(query: string, region: "US" | "IN"): string {
  const params =
    region === "IN" ? "hl=en-IN&gl=IN&ceid=IN:en" : "hl=en-US&gl=US&ceid=US:en";
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${params}`;
}

interface Cache {
  items: NewsItem[];
  expires: number;
}
const caches: Record<string, Cache> = {};

function pick(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.split(/<item>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/item>/i)[0];
    const title = pick(block, "title");
    const link = pick(block, "link");
    if (!title) continue;
    items.push({
      title,
      link,
      source: pick(block, "source") || "Google News",
      publishedAt: pick(block, "pubDate"),
    });
  }
  return items.slice(0, 12);
}

/** Fetch a named feed (cached 10 min per id). Never throws. */
async function fetchFeed(
  id: string,
  query: string,
  region: "US" | "IN",
): Promise<NewsItem[]> {
  const cached = caches[id];
  if (cached && cached.expires > Date.now()) return cached.items;
  try {
    const res = await fetch(feedUrl(query, region), {
      headers: { "User-Agent": "Mozilla/5.0 (GoldBot)" },
      next: { revalidate: 0 },
    });
    if (!res.ok) throw new Error(`news ${res.status}`);
    const items = parseRss(await res.text());
    caches[id] = { items, expires: Date.now() + 10 * 60_000 };
    return items;
  } catch {
    return caches[id]?.items ?? [];
  }
}

/** Gold / global geopolitical headlines. */
export function getNews(): Promise<NewsItem[]> {
  return fetchFeed("gold", GOLD_QUERY, "US");
}

/**
 * Live headlines for an arbitrary query (cached 10 min per id). Used by the
 * sector-index popups; never throws.
 */
export function searchNews(
  id: string,
  query: string,
  region: "US" | "IN" = "IN",
): Promise<NewsItem[]> {
  return fetchFeed(id, query, region);
}

/** Nifty 50 / Indian market headlines. */
export function getNiftyNews(): Promise<NewsItem[]> {
  return fetchFeed("nifty", NIFTY_QUERY, "IN");
}

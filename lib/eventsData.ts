import { cached } from "./riskData";

/**
 * Upcoming market-moving events for a country, from TradingView's economic
 * calendar. Events are ranked by the calendar's own importance rating (1 high,
 * 0 medium, -1 low) and the top 5 within the next ~5 weeks are returned in
 * date order. Euro-area countries also include EU-wide events (ECB decisions
 * move their markets more than any domestic print).
 */

export interface CountryEvent {
  title: string;
  /** ISO timestamp of the release/decision. */
  date: string;
  impact: "High" | "Medium" | "Low";
  /** Publishing institution (e.g. "Bureau of Labour Statistics"). */
  source: string | null;
  /** The institution's live site. */
  sourceUrl: string | null;
}

export interface EventsData {
  events: CountryEvent[];
  asOf: string;
}

/** Countries whose monetary policy is set by the ECB. */
const EURO_MEMBERS = new Set(["DE", "FR", "IT", "ES", "NL"]);

const EVENTS_TTL = 30 * 60_000;

interface CalRow {
  title?: string;
  country?: string;
  date?: string;
  importance?: number;
  source?: string;
  source_url?: string;
}

/** Title stripped of release-variant noise, for repeat detection. */
function baseTitle(e: CalRow): string {
  return (e.title ?? "")
    .toLowerCase()
    .replace(/\b(core|mom|yoy|qoq|prel|preliminary|final|adv|advance|flash|s\.a\.|n\.s\.a\.)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function getUpcomingEvents(code: string): Promise<EventsData> {
  const cc = code.toUpperCase();
  return cached(`events:${cc}`, EVENTS_TTL, async () => {
    const countries = EURO_MEMBERS.has(cc) ? `${cc},EU` : cc;
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 35 * 86_400_000).toISOString();
    const url = `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=${countries}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Origin: "https://www.tradingview.com" },
      next: { revalidate: 0 },
    });
    if (!res.ok) throw new Error(`Calendar -> ${res.status}`);
    const json = (await res.json()) as { result?: CalRow[] };

    const now = Date.now();
    const upcoming = (json.result ?? []).filter(
      (e) => e.title && e.date && new Date(e.date).getTime() > now,
    );

    // Releases publish many figures in the same minute (Core/headline CPI,
    // ECB decision + deposit rate, PMI flash trio…). Collapse each timestamp
    // cluster to its plainest (shortest-titled) headline print.
    // Cluster rank: importance, then headline rate decisions, then plainest title.
    const rank = (e: CalRow): [number, number, number] => [
      e.importance ?? -1,
      /interest rate decision/i.test(e.title ?? "") ? 1 : 0,
      -(e.title?.length ?? 99),
    ];
    const clusters = new Map<string, CalRow>();
    for (const e of upcoming) {
      const k = `${e.date}|${e.country}`;
      const prev = clusters.get(k);
      if (!prev) {
        clusters.set(k, e);
        continue;
      }
      const [ai, ar, al] = rank(e);
      const [bi, br, bl] = rank(prev);
      if (ai > bi || (ai === bi && (ar > br || (ar === br && al > bl)))) clusters.set(k, e);
    }

    // Most impactful first, ties broken by soonest. Skip repeats of the same
    // event on later days (multi-day testimonies, weekly prints) so the five
    // slots cover five DIFFERENT market movers; show the picks in date order.
    const ranked = [...clusters.values()].sort((a, b) => {
      const imp = (b.importance ?? -1) - (a.importance ?? -1);
      return imp !== 0 ? imp : (a.date! < b.date! ? -1 : 1);
    });
    const seen = new Set<string>();
    const top: CalRow[] = [];
    for (const e of ranked) {
      const t = baseTitle(e);
      if (seen.has(t)) continue;
      seen.add(t);
      top.push(e);
      if (top.length === 5) break;
    }
    top.sort((a, b) => (a.date! < b.date! ? -1 : 1));

    return {
      events: top.map((e) => ({
        title: e.title!,
        date: e.date!,
        impact: (e.importance ?? -1) >= 1 ? "High" : (e.importance ?? -1) >= 0 ? "Medium" : "Low",
        source: e.source ?? null,
        sourceUrl: e.source_url ?? null,
      })),
      asOf: new Date().toISOString(),
    } satisfies EventsData;
  });
}

import { getGoldSpotPerGram } from "./sources/goldSpot";
import { getNiftyData } from "./instruments/nifty";
import { getSensexData } from "./instruments/sensex";

export type Inst = "nifty" | "gold" | "sensex";

const API = process.env.PAPER_API_URL || "";
const TOKEN = process.env.PAPER_API_TOKEN || "";

interface ActiveAlert {
  id: string;
  instrument: Inst;
  email: string;
  threshold: number;
  direction: "above" | "below";
}

let monitorStarted = false;

async function php(
  action: string,
  payload?: Record<string, unknown>,
): Promise<unknown> {
  if (!API) return null;
  const url = `${API}?action=${action}&token=${encodeURIComponent(TOKEN)}`;
  try {
    const res = await fetch(url, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`php ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function priceOf(inst: Inst): Promise<number | null> {
  try {
    if (inst === "gold") return await getGoldSpotPerGram();
    if (inst === "sensex") return (await getSensexData()).index?.value ?? null;
    return (await getNiftyData()).index?.value ?? null;
  } catch {
    return null;
  }
}

/** Create an email price alert. Returns its id, or null if it couldn't be saved. */
export async function addAlert(
  instrument: Inst,
  email: string,
  threshold: number,
  direction: "above" | "below",
): Promise<string | null> {
  ensureAlertMonitor();
  const id = Math.random().toString(36).slice(2);
  const r = (await php("alert_add", {
    instrument,
    email,
    threshold,
    direction,
    id,
  })) as { ok?: boolean; id?: string } | null;
  return r?.ok ? (r.id ?? id) : null;
}

/** Background monitor: checks active alerts vs live price, fires emails. */
export function ensureAlertMonitor(): void {
  if (monitorStarted || !API) return;
  monitorStarted = true;
  setInterval(async () => {
    const res = (await php("alert_active")) as { alerts?: ActiveAlert[] } | null;
    const alerts = res?.alerts ?? [];
    if (!alerts.length) return;
    const priceCache: Partial<Record<Inst, number | null>> = {};
    for (const a of alerts) {
      if (priceCache[a.instrument] === undefined) {
        priceCache[a.instrument] = await priceOf(a.instrument);
      }
      const p = priceCache[a.instrument];
      if (p == null) continue;
      const hit = a.direction === "above" ? p >= a.threshold : p <= a.threshold;
      if (hit) {
        await php("alert_trigger", { id: a.id, price: Math.round(p * 100) / 100 });
      }
    }
  }, 5000);
}

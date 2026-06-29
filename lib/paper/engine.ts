import { getGoldSpotPerGram } from "../sources/goldSpot";
import { getNiftyData } from "../instruments/nifty";
import { getSensexData } from "../instruments/sensex";

export type Inst = "nifty" | "gold" | "sensex";

export interface Position {
  id: string;
  side: "buy" | "sell";
  qty: number;
  entry: number;
  sl: number | null;
  target: number | null;
  openedAt: number;
}
export interface Trade extends Position {
  exit: number;
  closedAt: number;
  pnl: number;
  reason: "Manual" | "Stop-loss" | "Target";
}
export interface Account {
  cash: number;
  starting: number;
  positions: Position[];
  history: Trade[];
}

const START_CASH = 1_000_000;
const API = process.env.PAPER_API_URL || ""; // e.g. https://puthibharal.com/NewIssueBot/api.php
const TOKEN = process.env.PAPER_API_TOKEN || "";

// In-memory working copy (authoritative store is MySQL via the PHP API).
const mem: Record<Inst, Account | null> = { nifty: null, gold: null, sensex: null };
let monitorStarted = false;

function fresh(): Account {
  return { cash: START_CASH, starting: START_CASH, positions: [], history: [] };
}
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Call the PHP API. Updates the in-memory copy from the returned state. */
async function api(
  action: string,
  inst: Inst,
  payload?: Record<string, unknown>,
): Promise<Account | null> {
  if (!API) return null;
  const url = `${API}?action=${action}&instrument=${inst}&token=${encodeURIComponent(TOKEN)}`;
  try {
    const res = await fetch(url, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify({ instrument: inst, ...payload }) : undefined,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`php ${res.status}`);
    const j = await res.json();
    if (j && Array.isArray(j.positions)) {
      mem[inst] = {
        cash: Number(j.cash),
        starting: Number(j.starting),
        positions: j.positions,
        history: j.history ?? [],
      };
      return mem[inst];
    }
    return null;
  } catch {
    return null;
  }
}

async function ensureLoaded(inst: Inst): Promise<Account> {
  if (mem[inst]) return mem[inst]!;
  await api("get", inst);
  if (!mem[inst]) mem[inst] = fresh(); // DB unreachable -> ephemeral fallback
  return mem[inst]!;
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

function pnlOf(p: Position, price: number): number {
  return p.side === "buy" ? (price - p.entry) * p.qty : (p.entry - price) * p.qty;
}

/** Close positions whose stop-loss or target is hit; persist each to MySQL. */
async function reconcile(inst: Inst, price: number): Promise<void> {
  const acc = mem[inst];
  if (!acc || !acc.positions.length) return;
  const hits: { p: Position; exit: number; reason: "Stop-loss" | "Target" }[] = [];
  for (const p of acc.positions) {
    if (p.side === "buy") {
      if (p.sl != null && price <= p.sl) hits.push({ p, exit: p.sl, reason: "Stop-loss" });
      else if (p.target != null && price >= p.target) hits.push({ p, exit: p.target, reason: "Target" });
    } else {
      if (p.sl != null && price >= p.sl) hits.push({ p, exit: p.sl, reason: "Stop-loss" });
      else if (p.target != null && price <= p.target) hits.push({ p, exit: p.target, reason: "Target" });
    }
  }
  for (const { p, exit, reason } of hits) {
    const pnl = pnlOf(p, exit);
    const trade: Trade = { ...p, exit: r2(exit), closedAt: Date.now(), pnl, reason };
    acc.positions = acc.positions.filter((x) => x.id !== p.id);
    acc.history.unshift(trade);
    acc.cash += p.entry * p.qty + pnl;
    await api("close", inst, { trade, cash: acc.cash });
  }
}

function ensureMonitor(): void {
  if (monitorStarted) return;
  monitorStarted = true;
  setInterval(async () => {
    for (const inst of ["gold", "nifty", "sensex"] as Inst[]) {
      if (!mem[inst] || !mem[inst]!.positions.length) continue;
      const price = await priceOf(inst);
      if (price != null) await reconcile(inst, price);
    }
  }, 2000);
}

export async function getPaper(inst: Inst) {
  ensureMonitor();
  const acc = await ensureLoaded(inst);
  const ltp = await priceOf(inst);
  if (ltp != null) await reconcile(inst, ltp);
  return {
    instrument: inst,
    cash: acc.cash,
    starting: acc.starting,
    positions: acc.positions,
    history: acc.history.slice(0, 300),
    ltp,
  };
}

export async function openPosition(
  inst: Inst,
  o: {
    side: "buy" | "sell";
    qty: number;
    sl: number | null;
    target: number | null;
    profitPct: number | null;
  },
): Promise<{ ok?: true; error?: string }> {
  ensureMonitor();
  const acc = await ensureLoaded(inst);
  const price = await priceOf(inst);
  if (price == null) return { error: "No live price yet — try again in a moment." };
  if (!o.qty || o.qty <= 0) return { error: "Enter a valid quantity." };
  const cost = price * o.qty;
  if (cost > acc.cash) return { error: "Insufficient demo funds." };

  let target = o.target;
  if (o.profitPct != null && o.profitPct > 0) {
    target = r2(o.side === "buy" ? price * (1 + o.profitPct / 100) : price * (1 - o.profitPct / 100));
  }
  if (o.sl != null && ((o.side === "buy" && o.sl >= price) || (o.side === "sell" && o.sl <= price)))
    return { error: "Stop-loss must be on the losing side of entry." };
  if (target != null && ((o.side === "buy" && target <= price) || (o.side === "sell" && target >= price)))
    return { error: "Target must be on the winning side of entry." };

  const position: Position = {
    id: Math.random().toString(36).slice(2),
    side: o.side,
    qty: o.qty,
    entry: r2(price),
    sl: o.sl,
    target,
    openedAt: Date.now(),
  };
  acc.positions.unshift(position);
  acc.cash -= cost;
  await api("open", inst, { position, cash: acc.cash });
  return { ok: true };
}

export async function closePosition(
  inst: Inst,
  id: string,
): Promise<{ ok?: true; error?: string }> {
  ensureMonitor();
  const acc = await ensureLoaded(inst);
  const price = await priceOf(inst);
  if (price == null) return { error: "No live price." };
  const p = acc.positions.find((x) => x.id === id);
  if (!p) return { error: "Position not found." };
  const pnl = pnlOf(p, price);
  const trade: Trade = { ...p, exit: r2(price), closedAt: Date.now(), pnl, reason: "Manual" };
  acc.positions = acc.positions.filter((x) => x.id !== id);
  acc.history.unshift(trade);
  acc.cash += p.entry * p.qty + pnl;
  await api("close", inst, { trade, cash: acc.cash });
  return { ok: true };
}

export async function resetAccount(inst: Inst): Promise<{ ok: true }> {
  ensureMonitor();
  const acc = await ensureLoaded(inst);
  acc.positions = [];
  acc.history = [];
  acc.cash = acc.starting;
  await api("reset", inst);
  return { ok: true };
}

/** One-time import of a previously saved (browser localStorage) account. */
export async function importAccount(
  inst: Inst,
  data: unknown,
): Promise<{ ok: true; persisted: boolean }> {
  ensureMonitor();
  const a = (data ?? {}) as Partial<Account>;
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const positions: Position[] = Array.isArray(a.positions)
    ? a.positions
        .filter((p) => p && (p.side === "buy" || p.side === "sell") && Number(p.qty) > 0)
        .map((p) => ({
          id: String(p.id ?? Math.random().toString(36).slice(2)),
          side: p.side,
          qty: num(p.qty, 0),
          entry: num(p.entry, 0),
          sl: p.sl != null ? num(p.sl, 0) : null,
          target: p.target != null ? num(p.target, 0) : null,
          openedAt: num(p.openedAt, Date.now()),
        }))
    : [];
  const history: Trade[] = Array.isArray(a.history)
    ? a.history
        .filter((t) => t && (t.side === "buy" || t.side === "sell"))
        .map((t) => ({
          id: String(t.id ?? Math.random().toString(36).slice(2)),
          side: t.side,
          qty: num(t.qty, 0),
          entry: num(t.entry, 0),
          sl: t.sl != null ? num(t.sl, 0) : null,
          target: t.target != null ? num(t.target, 0) : null,
          openedAt: num(t.openedAt, 0),
          exit: num(t.exit, 0),
          closedAt: num(t.closedAt, Date.now()),
          pnl: num(t.pnl, 0),
          reason: (["Manual", "Stop-loss", "Target"].includes(t.reason as string)
            ? t.reason
            : "Manual") as Trade["reason"],
        }))
    : [];
  const account: Account = {
    cash: num(a.cash, START_CASH),
    starting: num(a.starting, START_CASH),
    positions,
    history,
  };
  mem[inst] = account;
  const persisted = (await api("import", inst, { account })) !== null;
  return { ok: true, persisted };
}

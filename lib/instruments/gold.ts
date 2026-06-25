import { tradingviewScanCols } from "../sources/tradingview";
import { OUNCE_TO_GRAM } from "../fred";
import type { NiftyTechnicals } from "./nifty";

let cache: { t: NiftyTechnicals; expires: number } | null = null;

/** Full technical snapshot of spot gold (TVC:GOLD), in USD per GRAM. */
export async function getGoldTechnicals(): Promise<NiftyTechnicals | null> {
  if (cache && cache.expires > Date.now()) return cache.t;
  const cols = [
    "close", "EMA20", "EMA50", "EMA200", "RSI", "MACD.macd", "MACD.signal",
    "ADX", "ATR", "Pivot.M.Classic.S1", "Pivot.M.Classic.R1",
    "Pivot.M.Classic.S2", "Pivot.M.Classic.R2", "High.1M", "Low.1M",
  ];
  try {
    const rows = await tradingviewScanCols(["TVC:GOLD"], cols, "global");
    const d = rows.get("TVC:GOLD");
    if (!d || typeof d[0] !== "number") throw new Error("no technicals");
    // Price-like fields -> per gram; oscillators stay unitless.
    const g = (i: number) =>
      typeof d[i] === "number" ? (d[i] as number) / OUNCE_TO_GRAM : NaN;
    const u = (i: number) => (typeof d[i] === "number" ? (d[i] as number) : NaN);
    const t: NiftyTechnicals = {
      cmp: g(0), ema20: g(1), ema50: g(2), ema200: g(3), rsi: u(4),
      macd: g(5), macdSignal: g(6), adx: u(7), atr: g(8),
      s1: g(9), r1: g(10), s2: g(11), r2: g(12), high1m: g(13), low1m: g(14),
    };
    if (Number.isNaN(t.cmp) || Number.isNaN(t.atr)) throw new Error("bad data");
    cache = { t, expires: Date.now() + 30_000 };
    return t;
  } catch {
    return cache?.t ?? null;
  }
}

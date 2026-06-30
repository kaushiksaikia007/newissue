import { resolveTvSymbol, type TvSymbol } from "./sources/tvSymbol";
import { tradingviewScanCols } from "./sources/tradingview";

// Generic technical snapshot for ANY TradingView symbol (stock, index,
// commodity, FX, crypto). Pulled from the TradingView scanner; the screener is
// detected by trying the most likely universes in turn.

export interface SymbolTechnicals {
  price: number;
  change: number;
  changePct: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  adx: number;
  atr: number;
  s1: number;
  r1: number;
  s2: number;
  r2: number;
  high1m: number;
  low1m: number;
  high52: number;
  low52: number;
}

const COLS = [
  "close", // 0
  "change", // 1  (percent)
  "change_abs", // 2
  "EMA20", // 3
  "EMA50", // 4
  "EMA200", // 5
  "RSI", // 6
  "MACD.macd", // 7
  "MACD.signal", // 8
  "ADX", // 9
  "ATR", // 10
  "Pivot.M.Classic.S1", // 11
  "Pivot.M.Classic.R1", // 12
  "Pivot.M.Classic.S2", // 13
  "Pivot.M.Classic.R2", // 14
  "High.1M", // 15
  "Low.1M", // 16
  "price_52_week_high", // 17
  "price_52_week_low", // 18
];

// US equities live in "america"; NSE/BSE in "india"; indices/FX/commodities/
// crypto are mostly reachable via "global". Try in that order.
const SCREENERS = ["america", "india", "global", "crypto"];

export async function getSymbolMeta(symbol: string): Promise<TvSymbol | null> {
  return resolveTvSymbol(symbol);
}

export async function getSymbolTechnicals(
  symbol: string,
): Promise<SymbolTechnicals | null> {
  const sym = (symbol || "").toUpperCase().trim();
  if (!sym.includes(":")) return null;

  for (const screener of SCREENERS) {
    try {
      const rows = await tradingviewScanCols([sym], COLS, screener);
      const d = rows.get(sym);
      if (d && typeof d[0] === "number") {
        const n = (i: number) => (typeof d[i] === "number" ? (d[i] as number) : NaN);
        return {
          price: n(0),
          changePct: Number.isNaN(n(1)) ? 0 : n(1),
          change: Number.isNaN(n(2)) ? 0 : n(2),
          ema20: n(3),
          ema50: n(4),
          ema200: n(5),
          rsi: n(6),
          macd: n(7),
          macdSignal: n(8),
          adx: n(9),
          atr: n(10),
          s1: n(11),
          r1: n(12),
          s2: n(13),
          r2: n(14),
          high1m: n(15),
          low1m: n(16),
          high52: n(17),
          low52: n(18),
        };
      }
    } catch {
      /* try next screener */
    }
  }
  return null;
}

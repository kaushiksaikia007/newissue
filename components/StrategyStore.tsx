"use client";

import { createContext, useCallback, useContext, useState } from "react";

export type StratInst = "gold" | "nifty" | "sensex";

export interface StoredLeg {
  side: "buy" | "sell";
  show: boolean;
  entry_zone: string;
  entry_mid: number;
  stop_loss: number;
  target_1: number;
  target_2: number;
  risk_reward: string;
  probability: number;
}

export interface StoredStrategy {
  buy: StoredLeg;
  sell: StoredLeg;
  horizon: string;
  horizonLabel: string;
  profit: number;
  no_trade: boolean;
  fetchedAt: string;
}

interface Ctx {
  strategies: Partial<Record<StratInst, StoredStrategy>>;
  setStrategy: (inst: StratInst, s: StoredStrategy) => void;
}

const StrategyCtx = createContext<Ctx | null>(null);

/**
 * Holds the last strategy the user generated on each instrument's dashboard so
 * the Paper Trading desk can show those exact setups as load buttons.
 */
export function StrategyStoreProvider({ children }: { children: React.ReactNode }) {
  const [strategies, setStrategies] = useState<
    Partial<Record<StratInst, StoredStrategy>>
  >({});
  const setStrategy = useCallback((inst: StratInst, s: StoredStrategy) => {
    setStrategies((prev) => ({ ...prev, [inst]: s }));
  }, []);
  return (
    <StrategyCtx.Provider value={{ strategies, setStrategy }}>
      {children}
    </StrategyCtx.Provider>
  );
}

export function useStrategyStore(): Ctx {
  const c = useContext(StrategyCtx);
  if (!c) throw new Error("useStrategyStore must be used within StrategyStoreProvider");
  return c;
}

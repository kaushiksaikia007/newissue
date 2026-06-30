"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Fixed tabs plus dynamic "isin:<ISIN>" tabs. */
export type Tab = string;

export interface IsinTab {
  isin: string;
  label: string;
}

export interface SymTab {
  symbol: string; // TradingView "EXCHANGE:TICKER"
  label: string;
}

interface TabCtxValue {
  tab: Tab;
  setTab: (t: Tab) => void;
  isinTabs: IsinTab[];
  openIsin: (isin: string, label?: string) => void;
  closeIsin: (isin: string) => void;
  setIsinLabel: (isin: string, label: string) => void;
  symTabs: SymTab[];
  openSym: (symbol: string, label?: string) => void;
  closeSym: (symbol: string) => void;
}

const TabCtx = createContext<TabCtxValue>({
  tab: "gold",
  setTab: () => {},
  isinTabs: [],
  openIsin: () => {},
  closeIsin: () => {},
  setIsinLabel: () => {},
  symTabs: [],
  openSym: () => {},
  closeSym: () => {},
});

const TABS_KEY = "isin-tabs";
const SYM_KEY = "sym-tabs";

export function TabProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<Tab>("gold");
  const [isinTabs, setIsinTabs] = useState<IsinTab[]>([]);
  const [symTabs, setSymTabs] = useState<SymTab[]>([]);

  // Restore the last-used tab + open ISIN/symbol tabs (browser-tab feel).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TABS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as IsinTab[];
        if (Array.isArray(parsed)) setIsinTabs(parsed.filter((t) => t?.isin));
      }
    } catch {
      /* ignore */
    }
    try {
      const raw = localStorage.getItem(SYM_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SymTab[];
        if (Array.isArray(parsed)) setSymTabs(parsed.filter((t) => t?.symbol));
      }
    } catch {
      /* ignore */
    }
    const s = localStorage.getItem("active-tab");
    if (s) setTabState(s);
  }, []);

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem("active-tab", t);
    } catch {
      /* ignore */
    }
  }, []);

  const openIsin = useCallback(
    (rawIsin: string, label?: string) => {
      const isin = rawIsin.toUpperCase().trim();
      if (!isin) return;
      setIsinTabs((prev) => {
        const next = prev.some((t) => t.isin === isin)
          ? prev
          : [...prev, { isin, label: label || isin }];
        try {
          localStorage.setItem(TABS_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      setTab(`isin:${isin}`);
    },
    [setTab],
  );

  const closeIsin = useCallback((isin: string) => {
    setIsinTabs((prev) => {
      const next = prev.filter((t) => t.isin !== isin);
      try {
        localStorage.setItem(TABS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setTabState((cur) => {
      if (cur !== `isin:${isin}`) return cur;
      try {
        localStorage.setItem("active-tab", "gold");
      } catch {
        /* ignore */
      }
      return "gold";
    });
  }, []);

  const setIsinLabel = useCallback((isin: string, label: string) => {
    setIsinTabs((prev) => {
      const next = prev.map((t) => (t.isin === isin ? { ...t, label } : t));
      try {
        localStorage.setItem(TABS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const openSym = useCallback(
    (rawSymbol: string, label?: string) => {
      const symbol = rawSymbol.toUpperCase().trim();
      if (!symbol) return;
      setSymTabs((prev) => {
        const next = prev.some((t) => t.symbol === symbol)
          ? prev.map((t) => (t.symbol === symbol && label ? { ...t, label } : t))
          : [...prev, { symbol, label: label || symbol }];
        try {
          localStorage.setItem(SYM_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      setTab(`sym:${symbol}`);
    },
    [setTab],
  );

  const closeSym = useCallback((symbol: string) => {
    setSymTabs((prev) => {
      const next = prev.filter((t) => t.symbol !== symbol);
      try {
        localStorage.setItem(SYM_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setTabState((cur) => {
      if (cur !== `sym:${symbol}`) return cur;
      try {
        localStorage.setItem("active-tab", "analyze");
      } catch {
        /* ignore */
      }
      return "analyze";
    });
  }, []);

  const value = useMemo(
    () => ({
      tab,
      setTab,
      isinTabs,
      openIsin,
      closeIsin,
      setIsinLabel,
      symTabs,
      openSym,
      closeSym,
    }),
    [tab, setTab, isinTabs, openIsin, closeIsin, setIsinLabel, symTabs, openSym, closeSym],
  );

  return <TabCtx.Provider value={value}>{children}</TabCtx.Provider>;
}

export const useTab = () => useContext(TabCtx);

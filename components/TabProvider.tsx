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

interface TabCtxValue {
  tab: Tab;
  setTab: (t: Tab) => void;
  isinTabs: IsinTab[];
  openIsin: (isin: string, label?: string) => void;
  closeIsin: (isin: string) => void;
  setIsinLabel: (isin: string, label: string) => void;
}

const TabCtx = createContext<TabCtxValue>({
  tab: "gold",
  setTab: () => {},
  isinTabs: [],
  openIsin: () => {},
  closeIsin: () => {},
  setIsinLabel: () => {},
});

const TABS_KEY = "isin-tabs";

export function TabProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<Tab>("gold");
  const [isinTabs, setIsinTabs] = useState<IsinTab[]>([]);

  // Restore the last-used tab + open ISIN tabs (browser-tab feel across reloads).
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

  const value = useMemo(
    () => ({ tab, setTab, isinTabs, openIsin, closeIsin, setIsinLabel }),
    [tab, setTab, isinTabs, openIsin, closeIsin, setIsinLabel],
  );

  return <TabCtx.Provider value={value}>{children}</TabCtx.Provider>;
}

export const useTab = () => useContext(TabCtx);

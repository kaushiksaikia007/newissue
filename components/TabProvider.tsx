"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Tab = "gold" | "nifty";

const TabCtx = createContext<{ tab: Tab; setTab: (t: Tab) => void }>({
  tab: "gold",
  setTab: () => {},
});

export function TabProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<Tab>("gold");

  // Restore the last-used tab (browser-tab feel across reloads).
  useEffect(() => {
    const s = localStorage.getItem("active-tab");
    if (s === "gold" || s === "nifty") setTabState(s);
  }, []);

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem("active-tab", t);
    } catch {
      /* ignore */
    }
  };

  return <TabCtx.Provider value={{ tab, setTab }}>{children}</TabCtx.Provider>;
}

export const useTab = () => useContext(TabCtx);

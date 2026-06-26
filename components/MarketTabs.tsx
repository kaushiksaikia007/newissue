"use client";

import Dashboard from "./Dashboard";
import { GOLD_CONFIG, NIFTY_CONFIG } from "@/lib/instruments/config";
import { useTab } from "./TabProvider";

/**
 * Both instrument dashboards stay mounted; we just toggle visibility — so each
 * tab keeps its own state (analysis, chat, scroll) when you switch, like
 * browser tabs.
 */
export default function MarketTabs() {
  const { tab } = useTab();
  return (
    <>
      <div style={{ display: tab === "gold" ? "block" : "none" }}>
        <Dashboard cfg={GOLD_CONFIG} />
      </div>
      <div style={{ display: tab === "nifty" ? "block" : "none" }}>
        <Dashboard cfg={NIFTY_CONFIG} />
      </div>
    </>
  );
}

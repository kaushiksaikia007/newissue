"use client";

import PaperTerminal from "./PaperTerminal";
import IsinView from "./IsinView";
import IsinLookupView from "./IsinLookupView";
import WatchlistView from "./WatchlistView";
import CountryBrain from "./CountryBrain";
import { useTab } from "./TabProvider";

/**
 * Each tab's view stays mounted; we just toggle visibility — so each tab keeps
 * its own state (analysis, chat, scroll) when you switch, like browser tabs.
 */
export default function MarketTabs() {
  const { tab, isinTabs } = useTab();
  return (
    <>
      <div style={{ display: tab === "country" ? "block" : "none" }}>
        <CountryBrain />
      </div>
      {/* Other brains — content coming soon. */}
      <div style={{ display: tab === "company" ? "block" : "none" }} />
      <div style={{ display: tab === "sector" ? "block" : "none" }} />
      <div style={{ display: tab === "commodities" ? "block" : "none" }} />
      <div style={{ display: tab === "isin" ? "block" : "none" }}>
        <IsinLookupView />
      </div>
      <div style={{ display: tab === "watchlist" ? "block" : "none" }}>
        <WatchlistView active={tab === "watchlist"} />
      </div>
      <div style={{ display: tab === "paper" ? "block" : "none" }}>
        <PaperTerminal />
      </div>
      {isinTabs.map((t) => (
        <div
          key={t.isin}
          style={{ display: tab === `isin:${t.isin}` ? "block" : "none" }}
        >
          <IsinView isin={t.isin} />
        </div>
      ))}
    </>
  );
}

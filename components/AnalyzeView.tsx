"use client";

import { useEffect, useState } from "react";
import { useTab } from "./TabProvider";

interface SearchResult {
  symbol: string;
  ticker: string;
  exchange: string;
  description: string;
  type: string;
  currency?: string;
}

export default function AnalyzeView() {
  const { symTabs, openSym, closeSym } = useTab();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 1) {
      setResults([]);
      return;
    }
    let active = true;
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/tv/search?q=${encodeURIComponent(text)}`, {
          cache: "no-store",
        }).then((res) => res.json());
        if (active && Array.isArray(r.results)) setResults(r.results);
      } catch {
        /* ignore */
      } finally {
        if (active) setSearching(false);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [q]);

  const pick = (r: SearchResult) => {
    setQ("");
    setResults([]);
    openSym(r.symbol, r.description || r.ticker);
  };

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">
          <div
            className="coin"
            style={{ background: "radial-gradient(circle at 30% 28%,#ffd98a,#c98a1a)", color: "#2a1c02" }}
          >
            🔍
          </div>
          <div>
            <h1>Analyse any market</h1>
            <p>Search a stock, index, commodity, FX or crypto — get a full breakdown and a disciplined signal</p>
          </div>
        </div>
      </header>

      <div className="wl-toolbar">
        <div className="wl-search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search any market — AAPL, NIFTY, gold, BTC, EURUSD…"
            aria-label="Search TradingView symbols"
            suppressHydrationWarning
          />
          {(results.length > 0 || searching) && (
            <div className="wl-results">
              {searching && results.length === 0 && (
                <div className="wl-result muted">Searching…</div>
              )}
              {results.map((r) => (
                <button
                  type="button"
                  key={r.symbol}
                  className="wl-result"
                  onClick={() => pick(r)}
                  suppressHydrationWarning
                >
                  <span className="wl-r-main">
                    <span className="wl-r-tick">{r.ticker}</span>
                    <span className="wl-r-desc">{r.description || r.symbol}</span>
                  </span>
                  <span className="wl-r-meta">
                    {r.exchange}
                    {r.type ? ` · ${r.type}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {symTabs.length === 0 ? (
        <div className="strat-empty">
          Search a market above to open a dedicated analysis desk — live price, full
          technical read, and a Buy/Sell call that only fires on high-probability
          setups (otherwise it tells you to wait).
        </div>
      ) : (
        <>
          <div className="section-title">Open analyses ({symTabs.length})</div>
          <div className="isinlk-grid">
            {symTabs.map((t) => (
              <div className="isinlk-card" key={t.symbol}>
                <button
                  type="button"
                  suppressHydrationWarning
                  className="isinlk-open"
                  onClick={() => openSym(t.symbol, t.label)}
                >
                  <span className="isinlk-name" title={t.label}>
                    {t.label}
                  </span>
                  <span className="isinlk-code">{t.symbol}</span>
                </button>
                <button
                  type="button"
                  suppressHydrationWarning
                  className="wl-x"
                  onClick={() => closeSym(t.symbol)}
                  aria-label={`Close ${t.symbol}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

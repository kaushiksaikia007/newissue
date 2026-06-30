"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useWatchlist, type WatchItem } from "./WatchlistProvider";

interface SearchResult {
  symbol: string;
  ticker: string;
  exchange: string;
  description: string;
  type: string;
  currency?: string;
}

interface Quote {
  price: number;
  change: number;
  changePct: number;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function WatchlistView({ active = true }: { active?: boolean }) {
  const { signedIn, items, add, remove, setTarget, trigger } = useWatchlist();
  const { openAuth } = useAuth();

  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const firing = useRef<Set<string>>(new Set());

  // Debounced TradingView symbol search.
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

  // Live prices for every watched symbol, refreshed each second.
  const symbolsKey = useMemo(
    () => items.map((i) => i.symbol).sort().join(","),
    [items],
  );
  useEffect(() => {
    // Stream live ticks while the tab is open (it stays mounted). Server-Sent
    // Events push each price change the instant it arrives; if the stream is
    // unavailable (blocked proxy / unsupported), fall back to fast polling.
    if (!active || !symbolsKey) return;
    let live = true;
    let es: EventSource | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const merge = (q?: Record<string, Quote>) => {
      if (live && q) setQuotes((prev) => ({ ...prev, ...q }));
    };

    const startPolling = () => {
      if (pollId || !live) return;
      const tick = async () => {
        try {
          const r = await fetch(`/api/quote?symbols=${encodeURIComponent(symbolsKey)}`, {
            cache: "no-store",
          }).then((res) => res.json());
          merge(r.quotes);
        } catch {
          /* keep last */
        }
      };
      tick();
      pollId = setInterval(tick, 600);
    };

    try {
      es = new EventSource(`/api/quote/stream?symbols=${encodeURIComponent(symbolsKey)}`);
      // No data within 8s (e.g. SSE blocked) -> fall back to polling.
      fallbackTimer = setTimeout(() => {
        es?.close();
        es = null;
        startPolling();
      }, 8000);
      es.onmessage = (e) => {
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        try {
          merge(JSON.parse(e.data).quotes);
        } catch {
          /* ignore keep-alives / partials */
        }
      };
      es.onerror = () => {
        // Transient drops auto-reconnect; a hard close means fall back.
        if (es && es.readyState === EventSource.CLOSED) {
          es = null;
          startPolling();
        }
      };
    } catch {
      startPolling();
    }

    return () => {
      live = false;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (pollId) clearInterval(pollId);
      es?.close();
    };
  }, [symbolsKey, active]);

  // Fire the email the instant a live price crosses an armed target. The server
  // re-verifies the price and the trigger is claimed atomically, so the 24/7
  // cron backstop can never double-send. `firing` dedupes the ~1s poll window.
  useEffect(() => {
    if (!active) return;
    for (const it of items) {
      if (it.target == null || it.triggered) continue;
      const quote = quotes[it.symbol];
      if (!quote) continue;
      const hit =
        it.direction === "below" ? quote.price <= it.target : quote.price >= it.target;
      if (hit && !firing.current.has(it.id)) {
        firing.current.add(it.id);
        trigger(it.id).finally(() => firing.current.delete(it.id));
      }
    }
  }, [quotes, items, active, trigger]);

  const pick = async (r: SearchResult) => {
    setQ("");
    setResults([]);
    await add({
      symbol: r.symbol,
      display: r.description || r.ticker,
      exchange: r.exchange,
      type: r.type,
      currency: r.currency,
    });
  };

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">
          <div
            className="coin"
            style={{ background: "radial-gradient(circle at 30% 28%,#a8e6cf,#2f9e7a)", color: "#06281c" }}
          >
            👁
          </div>
          <div>
            <h1>Watchlist</h1>
            <p>Live TradingView prices · target-price email alerts, monitored 24/7</p>
          </div>
        </div>
      </header>

      <div className="wl-toolbar">
        <div className="wl-search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search any stock, index, commodity, crypto or FX…"
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
                  disabled={items.some((i) => i.symbol === r.symbol)}
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

      {!signedIn ? (
        <div className="strat-empty">
          <button type="button" className="link-btn" onClick={openAuth}>
            Sign in
          </button>{" "}
          to build a watchlist and receive target-price email alerts.
        </div>
      ) : items.length === 0 ? (
        <div className="strat-empty">
          Your watchlist is empty. Search above and tap a result to start watching it —
          then set a target price and we&apos;ll email you the moment it&apos;s hit.
        </div>
      ) : (
        <div className="wl-grid">
          {items.map((it) => (
            <WatchCard
              key={it.id}
              item={it}
              quote={quotes[it.symbol]}
              onRemove={() => remove(it.id)}
              onSetTarget={(t, d) => setTarget(it.id, t, d)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WatchCard({
  item,
  quote,
  onRemove,
  onSetTarget,
}: {
  item: WatchItem;
  quote?: Quote;
  onRemove: () => void;
  onSetTarget: (target: number | null, direction: "above" | "below") => void;
}) {
  const [target, setTargetInput] = useState(item.target != null ? String(item.target) : "");
  const [dir, setDir] = useState<"above" | "below">(item.direction === "below" ? "below" : "above");

  // Keep inputs in sync if the stored target changes elsewhere.
  useEffect(() => {
    setTargetInput(item.target != null ? String(item.target) : "");
    if (item.direction === "above" || item.direction === "below") setDir(item.direction);
  }, [item.target, item.direction]);

  const up = quote ? quote.change >= 0 : true;
  const save = () => {
    const n = Number(target);
    onSetTarget(target.trim() && n > 0 ? n : null, dir);
  };

  return (
    <div className="wl-card">
      <div className="wl-card-top">
        <div className="wl-card-id">
          <span className="wl-card-name" title={item.display}>
            {item.display}
          </span>
          <span className="wl-card-sym">
            {item.symbol}
            {item.currency ? ` · ${item.currency}` : ""}
          </span>
        </div>
        <button
          type="button"
          className="wl-x"
          onClick={onRemove}
          aria-label={`Remove ${item.symbol}`}
        >
          ✕
        </button>
      </div>

      <div className="wl-card-price">
        {quote ? (
          <>
            <span className="wl-card-val">{fmt(quote.price)}</span>
            <span className="wl-chg" style={{ color: up ? "#1fae6a" : "#ff5252" }}>
              {up ? "▲" : "▼"} {fmt(Math.abs(quote.change))} ({up ? "+" : "−"}
              {Math.abs(quote.changePct).toFixed(2)}%)
            </span>
          </>
        ) : (
          <span className="wl-card-val muted">…</span>
        )}
      </div>

      <div className="wl-target">
        <select
          value={dir}
          onChange={(e) => setDir(e.target.value as "above" | "below")}
          aria-label="Alert direction"
          suppressHydrationWarning
        >
          <option value="above">Rises to ≥</option>
          <option value="below">Falls to ≤</option>
        </select>
        <input
          type="number"
          inputMode="decimal"
          placeholder="target price"
          value={target}
          onChange={(e) => setTargetInput(e.target.value)}
          aria-label="Target price"
          suppressHydrationWarning
        />
        <button type="button" className="wl-set" onClick={save}>
          Set alert
        </button>
      </div>

      {item.target != null && (
        <div className={`wl-status${item.triggered ? " hit" : ""}`}>
          {item.triggered
            ? `✓ Target hit (${item.direction === "below" ? "≤" : "≥"} ${item.target}) — email sent`
            : `🔔 We'll email you when it ${item.direction === "below" ? "falls to ≤" : "rises to ≥"} ${item.target}`}
        </div>
      )}
    </div>
  );
}

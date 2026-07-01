"use client";

import { useEffect, useState } from "react";

interface Q {
  price: number;
  change: number;
  changePct: number;
}
interface FiiRow {
  category: string;
  date: string;
  buyValue: number;
  sellValue: number;
  netValue: number;
}

// TradingView symbols for the four live market values.
const SYMBOLS = ["NSE:INDIAVIX", "FX_IDC:USDINR", "TVC:IN10Y", "TVC:UKOIL"];
const SYMKEY = SYMBOLS.join(",");

const METRICS: {
  sym: string;
  label: string;
  prefix?: string;
  suffix?: string;
  dp: number;
}[] = [
  { sym: "NSE:INDIAVIX", label: "India VIX", dp: 4 },
  { sym: "FX_IDC:USDINR", label: "USD / INR", prefix: "₹", dp: 4 },
  { sym: "TVC:IN10Y", label: "India 10Y Yield", suffix: "%", dp: 3 },
  { sym: "TVC:UKOIL", label: "Brent Crude", prefix: "$", dp: 2 },
];

const fmt = (n: number, dp: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: dp });
const fmtCr = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// FII/FPI first, then DII.
const orderFlows = (rows: FiiRow[]): FiiRow[] =>
  [...rows].sort(
    (a, b) =>
      (a.category.toUpperCase().includes("FII") ? 0 : 1) -
      (b.category.toUpperCase().includes("FII") ? 0 : 1),
  );

export default function IndiaHeadline() {
  const [quotes, setQuotes] = useState<Record<string, Q>>({});
  const [flows, setFlows] = useState<FiiRow[] | null>(null);

  // Live prices via SSE (real-time ticks) with a polling fallback.
  useEffect(() => {
    let live = true;
    let es: EventSource | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const merge = (q?: Record<string, Q>) => {
      if (live && q) setQuotes((prev) => ({ ...prev, ...q }));
    };

    const startPolling = () => {
      if (pollId || !live) return;
      const tick = async () => {
        try {
          const r = await fetch(`/api/quote?symbols=${encodeURIComponent(SYMKEY)}`, {
            cache: "no-store",
          }).then((res) => res.json());
          merge(r.quotes);
        } catch {
          /* keep last */
        }
      };
      tick();
      pollId = setInterval(tick, 1000);
    };

    try {
      es = new EventSource(`/api/quote/stream?symbols=${encodeURIComponent(SYMKEY)}`);
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
          /* ignore keep-alives */
        }
      };
      es.onerror = () => {
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
  }, []);

  // FII/DII figures are end-of-day — refresh every few minutes.
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch("/api/india/fiidii", { cache: "no-store" }).then((res) =>
          res.json(),
        );
        if (live && Array.isArray(r.rows) && r.rows.length) setFlows(r.rows);
      } catch {
        /* keep last */
      }
    };
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  const flowDate = flows?.[0]?.date ?? "";

  return (
    <div className="ih-strip">
      <span className="ih-live">
        <span className="ih-live-dot" /> LIVE
      </span>

      {METRICS.map((m) => {
        const q = quotes[m.sym];
        const up = q ? q.change >= 0 : true;
        return (
          <div className="ih-card" key={m.sym}>
            <span className="ih-label">{m.label}</span>
            <span className="ih-value">
              {q ? `${m.prefix ?? ""}${fmt(q.price, m.dp)}${m.suffix ?? ""}` : "…"}
            </span>
            {q && (
              <span className={`ih-chg ${up ? "up" : "down"}`}>
                {up ? "▲" : "▼"} {fmt(Math.abs(q.change), m.dp)} ({up ? "+" : "−"}
                {Math.abs(q.changePct).toFixed(2)}%)
              </span>
            )}
          </div>
        );
      })}

      <div className="ih-card ih-flows">
        <span className="ih-label">
          FII / DII · Buy / Sell{flowDate ? ` · ${flowDate}` : ""}{" "}
          <span className="ih-unit">₹ Cr</span>
        </span>
        {flows ? (
          <div className="ih-flow-rows">
            {orderFlows(flows).map((r) => (
              <div className="ih-flow" key={r.category}>
                <span className="ih-flow-cat">{r.category}</span>
                <span className="ih-flow-bs">
                  <span className="ih-buy">{fmtCr(r.buyValue)}</span>
                  <span className="ih-slash">/</span>
                  <span className="ih-sell">{fmtCr(r.sellValue)}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className="ih-value">…</span>
        )}
      </div>
    </div>
  );
}

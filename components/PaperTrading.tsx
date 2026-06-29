"use client";

import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";
import { useStrategyStore, type StoredLeg } from "./StrategyStore";

interface Position {
  id: string;
  side: "buy" | "sell";
  qty: number;
  entry: number;
  sl: number | null;
  target: number | null;
}
interface Trade extends Position {
  exit: number;
  pnl: number;
  reason: string;
}
interface PaperData {
  instrument: string;
  cash: number;
  starting: number;
  positions: Position[];
  history: Trade[];
  ltp: number | null;
}

const usd = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number) => (n >= 0 ? "+" : "−") + usd(Math.abs(n));
const fp = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function pnlOf(p: Position, ltp: number): number {
  return p.side === "buy" ? (ltp - p.entry) * p.qty : (p.entry - ltp) * p.qty;
}

export default function PaperTrading({
  instrument,
  label,
}: {
  instrument: "nifty" | "gold" | "sensex";
  label: string;
}) {
  const { strategies } = useStrategyStore();
  const stored = strategies[instrument];
  const [data, setData] = useState<PaperData | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState("10");
  const [sl, setSl] = useState("");
  const [target, setTarget] = useState("");
  const [tpPct, setTpPct] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [histPage, setHistPage] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const d: PaperData = await fetch(`/api/paper?instrument=${instrument}`, {
        cache: "no-store",
      }).then((r) => r.json());
      setData(d);
    } catch {
      /* keep previous */
    }
  }, [instrument]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [refresh]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2800);
  };

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const r = await fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instrument, ...body }),
        }).then((res) => res.json());
        if (r.error) flash(r.error);
        if (r.positions) setData(r);
        return r;
      } catch {
        flash("Request failed.");
      }
    },
    [instrument],
  );

  const place = (extra: Record<string, unknown>) =>
    post({ action: "open", side, qty: Number(qty), ...extra });

  // Load a strategy into the ticket fields WITHOUT executing it — the user
  // reviews the prefilled side / stop-loss / target, then presses Place.
  const loadStrategy = (leg: StoredLeg) => {
    setSide(leg.side);
    setSl(String(leg.stop_loss));
    setTarget(String(leg.target_2));
    setTpPct("");
    if (!qty || Number(qty) <= 0) setQty("10");
    flash(
      `${leg.side.toUpperCase()} strategy loaded into the ticket — review and press Place to execute.`,
    );
  };

  // Split the generated setups into high (>65%) and low win-probability groups.
  const legs: StoredLeg[] = stored
    ? [stored.buy, stored.sell].filter((l) => l && l.target_2 > 0)
    : [];
  const highLegs = legs.filter((l) => l.probability > 65);
  const lowLegs = legs.filter((l) => l.probability <= 65);

  const reset = () => {
    if (confirm("Reset paper account to $1,000,000 and clear all trades?"))
      post({ action: "reset" });
  };

  const ltp = data?.ltp ?? 0;

  // Derived stats
  const positions = data?.positions ?? [];
  const history = data?.history ?? [];
  const cash = data?.cash ?? 0;
  const starting = data?.starting ?? 1_000_000;
  const openPnl = positions.reduce((s, p) => s + pnlOf(p, ltp), 0);
  const invested = positions.reduce((s, p) => s + p.entry * p.qty, 0);
  const openPct = invested > 0 ? (openPnl / invested) * 100 : 0;
  const equity = cash + invested + openPnl;
  const totalPnl = equity - starting;
  const totalPct = (totalPnl / starting) * 100;
  const realized = history.reduce((s, t) => s + t.pnl, 0);
  const wins = history.filter((t) => t.pnl > 0).length;
  const winRate = history.length ? Math.round((wins / history.length) * 100) : 0;

  return (
    <section className="paper">
      <div className="paper-head">
        <div className="strat-title">
          <span
            className="strat-badge"
            style={{ background: "linear-gradient(135deg,#7ed0ff,#2f6fd0)", color: "#06203f" }}
          >
            PT
          </span>
          Paper Trading
          <span className="paper-demo">Demo · {label} · auto-runs 24/7</span>
        </div>
        <div className="paper-ltp">
          LTP <strong>{ltp ? fp(ltp) : "…"}</strong>
          <button className="paper-reset" onClick={reset}>
            Reset
          </button>
        </div>
      </div>

      <div className="paper-stats">
        <Stat k="Equity" v={usd(equity)} />
        <Stat k="Available Cash" v={usd(cash)} />
        <Stat
          k="Total P&L"
          v={`${signed(totalPnl)} (${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(2)}%)`}
          color={totalPnl >= 0 ? "var(--green)" : "var(--red)"}
        />
        <Stat
          k="Open P&L"
          v={`${signed(openPnl)} (${openPct >= 0 ? "+" : ""}${openPct.toFixed(2)}%)`}
          color={openPnl >= 0 ? "var(--green)" : "var(--red)"}
        />
        <Stat k="Realized" v={signed(realized)} color={realized >= 0 ? "var(--green)" : "var(--red)"} />
        <Stat k="Win Rate" v={`${winRate}% (${wins}/${history.length})`} />
      </div>

      <div className="ticket">
        <div className="ticket-side">
          <button className={`tk-side buy${side === "buy" ? " active" : ""}`} onClick={() => setSide("buy")}>
            BUY
          </button>
          <button className={`tk-side sell${side === "sell" ? " active" : ""}`} onClick={() => setSide("sell")}>
            SELL
          </button>
        </div>
        <label className="tk-field">
          Qty
          <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="tk-field">
          Stop-loss
          <input type="number" placeholder="optional" value={sl} onChange={(e) => setSl(e.target.value)} />
        </label>
        <label className="tk-field">
          Target
          <input type="number" placeholder="optional" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label className="tk-field">
          Profit %
          <input
            type="number"
            step="0.1"
            placeholder="auto-close"
            value={tpPct}
            onChange={(e) => setTpPct(e.target.value)}
          />
        </label>
        <button
          className={`tk-place ${side}`}
          onClick={() =>
            place({
              sl: sl ? Number(sl) : null,
              target: target ? Number(target) : null,
              profitPct: tpPct ? Number(tpPct) : null,
            })
          }
        >
          Place {side.toUpperCase()} @ Market
        </button>
      </div>

      <div className="exec-wrap">
        {!stored ? (
          <div className="exec-empty">
            No strategy generated yet. Open the{" "}
            <strong>{label}</strong> dashboard, click <strong>Generate</strong> in
            the AI Trading Strategy panel, and the exact setups will appear here to
            load into your ticket.
          </div>
        ) : legs.length === 0 ? (
          <div className="exec-empty">
            The last {label} analysis ({stored.horizonLabel}) found no actionable
            levels. Generate again on the dashboard.
          </div>
        ) : (
          <>
            <div className="exec-title">
              Strategies generated on the <strong>{label}</strong> dashboard ·{" "}
              {stored.horizonLabel} · {timeAgo(stored.fetchedAt)}. Click a setup to
              load it into the ticket — execution stays manual (press Place).
            </div>

            {highLegs.length > 0 && (
              <div className="exec-group">
                <div className="exec-group-h high">
                  High win probability (above 65%)
                </div>
                <div className="exec-row">
                  {highLegs.map((leg) => (
                    <StratLoadButton
                      key={leg.side}
                      leg={leg}
                      onLoad={loadStrategy}
                    />
                  ))}
                </div>
              </div>
            )}

            {lowLegs.length > 0 && (
              <div className="exec-group">
                <div className="exec-group-h low">
                  Lower win probability (65% or below)
                </div>
                <div className="exec-row">
                  {lowLegs.map((leg) => (
                    <StratLoadButton
                      key={leg.side}
                      leg={leg}
                      onLoad={loadStrategy}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {msg && <div className="paper-msg">{msg}</div>}

      <div className="paper-sub">Open Positions ({positions.length})</div>
      {positions.length === 0 ? (
        <div className="paper-empty">No open positions. Place an order above.</div>
      ) : (
        <div className="ptable">
          <div className="ptr phead">
            <span>Side</span><span>Qty</span><span>Entry</span><span>LTP</span>
            <span>SL</span><span>Target</span><span>P&L</span><span></span>
          </div>
          {positions.map((p) => {
            const pnl = pnlOf(p, ltp);
            return (
              <div className="ptr" key={p.id}>
                <span className={p.side === "buy" ? "pos-buy" : "pos-sell"}>{p.side.toUpperCase()}</span>
                <span>{p.qty}</span>
                <span>{fp(p.entry)}</span>
                <span>{ltp ? fp(ltp) : "—"}</span>
                <span>{p.sl != null ? fp(p.sl) : "—"}</span>
                <span>{p.target != null ? fp(p.target) : "—"}</span>
                <span style={{ color: pnl >= 0 ? "var(--green)" : "var(--red)" }}>{signed(pnl)}</span>
                <span>
                  <button className="pclose" onClick={() => post({ action: "close", id: p.id })}>
                    Close
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {history.length > 0 &&
        (() => {
          const PER_PAGE = 15;
          const pages = Math.max(1, Math.ceil(history.length / PER_PAGE));
          const page = Math.min(histPage, pages - 1);
          const slice = history.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
          return (
            <>
              <div className="paper-sub">Trade History ({history.length})</div>
              <div className="ptable hist">
                <div className="ptr phead">
                  <span>Side</span><span>Qty</span><span>Entry</span><span>Exit</span>
                  <span>Exit by</span><span>P&L</span>
                </div>
                {slice.map((t, idx) => (
                  <div className="ptr" key={t.id + idx}>
                    <span className={t.side === "buy" ? "pos-buy" : "pos-sell"}>{t.side.toUpperCase()}</span>
                    <span>{t.qty}</span>
                    <span>{fp(t.entry)}</span>
                    <span>{fp(t.exit)}</span>
                    <span className="muted">{t.reason}</span>
                    <span style={{ color: t.pnl >= 0 ? "var(--green)" : "var(--red)" }}>{signed(t.pnl)}</span>
                  </div>
                ))}
              </div>
              {pages > 1 && (
                <div className="pager">
                  <button
                    className="pager-btn"
                    disabled={page <= 0}
                    onClick={() => setHistPage(page - 1)}
                  >
                    ← Prev
                  </button>
                  <span className="pager-info">
                    Page {page + 1} of {pages}
                  </span>
                  <button
                    className="pager-btn"
                    disabled={page >= pages - 1}
                    onClick={() => setHistPage(page + 1)}
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          );
        })()}
    </section>
  );
}

function StratLoadButton({
  leg,
  onLoad,
}: {
  leg: StoredLeg;
  onLoad: (leg: StoredLeg) => void;
}) {
  const high = leg.probability > 65;
  const kind = leg.side;
  return (
    <button
      className={`exec-btn ${kind} tier-${high ? "high" : "low"}`}
      onClick={() => onLoad(leg)}
    >
      <span className="exec-top">
        <span className="exec-dir">
          {kind === "buy" ? "▲ Load Buy" : "▼ Load Sell"}
        </span>
        <span className={`prob-pill ${high ? "high" : "low"}`}>
          <span className="prob-num">{leg.probability}%</span>
          <span className="prob-cap">win</span>
        </span>
      </span>
      <span className="exec-levels">
        Entry {leg.entry_mid} · SL {leg.stop_loss} · T1 {leg.target_1} · T2{" "}
        {leg.target_2}
      </span>
    </button>
  );
}

function Stat({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="pstat">
      <span className="pstat-k">{k}</span>
      <span className="pstat-v" style={color ? { color } : undefined}>
        {v}
      </span>
    </div>
  );
}

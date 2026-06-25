"use client";

import { useCallback, useEffect, useState } from "react";

type Verdict = "BUY" | "SELL" | "HOLD";
interface Strategy {
  show: boolean;
  side: "buy" | "sell";
  entry_zone: string;
  entry_mid: number;
  stop_loss: number;
  target_1: number;
  target_2: number;
  risk_reward: string;
  probability: number;
}
interface Report {
  thesis: string;
  risks: string[];
  stop_rationale: string;
  targets_view: string;
  invalidation: string;
  hold: string;
}
interface StrategyData {
  recommendation: { verdict: Verdict; confidence: number; market_bias: string };
  market_summary: Record<string, string>;
  buy_strategy: Strategy;
  sell_strategy: Strategy;
  report: Report;
  no_trade: boolean;
  no_trade_reason: string;
  market_open: boolean;
  session: string;
  inputs: Record<string, number | string>;
  scores: Record<string, number>;
  available: boolean;
  engine: string;
  horizon: string;
}

const HORIZONS = [
  { id: "intraday", label: "Intraday" },
  { id: "short", label: "Short (1-4w)" },
  { id: "long", label: "Long (1-12m)" },
];

const verdictColor: Record<Verdict, string> = {
  BUY: "#1fae6a",
  SELL: "#ff5252",
  HOLD: "#5aa9ff",
};

const SUMMARY_LABELS: Record<string, string> = {
  trend: "Trend",
  breadth: "Breadth",
  momentum: "Momentum",
  institutional_flows: "Inst. Flows",
  volatility: "Volatility",
  macro_outlook: "Macro",
  dollar: "US Dollar",
  rates: "Rates / Fed",
  inflation: "Inflation",
  sentiment: "Risk / Geo",
};

function rr(side: "buy" | "sell", entry: number, sl: number, t2: number): string {
  const risk = side === "buy" ? entry - sl : sl - entry;
  const reward = side === "buy" ? t2 - entry : entry - t2;
  if (risk <= 0 || reward <= 0) return "—";
  return `1:${(reward / risk).toFixed(1)}`;
}

export default function StrategyPanel({ endpoint }: { endpoint: string }) {
  const [horizon, setHorizon] = useState("short");
  const [profit, setProfit] = useState("1.5");
  const [data, setData] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [buySL, setBuySL] = useState<string>("");
  const [sellSL, setSellSL] = useState<string>("");

  const load = useCallback(
    async (h: string, p: string) => {
      setLoading(true);
      try {
        const pn = Number(p) || 1.5;
        const res: StrategyData = await fetch(
          `${endpoint}?horizon=${h}&profit=${pn}`,
          { cache: "no-store" },
        ).then((r) => r.json());
        setData(res);
        setBuySL(String(res.buy_strategy.stop_loss));
        setSellSL(String(res.sell_strategy.stop_loss));
      } catch {
        /* keep previous */
      } finally {
        setLoading(false);
      }
    },
    [endpoint],
  );

  useEffect(() => {
    load(horizon, "1.5");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const onHorizon = (h: string) => {
    setHorizon(h);
    load(h, profit);
  };

  return (
    <section className="strat">
      <div className="strat-controls">
        <div className="strat-title">
          <span className="strat-badge">AI</span> Trading Strategy
          {data?.session && (
            <span
              className={`sess ${data.market_open ? "sess-open" : "sess-closed"}`}
            >
              {data.market_open ? "🟢" : "🔴"} {data.session}
            </span>
          )}
        </div>
        <div className="strat-inputs">
          <div className="seg">
            {HORIZONS.map((h) => (
              <button
                key={h.id}
                className={`seg-btn${horizon === h.id ? " active" : ""}`}
                onClick={() => onHorizon(h.id)}
              >
                {h.label}
              </button>
            ))}
          </div>
          <label className="profit">
            Target&nbsp;%
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={profit}
              onChange={(e) => setProfit(e.target.value)}
            />
          </label>
          <button
            className="strat-go"
            onClick={() => load(horizon, profit)}
            disabled={loading}
          >
            {loading ? "Analyzing…" : "Generate"}
          </button>
        </div>
      </div>

      {!data ? (
        <div className="spin">Generating strategy…</div>
      ) : !data.available ? (
        <div className="strat-empty">⚠️ {data.no_trade_reason}</div>
      ) : (
        <>
          <div className="strat-rec">
            <div
              className="strat-verdict"
              style={{ color: verdictColor[data.recommendation.verdict] }}
            >
              {data.recommendation.verdict}
            </div>
            <div className="strat-rec-meta">
              <div>
                <span className="muted">Bias</span>
                {data.recommendation.market_bias}
              </div>
              <div>
                <span className="muted">Confidence</span>
                {data.recommendation.confidence}%
              </div>
              {data.inputs.cmp != null && (
                <div>
                  <span className="muted">CMP</span>
                  {data.inputs.cmp}
                </div>
              )}
            </div>
          </div>

          <div className="strat-summary">
            {Object.entries(data.market_summary).map(([k, v]) => (
              <div className="sum-cell" key={k}>
                <span className="sum-k">{SUMMARY_LABELS[k] ?? k}</span>
                <span className="sum-v">{v}</span>
              </div>
            ))}
          </div>

          {data.no_trade ? (
            <div className="no-trade">
              <span className="no-trade-flag">⏸ No high-probability setup</span>
              <span>{data.no_trade_reason}</span>
            </div>
          ) : (
            <>
              {data.report.hold && (
                <div className="hold-bar">
                  <span className="hold-label">⏳ AI-suggested hold</span>
                  <span className="hold-val">{data.report.hold}</span>
                </div>
              )}
            <div className="strat-cards">
              {data.buy_strategy.show && (
                <StrategyCard
                  kind="BUY"
                  s={data.buy_strategy}
                  color={verdictColor.BUY}
                  sl={buySL}
                  setSL={setBuySL}
                />
              )}
              {data.sell_strategy.show && (
                <StrategyCard
                  kind="SELL"
                  s={data.sell_strategy}
                  color={verdictColor.SELL}
                  sl={sellSL}
                  setSL={setSellSL}
                />
              )}
            </div>
            </>
          )}

          <Report report={data.report} noTrade={data.no_trade} />
        </>
      )}
    </section>
  );
}

function StrategyCard({
  kind,
  s,
  color,
  sl,
  setSL,
}: {
  kind: string;
  s: Strategy;
  color: string;
  sl: string;
  setSL: (v: string) => void;
}) {
  const slNum = Number(sl) || s.stop_loss;
  const live = rr(s.side, s.entry_mid, slNum, s.target_2);
  const edited = slNum !== s.stop_loss;

  return (
    <div className="strat-card" style={{ borderColor: color }}>
      <div className="strat-card-head">
        <span style={{ color }}>{kind} Setup</span>
        <span className="strat-prob">{s.probability}% win prob</span>
      </div>
      <Row label="Entry" value={s.entry_zone} />
      <div className="strat-row">
        <span className="muted">Stop loss</span>
        <span className="sl-edit">
          <input
            type="number"
            value={sl}
            onChange={(e) => setSL(e.target.value)}
            aria-label="Edit stop loss"
          />
          {edited && (
            <button className="sl-reset" onClick={() => setSL(String(s.stop_loss))}>
              ↺
            </button>
          )}
        </span>
      </div>
      <Row label="Target 1" value={String(s.target_1)} />
      <Row label="Target 2" value={String(s.target_2)} />
      <div className="strat-row">
        <span className="muted">Risk / Reward {edited ? "(edited)" : ""}</span>
        <span className="strat-val" style={{ color }}>
          {live}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="strat-row">
      <span className="muted">{label}</span>
      <span className="strat-val">{value}</span>
    </div>
  );
}

function Report({ report, noTrade }: { report: Report; noTrade: boolean }) {
  if (!report.thesis) return null;
  return (
    <div className="strat-report">
      <div className="strat-report-head">
        {noTrade ? "📋 Market Analysis" : "📋 Strategy Report"}
      </div>
      <div className="rep-block">
        <div className="rep-h">{noTrade ? "🧭 What the AI sees" : "🧭 Thesis"}</div>
        <p>{report.thesis}</p>
      </div>
      {report.risks.length > 0 && (
        <div className="rep-block">
          <div className="rep-h rep-risk">
            {noTrade ? "⚠️ Factors to watch" : "⚠️ Key Risks"}
          </div>
          <ul className="rep-risks">
            {report.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {(report.stop_rationale || report.targets_view) && (
        <div className="rep-grid">
          {report.stop_rationale && (
            <div className="rep-block">
              <div className="rep-h">🛡️ Stop-loss</div>
              <p>{report.stop_rationale}</p>
            </div>
          )}
          {report.targets_view && (
            <div className="rep-block">
              <div className="rep-h">🎯 Targets</div>
              <p>{report.targets_view}</p>
            </div>
          )}
        </div>
      )}
      {report.invalidation && (
        <div className="rep-block">
          <div className="rep-h rep-inval">❌ Invalidation</div>
          <p>{report.invalidation}</p>
        </div>
      )}
    </div>
  );
}

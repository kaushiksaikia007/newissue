"use client";

import { useEffect, useState } from "react";
import type { GoldSignal, Metric, Recommendation } from "@/lib/types";
import { formatChange, formatValue } from "@/lib/format";
import Sparkline from "./Sparkline";
import Gauge from "./Gauge";

const recColor: Record<Recommendation, string> = {
  "Strong Buy": "#1fae6a",
  Buy: "var(--green)",
  Hold: "var(--blue)",
  Sell: "#ff8f6b",
  "Strong Sell": "var(--red)",
};

function scoreColor(score: number): string {
  if (score >= 6.5) return "var(--green)";
  if (score <= 3.5) return "var(--red)";
  return "var(--blue)";
}

export default function SignalHero({
  signals,
  gold,
  history,
  nextSignalIn,
  priceLabel,
  priceSuffix,
}: {
  signals: GoldSignal[];
  gold: Metric | null;
  history: number[];
  nextSignalIn: number;
  priceLabel: string;
  priceSuffix?: string;
}) {
  const [selected, setSelected] = useState<string>(
    signals[0]?.horizon ?? "intraday",
  );
  const [showFactors, setShowFactors] = useState(false);

  // Close the factor dialog on Escape.
  useEffect(() => {
    if (!showFactors) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowFactors(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showFactors]);
  const active =
    signals.find((s) => s.horizon === selected) ?? signals[0];
  if (!active) return null;

  const color = recColor[active.recommendation];
  const hi = history.length ? Math.max(...history) : null;
  const lo = history.length ? Math.min(...history) : null;

  return (
    <section className="signal">
      <div className="gauge">
        {gold && (
          <div className="gold-price">
            <div className="score">{priceLabel}</div>
            <div className="price">
              {formatValue(gold)}
              {priceSuffix ? <span className="per-unit">{priceSuffix}</span> : null}
            </div>
            <div
              className={`score ${gold.trend === "up" ? "bullish" : gold.trend === "down" ? "bearish" : ""}`}
            >
              {formatChange(gold)}
            </div>
            <Sparkline points={history} />
            {hi != null && lo != null && (
              <div className="hilo">
                <span>L ${lo.toFixed(2)}</span>
                <span>H ${hi.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}
        <div className="score" style={{ marginTop: 4 }}>
          {active.engine === "openai"
            ? "AI-powered analysis"
            : "Heuristic model (add OPENAI_API_KEY)"}{" "}
          · next in {nextSignalIn}s
        </div>
      </div>

      <div>
        <h2>AI Read — by time horizon</h2>

        {/* Three recommendations at a glance */}
        <div className="horizons">
          {signals.map((s) => {
            const c = recColor[s.recommendation];
            return (
              <button
                key={s.horizon}
                className={`horizon-card${s.horizon === selected ? " active" : ""}`}
                onClick={() => setSelected(s.horizon)}
                style={
                  s.horizon === selected
                    ? { borderColor: c, boxShadow: `0 0 0 1px ${c}` }
                    : undefined
                }
              >
                <div className="hz-top">
                  <span className="hz-label">{s.horizonLabel}</span>
                  <span className="hz-time">{s.timeframe}</span>
                </div>
                <div className="hz-rec" style={{ color: c }}>
                  {s.recommendation}
                </div>
                <div className="hz-meta">
                  <span>{s.averageScore.toFixed(1)}/10</span>
                  <span>{s.confidence}% conf</span>
                </div>
                <div className="hz-bar">
                  <span
                    style={{
                      width: `${(s.averageScore / 10) * 100}%`,
                      background: c,
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail for the selected horizon */}
        <div className="hz-detail">
          <div className="hz-detail-grid">
            <div className="gauge-wrap">
              <Gauge
                score={active.averageScore}
                recommendation={active.recommendation}
                color={color}
              />
              <div className="conf-row">
                <span>Confidence</span>
                <span style={{ color }}>{active.confidence}%</span>
              </div>
              <div className="conf-bar">
                <span
                  style={{ width: `${active.confidence}%`, background: color }}
                />
              </div>
            </div>

            <div className="hz-detail-text">
              <div className="hz-detail-head">
                <span className="hz-detail-title">
                  {active.horizonLabel}
                  <span className="hz-detail-time"> · {active.timeframe}</span>
                </span>
              </div>
              <p className="summary">{active.summary}</p>
              {active.tradeNote && (
                <p className="trade-note">
                  <span className="tn-label">Watch next</span> {active.tradeNote}
                </p>
              )}
              {active.keyRisks.length > 0 && (
                <div className="risks">
                  <span className="risks-label">Key risks</span>
                  <ul>
                    {active.keyRisks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <button
            className="factors-btn"
            onClick={() => setShowFactors(true)}
          >
            <span>View factor breakdown</span>
            <span className="factors-btn-meta">
              {active.factors.length} factors ·{" "}
              {active.horizonLabel.toLowerCase()}
            </span>
          </button>
        </div>
      </div>

      {showFactors && (
        <div
          className="modal-overlay"
          onClick={() => setShowFactors(false)}
          role="presentation"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-head">
              <div>
                <div className="modal-title">Factor Breakdown</div>
                <div className="modal-sub">
                  {active.horizonLabel} · {active.timeframe} ·{" "}
                  <span style={{ color }}>{active.recommendation}</span>{" "}
                  {active.averageScore.toFixed(1)}/10
                </div>
              </div>
              <button
                className="modal-close"
                onClick={() => setShowFactors(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="factors">
                {active.factors.map((f) => (
                  <div className="factor" key={f.id}>
                    <div className="top">
                      <span className="fname">
                        {f.label}
                        {f.value ? (
                          <span className="fval">{f.value}</span>
                        ) : null}
                      </span>
                      <span
                        className="fscore"
                        style={{ color: scoreColor(f.score) }}
                      >
                        {f.score.toFixed(1)}/10
                      </span>
                    </div>
                    <div className="fbar">
                      <span
                        style={{
                          width: `${(f.score / 10) * 100}%`,
                          background: scoreColor(f.score),
                        }}
                      />
                    </div>
                    <div className="reason">{f.rationale}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

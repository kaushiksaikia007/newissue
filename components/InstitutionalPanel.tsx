"use client";

import { useCallback, useState } from "react";
import { timeAgo } from "@/lib/format";
import { useAuth } from "./AuthProvider";

interface Category {
  id: string;
  title: string;
  score: number;
  points: number;
  signal: "Bullish" | "Bearish" | "Neutral";
  detail: string;
  available: boolean;
}
interface IntelReport {
  available: boolean;
  cmp: number;
  bullishProbability: number;
  verdict: "LONG" | "SHORT" | "HOLD";
  confidence: "Very High" | "High" | "Moderate" | "Low";
  regime: "Trending" | "Range-Bound" | "Volatile";
  categories: Category[];
  weights: Record<string, number>;
  buckets: Record<string, number>;
  reasons: string[];
  summary: string;
  engine: "openai" | "deterministic";
  fetchedAt: string;
}

const verdictColor: Record<string, string> = {
  LONG: "#1fae6a",
  SHORT: "#ff5252",
  HOLD: "#5aa9ff",
};
const signalColor: Record<string, string> = {
  Bullish: "var(--green)",
  Bearish: "var(--red)",
  Neutral: "var(--muted)",
};
const BUCKET_LABELS: Record<string, string> = {
  macro: "Macro",
  liquidity: "Liquidity",
  technical: "Technical",
  sentiment: "Sentiment",
  options: "Options",
  global: "Global",
};

export default function InstitutionalPanel({ endpoint }: { endpoint: string }) {
  const { requireAuth } = useAuth();
  const [data, setData] = useState<IntelReport | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!requireAuth()) return;
    setLoading(true);
    try {
      const res: IntelReport = await fetch(`${endpoint}?fresh=1`, {
        cache: "no-store",
      }).then((r) => r.json());
      setData(res);
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
    }
  }, [endpoint, requireAuth]);

  const vColor = data ? verdictColor[data.verdict] : "#5aa9ff";

  return (
    <section className="intel">
      <div className="intel-head">
        <div className="strat-title">
          <span className="strat-badge" style={{ background: "linear-gradient(135deg,#c7a3ff,#7a4fd0)", color: "#1a0f33" }}>
            II
          </span>
          Institutional Intelligence
          {data?.fetchedAt && (
            <span className="strat-when">analyzed {timeAgo(data.fetchedAt)}</span>
          )}
        </div>
        <button className="strat-go" onClick={run} disabled={loading}>
          {loading ? "Analyzing…" : data ? "↻ Re-run" : "Run analysis"}
        </button>
      </div>

      {!data ? (
        <div className="analyze-empty">
          {loading
            ? "Collecting FII/DII proxy, trend structure, volume, sector rotation, global markets, options & regime…"
            : "Run a full institutional-grade analysis: liquidity, trend, volume, sector rotation, global markets, options sentiment & market regime, fused into a weighted bullish probability."}
        </div>
      ) : !data.available ? (
        <div className="strat-empty">⚠️ {data.summary}</div>
      ) : (
        <>
          {/* Verdict header */}
          <div className="intel-verdict-row">
            <div className="intel-prob">
              <div className="intel-prob-ring" style={{ borderColor: vColor }}>
                <span className="intel-prob-num">{data.bullishProbability}%</span>
                <span className="intel-prob-cap">bullish</span>
              </div>
            </div>
            <div className="intel-verdict-main">
              <div className="intel-verdict" style={{ color: vColor }}>
                {data.verdict}
              </div>
              <div className="intel-verdict-sub">
                <span className="intel-chip">Confidence: {data.confidence}</span>
                <span className="intel-chip">Regime: {data.regime}</span>
                <span className="intel-chip">CMP {data.cmp}</span>
                <span className="intel-chip">
                  {data.engine === "openai" ? "AI reasoning" : "Quant model"}
                </span>
              </div>
            </div>
          </div>

          {/* Weighted contribution bars */}
          <div className="intel-buckets">
            {Object.entries(data.buckets).map(([k, v]) => (
              <div className="intel-bucket" key={k}>
                <div className="intel-bucket-top">
                  <span>{BUCKET_LABELS[k] ?? k}</span>
                  <span className="intel-bucket-w">
                    {Math.round((data.weights[k] ?? 0) * 100)}%
                  </span>
                </div>
                <div className="intel-bucket-bar">
                  <span
                    style={{
                      width: `${(v / 10) * 100}%`,
                      background:
                        v >= 6 ? "var(--green)" : v <= 4 ? "var(--red)" : "var(--blue)",
                    }}
                  />
                </div>
                <div className="intel-bucket-v">{v.toFixed(1)}/10</div>
              </div>
            ))}
          </div>

          {/* Reasons */}
          {data.summary && <p className="intel-summary">{data.summary}</p>}
          {data.reasons.length > 0 && (
            <div className="intel-reasons">
              <div className="intel-reasons-h">Why</div>
              <ul>
                {data.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Category breakdown */}
          <div className="intel-cats">
            {data.categories.map((c) => (
              <div className={`intel-cat${c.available ? "" : " na"}`} key={c.id}>
                <div className="intel-cat-top">
                  <span className="intel-cat-title">{c.title}</span>
                  <span
                    className="intel-cat-sig"
                    style={{ color: signalColor[c.signal] }}
                  >
                    {c.available ? c.signal : "N/A"}
                    {c.available && c.points !== 0 && (
                      <span className="intel-cat-pts">
                        {c.points > 0 ? `+${c.points}` : c.points}
                      </span>
                    )}
                  </span>
                </div>
                <div className="intel-cat-bar">
                  <span
                    style={{
                      width: `${(c.score / 10) * 100}%`,
                      background: signalColor[c.signal],
                    }}
                  />
                </div>
                <div className="intel-cat-detail">{c.detail}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

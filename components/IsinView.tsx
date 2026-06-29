"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useTab } from "./TabProvider";

interface Details {
  isin: string;
  found: boolean;
  error?: string;
  issuerName?: string;
  lei?: string;
  jurisdiction?: string;
  leiStatus?: string;
  fullName?: string;
  shortName?: string;
  cfiCode?: string;
  instrumentType?: string;
  instrumentCategory?: string;
  interestType?: string;
  notionalCurrency?: string;
  maturityDate?: string;
  tradingStart?: string;
  commodityDerivative?: boolean;
  competentAuthority?: string;
  venues: string[];
  status?: string;
  notes: string[];
}

interface Verdict {
  available: boolean;
  recommendation: string;
  confidence: string;
  summary: string;
  reasons: string[];
  risks: string[];
  engine: string;
}

interface Price {
  found: boolean;
  symbol?: string;
  exchange?: string;
  currency?: string;
  price?: number | null;
  change?: number;
  changePct?: number;
}

const recColor: Record<string, string> = {
  Invest: "#1fae6a",
  Avoid: "#ff5252",
  "Hold / Watch": "#5aa9ff",
  "Insufficient data": "var(--muted)",
};

const fmtDate = (d?: string) => {
  if (!d) return "—";
  const t = new Date(d);
  return Number.isNaN(t.getTime())
    ? d
    : t.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const fmtPrice = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function IsinView({ isin }: { isin: string }) {
  const { requireAuth } = useAuth();
  const { setIsinLabel } = useTab();
  const [data, setData] = useState<Details | null>(null);
  const [loading, setLoading] = useState(true);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [price, setPrice] = useState<Price | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPrice(null);
    fetch(`/api/isin?isin=${encodeURIComponent(isin)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Details) => {
        if (!active) return;
        setData(d);
        if (d.found) setIsinLabel(isin, d.shortName || d.issuerName || isin);
      })
      .catch(() => active && setData({ isin, found: false, venues: [], notes: [], error: "Lookup failed." }))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [isin, setIsinLabel]);

  // Live market price from TradingView, refreshed every second while the
  // instrument is resolved. Keeps the last good value so the figure updates in
  // place instead of flickering between renders.
  useEffect(() => {
    if (!data?.found) return;
    let active = true;
    const tick = async () => {
      try {
        const p: Price = await fetch(
          `/api/isin/price?isin=${encodeURIComponent(isin)}`,
          { cache: "no-store" },
        ).then((r) => r.json());
        // Only replace state on a fresh number; otherwise keep the last value
        // so the figure updates in place rather than blanking out.
        if (active && p.found && typeof p.price === "number") setPrice(p);
      } catch {
        /* keep last price */
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [isin, data?.found]);

  const analyze = useCallback(async () => {
    if (!requireAuth()) return;
    setAnalyzing(true);
    try {
      const v: Verdict = await fetch(`/api/isin/analyze?isin=${encodeURIComponent(isin)}`, {
        cache: "no-store",
      }).then((r) => r.json());
      setVerdict(v);
    } catch {
      /* ignore */
    } finally {
      setAnalyzing(false);
    }
  }, [isin, requireAuth]);

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">
          <div className="coin" style={{ background: "radial-gradient(circle at 30% 28%,#d8c4ff,#7a4fd0)", color: "#1a0f33" }}>
            🔖
          </div>
          <div>
            <h1>{data?.fullName || data?.shortName || isin}</h1>
            <p>ISIN {isin} · ESMA FIRDS + GLEIF reference data</p>
          </div>
        </div>

        {price?.found && typeof price.price === "number" && (
          <div className="isin-price">
            <span className="isin-price-val">
              {fmtPrice(price.price)}
              {price.currency ? <span className="isin-price-ccy"> {price.currency}</span> : null}
            </span>
            {typeof price.change === "number" && (
              <span
                className="isin-price-chg"
                style={{ color: price.change >= 0 ? "#1fae6a" : "#ff5252" }}
              >
                {price.change >= 0 ? "▲" : "▼"} {fmtPrice(Math.abs(price.change))}
                {typeof price.changePct === "number" &&
                  ` (${price.change >= 0 ? "+" : "−"}${Math.abs(price.changePct).toFixed(2)}%)`}
              </span>
            )}
            <span className="isin-price-src">● Live · {price.symbol} · TradingView</span>
          </div>
        )}
      </header>

      {loading ? (
        <div className="spin">Looking up {isin} in ESMA FIRDS…</div>
      ) : !data?.found ? (
        <div className="strat-empty">⚠️ {data?.error ?? "No data found for this ISIN."}</div>
      ) : (
        <>
          <div className="isin-grid">
            <Card title="Issuer">
              <Row k="Issuer / trading venue name" v={data.issuerName} />
              <Row k="LEI" v={data.lei} mono />
              <Row k="Jurisdiction" v={data.jurisdiction} />
              <Row k="LEI status (GLEIF)" v={data.leiStatus} />
            </Card>

            <Card title="Instrument — Issue data">
              <Row k="Notional currency" v={data.notionalCurrency} />
              <Row k="Interest type" v={data.interestType} />
              <Row k="Maturity / termination" v={fmtDate(data.maturityDate)} />
              <Row k="Trading start" v={fmtDate(data.tradingStart)} />
              <Row k="Interest rate" v="Not in FIRDS index" muted />
              <Row k="Total issued nominal" v="Not in FIRDS index" muted />
            </Card>

            <Card title="Instrument — Regulatory data">
              <Row k="Instrument full name" v={data.fullName} />
              <Row k="Classification (CFI)" v={data.cfiCode} mono />
              <Row k="Instrument type" v={data.instrumentType} />
              <Row k="Instrument category" v={data.instrumentCategory} />
              <Row
                k="Commodities derivative"
                v={data.commodityDerivative == null ? undefined : data.commodityDerivative ? "Yes" : "No"}
              />
              <Row k="Competent authority" v={data.competentAuthority} />
              <Row k="Status" v={data.status} />
            </Card>
          </div>

          {data.venues.length > 0 && (
            <>
              <div className="section-title">Trading venues ({data.venues.length})</div>
              <div className="isin-venues">
                {data.venues.map((m) => (
                  <span className="isin-venue" key={m}>{m}</span>
                ))}
              </div>
            </>
          )}

          {data.notes.length > 0 &&
            data.notes.map((n, i) => (
              <div className="isin-note" key={i}>ℹ️ {n}</div>
            ))}

          <div className="analyze-bar" style={{ marginTop: 16 }}>
            <div className="analyze-meta">
              <span className="analyze-title">Should you invest in this issue?</span>
              <span className="analyze-time">
                AI assessment from issuer, jurisdiction, type, interest, maturity & status
              </span>
            </div>
            <button className="analyze-btn" onClick={analyze} disabled={analyzing}>
              {analyzing ? "Analyzing…" : verdict ? "↻ Re-analyse" : "Analyse issue"}
            </button>
          </div>

          {verdict && verdict.available && (
            <div className="isin-verdict">
              <div className="isin-verdict-head">
                <span
                  className="isin-rec"
                  style={{ color: recColor[verdict.recommendation] ?? "var(--text)" }}
                >
                  {verdict.recommendation}
                </span>
                <span className="intel-chip">Confidence: {verdict.confidence}</span>
                <span className="intel-chip">
                  {verdict.engine === "openai" ? "AI analysis" : "Rule-based"}
                </span>
              </div>
              <p className="intel-summary">{verdict.summary}</p>
              {verdict.reasons.length > 0 && (
                <div className="intel-reasons">
                  <div className="intel-reasons-h">Reasons</div>
                  <ul>{verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}
              {verdict.risks.length > 0 && (
                <div className="intel-reasons">
                  <div className="intel-reasons-h" style={{ color: "var(--red)" }}>
                    Risks to check
                  </div>
                  <ul>{verdict.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          {verdict && !verdict.available && (
            <div className="strat-empty">⚠️ {verdict.summary}</div>
          )}
        </>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="isin-card">
      <div className="isin-card-h">{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v, mono, muted }: { k: string; v?: string; mono?: boolean; muted?: boolean }) {
  return (
    <div className="isin-row">
      <span className="isin-k">{k}</span>
      <span className={`isin-v${mono ? " mono" : ""}${muted || !v ? " na" : ""}`}>
        {v || "—"}
      </span>
    </div>
  );
}

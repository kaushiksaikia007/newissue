"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { GoldSignal, NewsItem, ValuesResponse } from "@/lib/types";
import type { InstrumentConfig } from "@/lib/instruments/config";
import { timeAgo } from "@/lib/format";
import MetricCard from "./MetricCard";
import SignalHero from "./SignalHero";
import NewsFeed from "./NewsFeed";
import StrategyPanel from "./StrategyPanel";
import BrainChat from "./BrainChat";
import { useAuth } from "./AuthProvider";

const VALUES_MS = 1_000; // live values: every second
const NEWS_MS = 60_000;
const MAX_POINTS = 240; // rolling chart buffer

const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString();
};

export default function Dashboard({ cfg }: { cfg: InstrumentConfig }) {
  const { requireAuth } = useAuth();
  const [values, setValues] = useState<ValuesResponse | null>(null);
  const [signals, setSignals] = useState<GoldSignal[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [history, setHistory] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [signalsAt, setSignalsAt] = useState<string | null>(null);
  const [signalLoading, setSignalLoading] = useState(false);
  const [alerts, setAlerts] = useState<boolean>(false);

  const prevRec = useRef<Record<string, string>>({});
  const alertsRef = useRef<boolean>(false);
  const alertStoreKey = `${cfg.alertKey}-alerts`;

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  const notify = useCallback(
    (from: string, to: string, s: GoldSignal) => {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      try {
        new Notification(
          `${cfg.notifName} · ${s.horizonLabel}: ${from} → ${to}`,
          {
            body: `New call: ${to} · ${s.averageScore.toFixed(1)}/10 · ${s.confidence}% confidence (${s.timeframe})`,
            icon: "/icon.svg",
            tag: `${cfg.alertKey}-rec-${s.horizon}`,
          },
        );
      } catch {
        /* notifications can throw if blocked */
      }
    },
    [cfg.notifName, cfg.alertKey],
  );

  const toggleAlerts = useCallback(async () => {
    if (alerts) {
      setAlerts(false);
      localStorage.setItem(alertStoreKey, "off");
      return;
    }
    if (typeof Notification === "undefined") {
      setError("This browser does not support notifications.");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm === "granted") {
      setAlerts(true);
      localStorage.setItem(alertStoreKey, "on");
      new Notification(`${cfg.notifName} alerts enabled`, {
        body: "You'll be notified whenever the recommendation changes.",
        icon: "/icon.svg",
      });
    } else {
      setError("Notifications are blocked in your browser settings.");
    }
  }, [alerts, alertStoreKey, cfg.notifName]);

  const loadValues = useCallback(async () => {
    try {
      const v: ValuesResponse = await fetch(cfg.endpoints.values, {
        cache: "no-store",
      }).then((r) => r.json());
      setValues(v);
      setError(null);
      if (v.gold && typeof v.gold.value === "number") {
        setHistory((h) => [...h, v.gold!.value].slice(-MAX_POINTS));
      }
    } catch {
      setError("Failed to load live values.");
    }
  }, [cfg.endpoints.values]);

  const loadSignal = useCallback(async () => {
    if (!requireAuth()) return;
    setSignalLoading(true);
    setError(null);
    try {
      const res = await fetch(`${cfg.endpoints.signal}?fresh=1`, {
        cache: "no-store",
      }).then((r) => r.json());
      const list: GoldSignal[] = res.signals ?? [];
      for (const s of list) {
        const prev = prevRec.current[s.horizon];
        if (prev && prev !== s.recommendation && alertsRef.current) {
          notify(prev, s.recommendation, s);
        }
        prevRec.current[s.horizon] = s.recommendation;
      }
      if (list.length) {
        setSignals(list);
        setSignalsAt(res.fetchedAt ?? new Date().toISOString());
      }
    } catch {
      setError("Analysis failed — please try again.");
    } finally {
      setSignalLoading(false);
    }
  }, [cfg.endpoints.signal, notify, requireAuth]);

  const loadNews = useCallback(async () => {
    try {
      const n = await fetch(cfg.endpoints.news, { cache: "no-store" }).then(
        (r) => r.json(),
      );
      setNews(n.items ?? []);
    } catch {
      /* keep previous news */
    }
  }, [cfg.endpoints.news]);

  useEffect(() => {
    // Reset state when switching instruments. Recommendation is manual now —
    // it only runs when the user clicks "Analyze".
    setValues(null);
    setSignals([]);
    setSignalsAt(null);
    setHistory([]);
    prevRec.current = {};

    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      localStorage.getItem(alertStoreKey) === "on"
    ) {
      setAlerts(true);
    }

    loadValues();
    loadNews();
    const v = setInterval(loadValues, VALUES_MS);
    const n = setInterval(loadNews, NEWS_MS);
    return () => {
      clearInterval(v);
      clearInterval(n);
    };
  }, [loadValues, loadNews, alertStoreKey]);

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">
          <div className={`coin ${cfg.coinClass ?? ""}`}>{cfg.coinText}</div>
          <div>
            <h1>{cfg.title}</h1>
            <p>{cfg.subtitle}</p>
          </div>
        </div>
        <div className="status">
          <div className="status-actions">
            <Link
              href="/paper"
              className="topbar-btn"
              onClick={(e) => {
                if (!requireAuth()) e.preventDefault();
              }}
            >
              💹 Paper Trading
            </Link>
            <button
              className={`alert-btn${alerts ? " on" : ""}`}
              onClick={toggleAlerts}
              title="Notify me when the recommendation changes"
            >
              {alerts ? "🔔 Alerts on" : "🔕 Enable alerts"}
            </button>
          </div>
          {values ? (
            <>
              <span
                className={`badge ${values.usingMockData ? "mock" : "live"}`}
              >
                {values.usingMockData ? "Demo Data" : "● Live"}
              </span>
              <div style={{ marginTop: 6 }}>Live prices stream every second</div>
            </>
          ) : (
            <span className="badge mock">Loading…</span>
          )}
        </div>
      </header>

      {error && <div className="spin">{error}</div>}

      {!values ? (
        <div className="spin">Loading live data…</div>
      ) : (
        <>
          <div className="analyze-bar">
            <div className="analyze-meta">
              <span className="analyze-title">AI Market Recommendation</span>
              <span className="analyze-time">
                {signalsAt
                  ? `Last analyzed ${timeAgo(signalsAt)} · ${clock(signalsAt)}`
                  : "Not analyzed yet — run a fresh analysis"}
              </span>
            </div>
            <button
              className="analyze-btn"
              onClick={loadSignal}
              disabled={signalLoading}
            >
              {signalLoading
                ? "Analyzing…"
                : signals.length
                  ? "↻ Re-analyze"
                  : "Analyze market"}
            </button>
          </div>

          {signals.length > 0 && <ConsensusBanner signals={signals} />}

          {signals.length ? (
            <SignalHero
              signals={signals}
              gold={values.gold}
              history={history}
              priceLabel={cfg.priceLabel}
              priceSuffix={cfg.priceSuffix}
            />
          ) : (
            <div className="analyze-empty">
              {signalLoading
                ? "Running a deep multi-horizon analysis…"
                : "Click “Analyze market” for the latest AI recommendation across all three time horizons."}
            </div>
          )}

          {cfg.strategyEndpoint && (
            <StrategyPanel endpoint={cfg.strategyEndpoint} />
          )}

          <div className="section-title">Live Indicators</div>
          <div className="grid">
            {values.metrics.map((m) => (
              <MetricCard key={m.id} m={m} />
            ))}
          </div>

          <div className="section-title">{cfg.newsTitle}</div>
          <NewsFeed items={news} />

          {values.usingMockData && (
            <div className="footer">
              <strong>Showing demo data.</strong> Add your API keys to
              <code> .env.local</code> and restart to stream live values.
            </div>
          )}

          <div className="footer">
            Recommendations are generated by an AI model that scores each factor
            0–10 and averages them into a Strong Sell → Strong Buy call across
            three time horizons, refreshed every 60 seconds. For research and
            educational use only — not financial advice.
          </div>
        </>
      )}

      {cfg.brainId && <BrainChat instrument={cfg.brainId} label={cfg.title} />}
    </div>
  );
}

const recColor: Record<string, string> = {
  "Strong Buy": "#1fae6a",
  Buy: "#38d39f",
  Hold: "#5aa9ff",
  Sell: "#ff8f6b",
  "Strong Sell": "#ff5252",
};

function ConsensusBanner({ signals }: { signals: GoldSignal[] }) {
  const recs = signals.map((s) => s.recommendation);
  const allAgree = recs.every((r) => r === recs[0]);
  const avg =
    signals.reduce((a, s) => a + s.averageScore, 0) / (signals.length || 1);

  if (allAgree) {
    const color = recColor[recs[0]] ?? "#5aa9ff";
    return (
      <div className="consensus" style={{ borderColor: color }}>
        <span className="consensus-dot" style={{ background: color }} />
        <span className="consensus-text">
          All horizons agree — <strong style={{ color }}>{recs[0]}</strong>
        </span>
        <span className="consensus-sub">avg {avg.toFixed(1)}/10</span>
      </div>
    );
  }

  return (
    <div className="consensus mixed">
      <span className="consensus-text">Mixed outlook across horizons</span>
      <span className="consensus-pills">
        {signals.map((s) => (
          <span
            key={s.horizon}
            className="consensus-pill"
            style={{ color: recColor[s.recommendation] }}
          >
            {s.horizonLabel}: {s.recommendation}
          </span>
        ))}
      </span>
    </div>
  );
}

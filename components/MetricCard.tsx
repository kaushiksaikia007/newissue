"use client";

import { useEffect, useRef, useState } from "react";
import type { Metric } from "@/lib/types";
import { formatChange, formatValue } from "@/lib/format";

const trendColor: Record<string, string> = {
  up: "var(--green)",
  down: "var(--red)",
  flat: "var(--muted)",
};

const icons: Record<string, string> = {
  dxy: "💵",
  us10y: "🏛️",
  fed: "🏦",
  cpi: "🛒",
  nfp: "👷",
  vix: "🌪️",
  gold: "🪙",
  nifty: "📈",
  banknifty: "🏦",
  indiavix: "🌪️",
  usdinr: "💱",
  in10y: "🏛️",
  repo: "🏦",
  inflation: "🛒",
  breadth: "📊",
  rsi: "📉",
};

export default function MetricCard({ m }: { m: Metric }) {
  // For yields/dollar a rise is "red" for gold, but here the card just shows
  // the raw move; gold interpretation lives in the signal panel.
  const color = trendColor[m.trend];
  const arrow = m.trend === "up" ? "▲" : m.trend === "down" ? "▼" : "•";

  // Flash green/red whenever the live value changes.
  const prev = useRef<number>(m.value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (m.value !== prev.current) {
      setFlash(m.value > prev.current ? "up" : "down");
      prev.current = m.value;
      const id = setTimeout(() => setFlash(null), 700);
      return () => clearTimeout(id);
    }
  }, [m.value]);

  return (
    <div className={`card${flash ? ` flash-${flash}` : ""}`}>
      <div className="label">
        <span className="label-name">
          <span className="metric-icon">{icons[m.id] ?? "📊"}</span>
          {m.label}
        </span>
        <span style={{ color }}>{arrow}</span>
      </div>
      <div className={`value${flash ? ` v-${flash}` : ""}`}>
        {formatValue(m)}
      </div>
      <div className="meta">
        <span className="chg" style={{ color }}>
          {formatChange(m)}
        </span>
      </div>
    </div>
  );
}

import type { Metric } from "./types";

export function formatValue(m: Metric): string {
  const decimals =
    m.unit === "%" ||
    m.unit === "usd" ||
    m.unit === "pts" ||
    m.unit === "fx" ||
    m.unit === "rsi"
      ? 2
      : m.unit === "k jobs"
        ? 0
        : m.value > 1000
          ? 1
          : 2;
  const n = m.value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (m.unit === "%") return `${n}%`;
  if (m.unit === "k jobs") return `${n}k`;
  if (m.unit === "usd") return `$${n}`;
  return n;
}

export function formatChange(m: Metric): string {
  if (m.change == null) return "—";
  const sign = m.change >= 0 ? "+" : "";
  if (m.unit === "%") return `${sign}${m.change.toFixed(2)} pp`;
  if (m.changePct != null) return `${sign}${m.changePct.toFixed(2)}%`;
  return `${sign}${m.change.toFixed(2)}`;
}

export function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return iso;
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

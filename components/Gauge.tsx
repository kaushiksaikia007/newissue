"use client";

const SEGMENTS = [
  { from: 0, to: 2, color: "#ff5252" }, // Strong Sell
  { from: 2, to: 4, color: "#ff8f6b" }, // Sell
  { from: 4, to: 6, color: "#5aa9ff" }, // Hold
  { from: 6, to: 8, color: "#38d39f" }, // Buy
  { from: 8, to: 10, color: "#1fae6a" }, // Strong Buy
];

const W = 240;
const H = 142;
const CX = W / 2;
const CY = 132;
const R = 100;

// Score 0 -> 180deg (left), score 10 -> 0deg (right).
function angle(score: number): number {
  return ((180 - (score / 10) * 180) * Math.PI) / 180;
}
function point(score: number, r: number): [number, number] {
  const a = angle(score);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}
function segPath(from: number, to: number, r: number): string {
  const steps = 16;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const s = from + ((to - from) * i) / steps;
    const [x, y] = point(s, r);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
}

export default function Gauge({
  score,
  recommendation,
  color,
}: {
  score: number;
  recommendation: string;
  color: string;
}) {
  const clamped = Math.max(0, Math.min(10, score));
  const [nx, ny] = point(clamped, R - 16);

  return (
    <svg
      className="gauge-svg"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* track */}
      <path
        d={segPath(0, 10, R)}
        fill="none"
        stroke="#0a0d13"
        strokeWidth="18"
        strokeLinecap="round"
      />
      {/* colored segments */}
      {SEGMENTS.map((s) => (
        <path
          key={s.from}
          d={segPath(s.from + 0.04, s.to - 0.04, R)}
          fill="none"
          stroke={s.color}
          strokeWidth="14"
          strokeLinecap="butt"
          opacity={0.92}
        />
      ))}
      {/* needle */}
      <line
        x1={CX}
        y1={CY}
        x2={nx}
        y2={ny}
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx={CX} cy={CY} r="7" fill={color} />
      <circle cx={CX} cy={CY} r="3" fill="#0b0e14" />
      {/* labels */}
      <text x={point(0, R)[0] - 2} y={CY + 16} className="gauge-end">
        Sell
      </text>
      <text x={point(10, R)[0] + 2} y={CY + 16} className="gauge-end gauge-end-r">
        Buy
      </text>
      <text x={CX} y={CY - 30} className="gauge-rec" fill={color}>
        {recommendation}
      </text>
      <text x={CX} y={CY - 8} className="gauge-score">
        {clamped.toFixed(1)}/10
      </text>
    </svg>
  );
}

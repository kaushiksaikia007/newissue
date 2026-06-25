"use client";

export default function Sparkline({
  points,
  width = 168,
  height = 44,
}: {
  points: number[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) {
    return <div className="sparkline-empty">building chart…</div>;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);

  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p - min) / span) * height;
    return [x, y] as const;
  });

  const path = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  const up = points[points.length - 1] >= points[0];
  const stroke = up ? "var(--green)" : "var(--red)";
  const [lastX, lastY] = coords[coords.length - 1];
  const areaPath = `${path} L${width},${height} L0,${height} Z`;
  const gid = up ? "spark-up" : "spark-down";

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gid})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.6" />
      <circle cx={lastX} cy={lastY} r="2.4" fill={stroke} />
    </svg>
  );
}

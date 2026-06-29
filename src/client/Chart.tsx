// Dependency-free gradient area chart. pathLength={1} lets CSS animate the
// reveal with a normalized stroke-dashoffset (no runtime measurement).
export function AreaChart({ points, height = 76 }: { points: number[]; height?: number }) {
  if (points.length < 2) {
    return <div className="chart-empty">— not enough data yet —</div>;
  }
  const width = 320;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 5;
  const n = points.length;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (n - 1);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / span);
  const line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${height} L${x(0).toFixed(1)} ${height} Z`;
  const lastX = x(n - 1);
  const lastY = y(points[n - 1]);
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="trend">
      <defs>
        <linearGradient id="strokeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--info)" />
          <stop offset="100%" stopColor="var(--good)" />
        </linearGradient>
        <linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--good)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--good)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="chart-area" d={area} fill="url(#fillGrad)" />
      <path
        className="chart-line"
        d={line}
        fill="none"
        stroke="url(#strokeGrad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
      <circle className="chart-dot" cx={lastX} cy={lastY} r="3.5" fill="var(--good)" />
    </svg>
  );
}

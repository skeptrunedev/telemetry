import { useEffect, useRef, useState } from "react";

// Dependency-free area chart. pathLength={1} lets CSS animate the
// reveal with a normalized stroke-dashoffset (no runtime measurement).
// Mouse hover / touch scrub snaps to the nearest reading and shows a
// small tooltip (value + date) with a dot and vertical guide line.

const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function AreaChart({
  points,
  timestamps,
  unit = "lb",
  height = 76,
}: {
  points: number[];
  timestamps?: number[];
  unit?: string;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef(0);
  const [idx, setIdx] = useState(0); // last scrubbed point (kept during fade-out)
  const [active, setActive] = useState(false);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

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

  const scrub = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const xv = ((clientX - rect.left) / rect.width) * width;
    const i = Math.round((xv - pad) / ((width - pad * 2) / (n - 1)));
    window.clearTimeout(hideTimer.current);
    setIdx(Math.max(0, Math.min(n - 1, i)));
    setActive(true);
  };
  const hide = (delayMs: number) => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setActive(false), delayMs);
  };

  const ci = Math.min(idx, n - 1); // clamp in case the series shrank
  const hx = x(ci);
  const hy = y(points[ci]);
  const fx = hx / width;
  const tipX = fx < 0.14 ? "-8%" : fx > 0.86 ? "-92%" : "-50%";
  const tipY = hy / height < 0.45 ? "12px" : "calc(-100% - 12px)";
  const ts = timestamps ? timestamps[ci] : undefined;

  return (
    <div
      ref={wrapRef}
      className="chart-wrap"
      onMouseMove={(e) => scrub(e.clientX)}
      onMouseLeave={() => hide(0)}
      onTouchStart={(e) => scrub(e.touches[0].clientX)}
      onTouchMove={(e) => scrub(e.touches[0].clientX)}
      onTouchEnd={() => hide(700)}
      onTouchCancel={() => hide(0)}
    >
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="trend">
        <path className="chart-area" d={area} fill="var(--accent)" fillOpacity="0.1" />
        <path
          className="chart-line"
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
        />
        <circle className="chart-dot" cx={lastX} cy={lastY} r="3.5" fill="var(--accent)" />
        <line
          className={`chart-guide${active ? " on" : ""}`}
          x1="0"
          x2="0"
          y1={pad}
          y2={height}
          stroke="var(--hover-line)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          style={{ transform: `translateX(${hx}px)` }}
        />
        <circle
          className={`chart-hover-dot${active ? " on" : ""}`}
          cx="0"
          cy="0"
          r="3.5"
          fill="var(--accent)"
          stroke="var(--surface)"
          strokeWidth="1.5"
          style={{ transform: `translate(${hx}px, ${hy}px)` }}
        />
      </svg>
      <div
        className={`chart-tip${active ? " on" : ""}`}
        style={{
          left: `${fx * 100}%`,
          top: `${(hy / height) * 100}%`,
          transform: `translate(${tipX}, 0) translateY(${tipY})`,
        }}
        aria-hidden="true"
      >
        <span className="chart-tip-val">
          {points[ci].toFixed(1)} {unit}
        </span>
        {ts != null && <span className="chart-tip-date">{fmtDate(ts)}</span>}
      </div>
    </div>
  );
}

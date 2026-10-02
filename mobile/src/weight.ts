import type { Palette } from "./theme";
import { kgToLb } from "./api";

const DAY = 86_400_000;

// Week-over-week change and the status pill, the same rules as the web
// dashboard's weight hero (src/client/Dashboard.tsx).
export function weeklyDeltaLb(trend: { ts: number; kg: number }[]): number | null {
  if (trend.length < 2) return null;
  const cut = trend[trend.length - 1].ts - 7 * DAY;
  const win = trend.filter((p) => p.ts >= cut);
  const series = win.length >= 2 ? win : trend;
  return kgToLb(series[series.length - 1].kg) - kgToLb(series[0].kg);
}

export function weightInsight(
  latestLb: number | null,
  delta: number | null,
  c: Palette,
): { head: string; status: { label: string; color: string } | null } {
  if (latestLb == null) return { head: "Log your first weigh-in", status: null };
  if (delta == null) return { head: "Tracking started — keep logging", status: { label: "NEW", color: c.info } };
  if (delta < -0.1) return { head: `Down ${Math.abs(delta).toFixed(1)} lb this week`, status: { label: "ON TRACK", color: c.amberText } };
  if (delta > 0.1) return { head: `Up ${delta.toFixed(1)} lb this week`, status: { label: "WATCH TREND", color: c.attention } };
  return { head: "Holding steady this week", status: { label: "STEADY", color: c.info } };
}

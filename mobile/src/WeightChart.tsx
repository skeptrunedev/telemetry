import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import { makeStyles, useTheme } from "./theme";
import { kgToLb } from "./api";

// Scale readings swing a couple of pounds a day, so the raw line is plotted
// thin and muted underneath a 7-day exponential moving average, which is the
// line worth reading a direction from. Mirrors the web chart.
const TREND_WINDOW = 7;
function emaSeries(values: number[]): number[] {
  const alpha = 2 / (TREND_WINDOW + 1);
  const out: number[] = [];
  let acc = 0;
  for (const v of values) {
    acc = out.length === 0 ? v : alpha * v + (1 - alpha) * acc;
    out.push(acc);
  }
  return out;
}

/**
 * Weight trend, oldest point first. Drawn in the card's measured pixel width
 * (not a fixed viewBox) so it fills a wide landscape card instead of
 * letterboxing inside it, with strokes that stay round.
 */
export function WeightChart({ trend, height = 110 }: { trend: { ts: number; kg: number }[]; height?: number }) {
  const { c } = useTheme();
  const s = useS();
  const [W, setW] = useState(0);
  const H = height;
  if (trend.length < 2) return <View style={{ height: H }} />;
  const xs = trend.map((p) => p.ts);
  const ys = trend.map((p) => kgToLb(p.kg));
  const smooth = emaSeries(ys);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys, ...smooth) - 0.4, y1 = Math.max(...ys, ...smooth) + 0.4;
  // 2px inset keeps the 2.5px trend stroke from clipping at the edges.
  const px = (t: number) => 2 + ((t - x0) / (x1 - x0 || 1)) * (W - 4);
  const py = (v: number) => 2 + (H - 4) - ((v - y0) / (y1 - y0 || 1)) * (H - 4);
  const toPath = (vals: number[]) =>
    vals.map((v, i) => `${i ? "L" : "M"} ${px(xs[i]).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const scalePath = toPath(ys);
  const trendPath = toPath(smooth);
  const area = `${trendPath} L ${px(x1).toFixed(1)} ${H} L ${px(x0).toFixed(1)} ${H} Z`;
  return (
    <>
      <View style={{ height: H }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
        {W > 0 && (
          <Svg width={W} height={H}>
            <Path d={area} fill={c.amber} opacity={0.16} />
            <Path d={scalePath} stroke={c.muted} strokeWidth={1} opacity={0.55} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            <Path d={trendPath} stroke={c.amber} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          </Svg>
        )}
      </View>
      <View style={s.legend}>
        <View style={[s.legendSwatch, { backgroundColor: c.amber, height: 2 }]} />
        <Text style={s.legendText}>TREND</Text>
        <View style={[s.legendSwatch, { backgroundColor: c.muted, height: 1, opacity: 0.7 }]} />
        <Text style={s.legendText}>SCALE</Text>
      </View>
    </>
  );
}

const useS = makeStyles((c) =>
  StyleSheet.create({
    legend: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
    legendSwatch: { width: 14 },
    legendText: { fontFamily: "monospace", fontSize: 9, letterSpacing: 1, color: c.muted, marginRight: 8 },
  }),
);

import { describe, expect, it } from "vitest";
import { summarizeWeightHistory, type WeightRow } from "../src/worker/weight-history";

const LB_PER_KG = 2.2046226218;
const day = (iso: string, hourUtc = 15) => new Date(`${iso}T${String(hourUtc).padStart(2, "0")}:00:00Z`);
const lb = (pounds: number) => pounds / LB_PER_KG;
const row = (ts: Date, pounds: number): WeightRow => ({ ts, weightKg: lb(pounds), bodyFatPct: null, note: null });

// 8 weeks losing exactly 1 lb/week, weighed daily, with ±1.5 lb of water noise.
const rows: WeightRow[] = [];
for (let i = 0; i < 56; i++) {
  const ts = new Date(day("2026-08-01").getTime() + i * 86_400_000);
  rows.push(row(ts, 200 - i / 7 + (i % 2 ? 1.5 : -1.5)));
}

describe("summarizeWeightHistory", () => {
  it("reports the first weigh-in and a lb/week trend robust to daily noise", () => {
    const h = summarizeWeightHistory(rows, null, "2026-09-30", 420);
    if (!("first" in h)) throw new Error("expected history");
    expect(h.count).toBe(56);
    expect(h.first).toEqual({ date: "2026-08-01", pounds: 198.5 });
    expect(h.trendPoundsPerWeek).toBe(-1);
    expect(h.weeklyAverages[0].weekOf).toBe("2026-07-27");
    expect(h.readingsAreDailyAverages).toBe(false);
  });

  it("filters to a range of local days", () => {
    const h = summarizeWeightHistory(rows, "2026-09-01", "2026-09-07", 420);
    if (!("first" in h)) throw new Error("expected history");
    expect(h.count).toBe(7);
    expect(h.first.date).toBe("2026-09-01");
    expect(h.latest.date).toBe("2026-09-07");
  });

  it("uses the user's local day, not UTC", () => {
    // 02:00 UTC on Sep 2 is still Sep 1 in Los Angeles (UTC-7).
    const h = summarizeWeightHistory([row(day("2026-09-02", 2), 180)], null, "2026-09-30", 420);
    if (!("first" in h)) throw new Error("expected history");
    expect(h.first.date).toBe("2026-09-01");
    expect(h.trendPoundsPerWeek).toBeNull();
  });

  it("averages per day when there are too many readings", () => {
    const many: WeightRow[] = [];
    for (let i = 0; i < 150; i++) {
      const ts = new Date(day("2026-06-01").getTime() + i * 86_400_000);
      many.push(row(ts, 190), row(new Date(ts.getTime() + 3_600_000), 192));
    }
    const h = summarizeWeightHistory(many, null, "2026-12-31", 0);
    if (!("readings" in h)) throw new Error("expected history");
    expect(h.readingsAreDailyAverages).toBe(true);
    expect(h.readings.length).toBe(120);
    expect(h.readings[0]).toMatchObject({ pounds: 191, weighIns: 2 });
  });

  it("says when there is nothing to report", () => {
    expect(summarizeWeightHistory([], null, "2026-09-30", 0)).toEqual({ count: 0, message: "no weigh-ins logged yet" });
    expect(summarizeWeightHistory(rows, "2027-01-01", "2027-01-31", 0)).toEqual({ count: 0, message: "no weigh-ins in that range" });
  });
});

import { describe, expect, it } from "vitest";
import {
  isValidTimeZone,
  localDayInTz,
  nextFireAt,
  offsetMinutesToTz,
  parseDays,
  tzOffsetMinutes,
  zonedTimeToUtc,
} from "../src/worker/reminders";
import { workerFetch } from "./harness";

// ---- pure scheduling math (no worker involved) ------------------------------

const CHI = "America/Chicago"; // UTC-5 in July (CDT), UTC-6 in January (CST)

describe("reminders: timezone helpers", () => {
  it("tzOffsetMinutes reads the zone's offset at the instant (DST-aware)", () => {
    expect(tzOffsetMinutes(CHI, new Date("2026-07-08T12:00:00Z"))).toBe(-300); // CDT
    expect(tzOffsetMinutes(CHI, new Date("2026-01-08T12:00:00Z"))).toBe(-360); // CST
    expect(tzOffsetMinutes("UTC", new Date("2026-07-08T12:00:00Z"))).toBe(0);
    expect(tzOffsetMinutes("Etc/GMT+5", new Date("2026-01-08T12:00:00Z"))).toBe(-300); // fixed year-round
  });

  it("zonedTimeToUtc maps local wall time to the right UTC instant across DST", () => {
    expect(zonedTimeToUtc(2026, 7, 8, 12, 0, CHI)).toBe(Date.parse("2026-07-08T17:00:00Z"));
    expect(zonedTimeToUtc(2026, 1, 8, 8, 0, CHI)).toBe(Date.parse("2026-01-08T14:00:00Z"));
  });

  it("localDayInTz gives the zone's calendar day", () => {
    // 03:00 UTC on the 9th is still the evening of the 8th in Chicago.
    expect(localDayInTz(CHI, new Date("2026-07-09T03:00:00Z"))).toBe("2026-07-08");
    expect(localDayInTz("UTC", new Date("2026-07-09T03:00:00Z"))).toBe("2026-07-09");
  });

  it("isValidTimeZone accepts IANA zones and rejects junk", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Etc/GMT+5")).toBe(true);
    expect(isValidTimeZone("Central Time")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("offsetMinutesToTz maps whole-hour getTimezoneOffset values (inverted Etc sign)", () => {
    expect(offsetMinutesToTz(300)).toBe("Etc/GMT+5"); // UTC-5
    expect(offsetMinutesToTz(0)).toBe("Etc/GMT");
    expect(offsetMinutesToTz(-60)).toBe("Etc/GMT-1"); // UTC+1
    expect(offsetMinutesToTz(90)).toBeNull(); // half-hour zones don't map
  });
});

describe("reminders: parseDays", () => {
  it("expands the keywords", () => {
    expect(parseDays("daily")).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parseDays("weekdays")).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays("weekends")).toEqual([0, 6]);
  });
  it("parses comma lists (3-letter prefixes, deduped, sorted)", () => {
    expect(parseDays("mon,wed,fri")).toEqual([1, 3, 5]);
    expect(parseDays("Friday, Monday, monday")).toEqual([1, 5]);
  });
  it("rejects junk", () => {
    expect(parseDays("noday")).toBeNull();
    expect(parseDays("mon,xyz")).toBeNull();
  });
});

describe("reminders: nextFireAt", () => {
  const base = { hour: 12, minute: 0, days: "daily", onceDate: null, tz: CHI };

  it("fires later the same local day when the time is still ahead", () => {
    // 10:00 in Chicago on Wed 2026-07-08.
    const from = new Date("2026-07-08T15:00:00Z");
    expect(nextFireAt(base, from)).toBe(Date.parse("2026-07-08T17:00:00Z"));
  });

  it("rolls to the next day once the time has passed", () => {
    // 13:30 in Chicago.
    const from = new Date("2026-07-08T18:30:00Z");
    expect(nextFireAt(base, from)).toBe(Date.parse("2026-07-09T17:00:00Z"));
  });

  it("weekdays: a Friday evening rolls to Monday", () => {
    // Fri 2026-07-10 18:00 Chicago.
    const from = new Date("2026-07-10T23:00:00Z");
    const r = { ...base, days: "weekdays" };
    expect(nextFireAt(r, from)).toBe(Date.parse("2026-07-13T17:00:00Z")); // Mon 12:00 CDT
  });

  it("comma-list days pick the next matching weekday", () => {
    // Wed 2026-07-08 13:00 Chicago, spec mon,wed,fri at 12:00 → Fri.
    const from = new Date("2026-07-08T18:00:00Z");
    const r = { ...base, days: "mon,wed,fri" };
    expect(nextFireAt(r, from)).toBe(Date.parse("2026-07-10T17:00:00Z"));
  });

  it("one-offs fire at their instant and never after", () => {
    const r = { ...base, onceDate: "2026-07-09" };
    expect(nextFireAt(r, new Date("2026-07-08T00:00:00Z"))).toBe(Date.parse("2026-07-09T17:00:00Z"));
    expect(nextFireAt(r, new Date("2026-07-09T17:00:00Z"))).toBeNull(); // exactly at ⇒ past
    expect(nextFireAt(r, new Date("2026-07-10T00:00:00Z"))).toBeNull();
  });

  it("stays on local wall time across the DST switch", () => {
    // US DST ends Sun 2026-11-01 (02:00 CDT → 01:00 CST). An 08:00 reminder
    // evaluated Saturday afternoon must land at 08:00 CST (14:00 UTC), not
    // 13:00 UTC (which would be 07:00 local).
    const r = { ...base, hour: 8 };
    const from = new Date("2026-10-31T20:00:00Z");
    expect(nextFireAt(r, from)).toBe(Date.parse("2026-11-01T14:00:00Z"));
  });
});

// ---- REST routes through the real worker ------------------------------------

function asUser(email: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", email);
  return workerFetch(path, { ...init, headers });
}

function jsonReq(email: string, path: string, body: unknown, method = "POST") {
  return asUser(email, path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("reminders: REST", () => {
  const user = "reminders-user@example.com";

  it("POST creates with the default timezone flagged, GET lists it, DELETE removes it", async () => {
    const post = await jsonReq(user, "/api/reminders", { instruction: "remind me to log lunch", time: "12:00", days: "weekdays" });
    expect(post.status).toBe(200);
    const created = (await post.json()) as {
      ok: boolean;
      tzDefaulted: boolean;
      phoneLinked: boolean;
      reminder: { id: string; time: string; days: string; tz: string; enabled: boolean; nextFireAt: number };
    };
    expect(created.ok).toBe(true);
    expect(created.reminder.time).toBe("12:00");
    expect(created.reminder.days).toBe("weekdays");
    expect(created.reminder.tz).toBe("America/Chicago"); // nothing stored anywhere ⇒ default
    expect(created.tzDefaulted).toBe(true);
    expect(created.phoneLinked).toBe(false); // no verified phone channel
    expect(created.reminder.nextFireAt).toBeGreaterThan(Date.now());

    const list = await asUser(user, "/api/reminders");
    expect(list.status).toBe(200);
    const body = (await list.json()) as { reminders: { id: string }[]; phoneLinked: boolean };
    expect(body.reminders.some((r) => r.id === created.reminder.id)).toBe(true);

    const del = await asUser(user, `/api/reminders/${created.reminder.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = (await (await asUser(user, "/api/reminders")).json()) as { reminders: { id: string }[] };
    expect(after.reminders.some((r) => r.id === created.reminder.id)).toBe(false);
  });

  it("a later reminder reuses the account's stored timezone instead of the default", async () => {
    const u = "reminders-tz@example.com";
    const first = await jsonReq(u, "/api/reminders", { instruction: "weigh in", time: "07:30", tz: "America/New_York" });
    expect(((await first.json()) as { reminder: { tz: string } }).reminder.tz).toBe("America/New_York");
    const second = await jsonReq(u, "/api/reminders", { instruction: "log dinner", time: "19:00" });
    const body = (await second.json()) as { reminder: { tz: string }; tzDefaulted: boolean };
    expect(body.reminder.tz).toBe("America/New_York");
    expect(body.tzDefaulted).toBe(false);
  });

  it("rejects bad input", async () => {
    expect((await jsonReq(user, "/api/reminders", { instruction: "x", time: "25:00" })).status).toBe(400);
    expect((await jsonReq(user, "/api/reminders", { instruction: "x", time: "12:00", days: "someday" })).status).toBe(400);
    expect((await jsonReq(user, "/api/reminders", { time: "12:00" })).status).toBe(400);
    expect((await jsonReq(user, "/api/reminders", { instruction: "x", time: "12:00", once_date: "2020-01-01" })).status).toBe(400);
  });

  it("caps enabled reminders at 10 and PATCH toggles enabled", async () => {
    const u = "reminders-cap@example.com";
    let lastId = "";
    for (let i = 0; i < 10; i++) {
      const res = await jsonReq(u, "/api/reminders", { instruction: `r${i}`, time: "09:00" });
      expect(res.status).toBe(200);
      lastId = ((await res.json()) as { reminder: { id: string } }).reminder.id;
    }
    const over = await jsonReq(u, "/api/reminders", { instruction: "one too many", time: "09:00" });
    expect(over.status).toBe(400);

    const off = await jsonReq(u, `/api/reminders/${lastId}`, { enabled: false }, "PATCH");
    expect(off.status).toBe(200);
    const eleventh = await jsonReq(u, "/api/reminders", { instruction: "fits now", time: "09:00" });
    expect(eleventh.status).toBe(200);
    const backOn = await jsonReq(u, `/api/reminders/${lastId}`, { enabled: true }, "PATCH");
    expect(backOn.status).toBe(400); // would exceed the cap again
  });
});

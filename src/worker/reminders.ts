// Timezone-aware scheduling for agentic reminders.
//
// A reminder stores a LOCAL wall-clock time (hour:minute) in an IANA timezone
// plus a day spec ('daily' | 'weekdays' | 'weekends' | 'mon,wed,fri' | a
// one-off YYYY-MM-DD). nextFireAt() resolves the next UTC instant that wall
// time occurs, using Intl.DateTimeFormat to read the zone's offset at the
// candidate instant (two-pass, so a candidate that lands across a DST switch
// is corrected — good enough at a 15-minute cron granularity).

export type ReminderSchedule = {
  hour: number;
  minute: number;
  days: string;
  onceDate: string | null; // YYYY-MM-DD ⇒ one-off; fired one-offs disable themselves
  tz: string; // IANA, e.g. "America/Chicago"
};

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 'daily'/'weekdays'/'weekends'/'mon,wed,fri' → sorted JS weekday numbers (0=Sun), or null if unparseable. */
export function parseDays(days: string): number[] | null {
  const s = (days ?? "").trim().toLowerCase();
  if (s === "daily" || s === "") return [0, 1, 2, 3, 4, 5, 6];
  if (s === "weekdays") return [1, 2, 3, 4, 5];
  if (s === "weekends") return [0, 6];
  const out = new Set<number>();
  for (const part of s.split(",")) {
    const name = part.trim().slice(0, 3);
    if (!name) continue;
    const i = DAY_NAMES.indexOf(name);
    if (i < 0) return null;
    out.add(i);
  }
  return out.size ? [...out].sort((a, b) => a - b) : null;
}

/** The zone's UTC offset in minutes (east positive) at instant `at`. */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // hour is "24" at midnight in some ICU versions; normalize.
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** UTC ms of local wall time y-m-d h:min in `tz` (two-pass DST correction). */
export function zonedTimeToUtc(y: number, m: number, d: number, hour: number, minute: number, tz: string): number {
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  let ts = naive - tzOffsetMinutes(tz, new Date(naive)) * 60_000;
  ts = naive - tzOffsetMinutes(tz, new Date(ts)) * 60_000;
  return ts;
}

/** The local calendar day in `tz` at instant `at`, as YYYY-MM-DD. */
export function localDayInTz(tz: string, at: Date): string {
  return at.toLocaleDateString("en-CA", { timeZone: tz });
}

/** Human-ish local time line for prompts, e.g. "Wed 2026-07-08 12:05". */
export function localTimeLineInTz(tz: string, at: Date): string {
  const day = at.toLocaleDateString("en-US", { timeZone: tz, weekday: "short" });
  const date = localDayInTz(tz, at);
  const time = at.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${date} ${time}`;
}

/**
 * The next UTC instant (ms) this reminder's local wall time occurs strictly
 * after `from`, or null when there is none (a one-off whose time has passed).
 */
export function nextFireAt(r: ReminderSchedule, from: Date): number | null {
  if (r.onceDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.onceDate);
    if (!m) return null;
    const ts = zonedTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), r.hour, r.minute, r.tz);
    return ts > from.getTime() ? ts : null;
  }
  const allowed = parseDays(r.days) ?? [0, 1, 2, 3, 4, 5, 6];
  const [y, mo, d] = localDayInTz(r.tz, from).split("-").map(Number);
  // Walk from the zone's "today" up to 8 days out (covers any single-day spec).
  for (let i = 0; i <= 8; i++) {
    const candidate = new Date(Date.UTC(y, mo - 1, d + i));
    if (!allowed.includes(candidate.getUTCDay())) continue;
    const ts = zonedTimeToUtc(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, candidate.getUTCDate(), r.hour, r.minute, r.tz);
    if (ts > from.getTime()) return ts;
  }
  return null;
}

/**
 * Best-effort IANA zone for a JS getTimezoneOffset() value (minutes, UTC−local)
 * — the fixed-offset Etc/GMT± zones, so only whole hours map; anything else
 * returns null and the caller falls back to stored/default zones. Note the
 * inverted Etc sign convention: Etc/GMT+5 is UTC−5.
 */
export function offsetMinutesToTz(tzMin: number): string | null {
  if (!Number.isFinite(tzMin) || tzMin % 60 !== 0) return null;
  const hours = tzMin / 60; // getTimezoneOffset sign: positive = west of UTC
  if (hours === 0) return "Etc/GMT";
  if (hours < -14 || hours > 12) return null;
  return `Etc/GMT${hours > 0 ? "+" : "-"}${Math.abs(hours)}`;
}

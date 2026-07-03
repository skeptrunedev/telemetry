// Local-date helpers shared by the day-navigation UI.

export const todayLocal = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

/** Shift a local YYYY-MM-DD string by whole days (noon-safe, DST-safe). */
export function shiftDay(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** Friendly label: "today", "yesterday", or "Wed, Jul 2". */
export function dayLabel(dateStr: string): string {
  const today = todayLocal();
  if (dateStr === today) return "today";
  if (dateStr === shiftDay(today, -1)) return "yesterday";
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

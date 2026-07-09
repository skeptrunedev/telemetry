import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "./api";
import type { Reminder } from "./api";

// "08:00" in the reminder's tz → "8:00 AM PT" style display for the viewer.
function fmtTime(r: Reminder): string {
  const [h, m] = r.time.split(":").map(Number);
  const ampm = h! >= 12 ? "PM" : "AM";
  const h12 = h! % 12 || 12;
  const zone =
    new Intl.DateTimeFormat(undefined, { timeZone: r.tz, timeZoneName: "short" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? r.tz;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm} ${zone}`;
}

function fmtDays(r: Reminder): string {
  if (r.onceDate) return `once, ${r.onceDate}`;
  return r.days;
}

// Reminders the agents set up (or will nudge about) — visible and manageable
// from the dashboard. Creation stays conversational: ask the agent.
export function Reminders() {
  const [data, setData] = useState<{ reminders: Reminder[]; phoneLinked: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listReminders().then(setData).catch(() => setData({ reminders: [], phoneLinked: false }));
  }, []);
  useEffect(load, [load]);

  if (!data) return null;

  const toggle = async (r: Reminder) => {
    setBusy(r.id);
    try {
      await api.setReminderEnabled(r.id, !r.enabled);
      load();
    } finally {
      setBusy(null);
    }
  };
  const remove = async (r: Reminder) => {
    if (!confirm(`Delete this reminder?\n\n“${r.instruction}”`)) return;
    setBusy(r.id);
    try {
      await api.deleteReminder(r.id);
      load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card">
      <p className="label">Reminders · texted from skcal</p>
      {data.reminders.length === 0 ? (
        <p className="empty">none yet — ask the agent, “remind me to log lunch at noon”</p>
      ) : (
        <div className="rows">
          {data.reminders.map((r) => (
            <div className="crow" key={r.id}>
              <div className="crow-top">
                <span className={r.enabled ? "crow-label reminder-text" : "crow-label reminder-text reminder-off"}>
                  {r.instruction}
                </span>
                <span className="reminder-actions">
                  <button
                    className="reminder-toggle"
                    disabled={busy === r.id}
                    onClick={() => toggle(r)}
                    aria-label={r.enabled ? "Pause reminder" : "Resume reminder"}
                  >
                    {r.enabled ? "on" : "off"}
                  </button>
                  <button
                    className="reminder-delete"
                    disabled={busy === r.id}
                    onClick={() => remove(r)}
                    aria-label="Delete reminder"
                  >
                    <X />
                  </button>
                </span>
              </div>
              <span className="reminder-when">
                {fmtTime(r)} · {fmtDays(r)}
              </span>
            </div>
          ))}
        </div>
      )}
      {!data.phoneLinked && data.reminders.length > 0 && (
        <p className="reminder-warn">No phone linked yet — these can’t be delivered until you link one.</p>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { kgToLb } from "../shared/types";
import { api } from "./api";
import type { WeightReading } from "./api";

const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function WeightHistory() {
  const [rows, setRows] = useState<WeightReading[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.weightList().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  async function saveNote(id: number) {
    setBusy(true);
    try {
      await api.setWeightNote(id, draft.trim() || null);
      setEditing(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return null;

  return (
    <section className="card">
      <p className="label">Weigh-ins · tap to note</p>
      {rows.length === 0 ? (
        <p className="empty">no weigh-ins yet</p>
      ) : (
        <div className="rows">
          {rows.map((r) => (
            <div className="crow" key={r.id}>
              <div className="crow-top">
                <span className="crow-label">
                  {fmtDate(r.ts)}
                  {r.source === "scale" ? " · scale" : ""}
                </span>
                <span className="crow-val">
                  {kgToLb(r.weightKg).toFixed(1)}
                  <span className="unit"> lb</span>
                </span>
              </div>
              {editing === r.id ? (
                <div className="note-edit">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="add a note…"
                    maxLength={500}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveNote(r.id);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <button className="btn sm" onClick={() => saveNote(r.id)} disabled={busy}>
                    Save
                  </button>
                </div>
              ) : (
                <button
                  className="note-edit-trigger"
                  onClick={() => {
                    setEditing(r.id);
                    setDraft(r.note ?? "");
                  }}
                >
                  {r.note ? `“${r.note}”` : "+ add note"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { kgToLb } from "../shared/types";
import { api } from "./api";
import type { WeightReading } from "./api";

const f1 = (n: number) => n.toFixed(1);
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function WeightHistory({ refreshKey = 0 }: { refreshKey?: number }) {
  const [rows, setRows] = useState<WeightReading[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.weightList().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(load, [load, refreshKey]);

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
  if (rows.length === 0) return <p className="empty">no weigh-ins yet</p>;

  // newest first → rank 1
  const ordered = [...rows].sort((a, b) => b.ts - a.ts);

  return (
    <ol className="stories">
      {ordered.map((r, i) => {
        const prev = ordered[i + 1];
        const lb = kgToLb(r.weightKg);
        const dayDelta = prev ? lb - kgToLb(prev.weightKg) : null;
        return (
          <li className="story" key={r.id}>
            <span className="story-rank">{i + 1}.</span>
            <span className="story-body">
              <div className="story-title">
                {f1(lb)} lb
                {dayDelta != null && Math.abs(dayDelta) >= 0.05 && (
                  <span className={`delta ${dayDelta < 0 ? "good" : "attention"}`}>
                    {dayDelta < 0 ? "▾" : "▴"}
                    {Math.abs(dayDelta).toFixed(1)}
                  </span>
                )}
              </div>
              <div className="story-sub">
                {fmtDate(r.ts)}
                {r.source === "scale" && (
                  <>
                    <span className="subsep"> | </span>scale
                  </>
                )}
                {r.note && (
                  <>
                    <span className="subsep"> | </span>“{r.note}”
                  </>
                )}
                <span className="subsep"> | </span>
                {editing === r.id ? (
                  <span className="note-edit">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="note…"
                      maxLength={500}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveNote(r.id);
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <button className="linkbtn" onClick={() => saveNote(r.id)} disabled={busy}>
                      save
                    </button>
                  </span>
                ) : (
                  <button
                    className="linkbtn"
                    onClick={() => {
                      setEditing(r.id);
                      setDraft(r.note ?? "");
                    }}
                  >
                    edit
                  </button>
                )}
              </div>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

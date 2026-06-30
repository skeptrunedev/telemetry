import { useState } from "react";
import { lbToKg, inToCm, MEASUREMENT_SITES, SITE_LABELS } from "../shared/types";
import { api } from "./api";
import { MealAnalyzer } from "./MealAnalyzer";

type Tab = "weight" | "measure" | "nutrition";

export function AddSheet({ onClose, onChange }: { onClose: () => void; onChange: () => void }) {
  const [tab, setTab] = useState<Tab>("weight");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // weight
  const [lb, setLb] = useState("");
  const [bf, setBf] = useState("");
  const [note, setNote] = useState("");
  // measure
  const [site, setSite] = useState<string>("shoulders");
  const [inches, setInches] = useState("");

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      if (tab === "weight") {
        const v = parseFloat(lb);
        if (!isFinite(v) || v < 30 || v > 700) throw new Error("Enter a weight between 30 and 700 lb");
        const bfv = bf ? parseFloat(bf) : null;
        if (bfv != null && (!isFinite(bfv) || bfv < 1 || bfv > 80)) throw new Error("Body fat % must be 1–80");
        await api.addWeight(lbToKg(v), bfv, note.trim() || null);
      } else if (tab === "measure") {
        const v = parseFloat(inches);
        if (!isFinite(v) || v < 1 || v > 120) throw new Error("Enter a measurement between 1 and 120 in");
        await api.addMeasurement(site, inToCm(v));
      }
      onChange();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <p className="sheet-title">add</p>
        <div className="subtabs">
          {(["weight", "measure", "nutrition"] as Tab[]).map((t, i) => (
            <span key={t}>
              {i > 0 && <span className="subtab-sep">|</span>}
              <button className={`subtab ${tab === t ? "active" : ""}`} onClick={() => { setTab(t); setErr(null); }}>
                {t}
              </button>
            </span>
          ))}
        </div>

        {tab === "weight" && (
          <div className="form">
            <label className="field">
              <span>Weight (lb)</span>
              <input inputMode="decimal" value={lb} onChange={(e) => setLb(e.target.value)} placeholder="160.0" />
            </label>
            <label className="field">
              <span>Body fat % (optional, noisy)</span>
              <input inputMode="decimal" value={bf} onChange={(e) => setBf(e.target.value)} placeholder="20" />
            </label>
            <label className="field">
              <span>Note (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="post-workout, dehydrated, …" maxLength={500} />
            </label>
          </div>
        )}

        {tab === "measure" && (
          <div className="form">
            <label className="field">
              <span>Site</span>
              <select value={site} onChange={(e) => setSite(e.target.value)}>
                {MEASUREMENT_SITES.map((s) => (
                  <option key={s} value={s}>
                    {SITE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Measurement (in)</span>
              <input inputMode="decimal" value={inches} onChange={(e) => setInches(e.target.value)} placeholder="15.0" />
            </label>
          </div>
        )}

        {tab === "nutrition" && <MealAnalyzer onLogged={onChange} />}

        {tab !== "nutrition" && err && <p className="form-err">{err}</p>}

        <div className="sheet-actions">
          {tab === "nutrition" ? (
            <button className="btn" onClick={onClose} disabled={busy}>
              done
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose} disabled={busy}>
                cancel
              </button>
              <button className="btn primary" onClick={save} disabled={busy}>
                {busy ? "saving…" : "save"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

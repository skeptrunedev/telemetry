import { useState } from "react";
import { lbToKg, inToCm, MEASUREMENT_SITES, SITE_LABELS } from "../shared/types";
import type { Adherence } from "../shared/types";
import { api, todayLocal } from "./api";

type Tab = "weight" | "measure" | "nutrition";

export function AddSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<Tab>("weight");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // weight
  const [lb, setLb] = useState("");
  const [bf, setBf] = useState("");
  // measure
  const [site, setSite] = useState<string>("shoulders");
  const [inches, setInches] = useState("");
  // nutrition
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [adherence, setAdherence] = useState<Adherence | "">("");

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      if (tab === "weight") {
        const v = parseFloat(lb);
        if (!isFinite(v)) throw new Error("Enter a weight in lb");
        await api.addWeight(lbToKg(v), bf ? parseFloat(bf) : null);
      } else if (tab === "measure") {
        const v = parseFloat(inches);
        if (!isFinite(v)) throw new Error("Enter a measurement in inches");
        await api.addMeasurement(site, inToCm(v));
      } else {
        await api.putNutrition({
          date: todayLocal(),
          kcal: kcal ? parseInt(kcal, 10) : null,
          proteinG: protein ? parseInt(protein, 10) : null,
          hitProtein: protein ? parseInt(protein, 10) >= 160 : null,
          adherence: adherence || null,
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="tabs">
          {(["weight", "measure", "nutrition"] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t}
            </button>
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

        {tab === "nutrition" && (
          <div className="form">
            <label className="field">
              <span>Calories (today)</span>
              <input inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="1850" />
            </label>
            <label className="field">
              <span>Protein (g)</span>
              <input inputMode="numeric" value={protein} onChange={(e) => setProtein(e.target.value)} placeholder="160" />
            </label>
            <label className="field">
              <span>Adherence</span>
              <select value={adherence} onChange={(e) => setAdherence(e.target.value as Adherence | "")}>
                <option value="">—</option>
                <option value="under">Under target</option>
                <option value="on">On target</option>
                <option value="over">Over target</option>
              </select>
            </label>
          </div>
        )}

        {err && <p className="form-err">{err}</p>}
        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

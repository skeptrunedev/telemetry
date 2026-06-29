import { useState } from "react";
import { api, todayLocal } from "./api";
import type { MealAnalysis } from "./api";

export function MealAnalyzer({ onLogged }: { onLogged: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<MealAnalysis | null>(null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const fs = Array.from(e.target.files ?? []).slice(0, 5);
    setFiles(fs);
    setPreviews(fs.map((f) => URL.createObjectURL(f)));
    setResult(null);
    setErr(null);
  }

  async function analyze() {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.analyzeMeal(todayLocal(), files);
      setResult(res);
      onLogged(); // it's already saved server-side; refresh the dashboard total
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="form">
        <p className="insight">
          Logged · {result.totalKcal} kcal / {result.totalProteinG}g protein
        </p>
        <div className="rows">
          {result.items.map((it, i) => (
            <div className="crow" key={i}>
              <div className="crow-top">
                <span className="crow-label">{it.name}</span>
                <span className="crow-val">
                  {it.kcal}
                  <span className="unit"> kcal · {Math.round(it.proteinG)}g</span>
                </span>
              </div>
            </div>
          ))}
        </div>
        {result.note && <p className="meta">{result.note}</p>}
        <button
          className="btn ghost"
          onClick={() => {
            setFiles([]);
            setPreviews([]);
            setResult(null);
          }}
        >
          Log another meal
        </button>
      </div>
    );
  }

  return (
    <div className="form">
      <label className="photo-pick">
        <input type="file" accept="image/*" capture="environment" multiple onChange={pick} hidden />
        <span>{files.length ? `${files.length} photo${files.length > 1 ? "s" : ""} selected — tap to change` : "📷  Photograph your meal (1–5 photos)"}</span>
      </label>
      {previews.length > 0 && (
        <div className="thumbs">
          {previews.map((src, i) => (
            <img key={i} src={src} className="thumb" alt="" />
          ))}
        </div>
      )}
      {err && <p className="form-err">{err}</p>}
      <button className="btn" onClick={analyze} disabled={busy || !files.length}>
        {busy ? "Analyzing…" : "Analyze with AI"}
      </button>
      <p className="meta">AI estimates calories + protein from the photo — review before trusting it.</p>
    </div>
  );
}

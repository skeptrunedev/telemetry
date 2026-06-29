import { useState } from "react";
import { api, todayLocal } from "./api";
import type { MealAnalysis } from "./api";
import { compressImage } from "./image";

export function MealAnalyzer({ onLogged }: { onLogged: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<MealAnalysis | null>(null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    if (incoming.length) {
      setFiles((prev) => [...prev, ...incoming].slice(0, 5));
      setPreviews((prev) => [...prev, ...incoming.map((f) => URL.createObjectURL(f))].slice(0, 5));
      setResult(null);
      setErr(null);
    }
    e.target.value = ""; // allow re-selecting the same file
  }

  function clearPhotos() {
    previews.forEach((u) => URL.revokeObjectURL(u));
    setFiles([]);
    setPreviews([]);
  }

  async function analyze() {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    try {
      const prepared = await Promise.all(files.map(compressImage));
      const res = await api.analyzeMeal(todayLocal(), prepared);
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
      <div className="photo-picks">
        <label className="photo-pick">
          <input type="file" accept="image/*" capture="environment" multiple onChange={pick} hidden />
          <span>📷 Take photo</span>
        </label>
        <label className="photo-pick">
          <input type="file" accept="image/*" multiple onChange={pick} hidden />
          <span>🖼 Camera roll</span>
        </label>
      </div>
      {previews.length > 0 && (
        <div className="thumbs">
          {previews.map((src, i) => (
            <img key={i} src={src} className="thumb" alt="" />
          ))}
          <button type="button" className="thumb-clear" onClick={clearPhotos} aria-label="Clear photos">
            ✕
          </button>
        </div>
      )}
      <p className="meta">{files.length ? `${files.length}/5 photos of one meal` : "Add up to 5 photos of one meal"}</p>
      {err && <p className="form-err">{err}</p>}
      <button className="btn" onClick={analyze} disabled={busy || !files.length}>
        {busy ? "Analyzing…" : "Analyze with AI"}
      </button>
      <p className="meta">AI estimates calories + protein from the photo — review before trusting it.</p>
    </div>
  );
}

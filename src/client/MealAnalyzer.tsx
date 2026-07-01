import { useState } from "react";
import { api, todayLocal } from "./api";
import type { MealAnalysis } from "./api";
import { compressImage } from "./image";

type Method = "photo" | "text";

export function MealAnalyzer({ onLogged }: { onLogged: () => void }) {
  const [method, setMethod] = useState<Method>("photo");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [text, setText] = useState("");
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
    e.target.value = "";
  }

  function clearPhotos() {
    previews.forEach((u) => URL.revokeObjectURL(u));
    setFiles([]);
    setPreviews([]);
  }

  function reset() {
    clearPhotos();
    setText("");
    setResult(null);
    setErr(null);
  }

  async function run(fn: () => Promise<MealAnalysis>) {
    setBusy(true);
    setErr(null);
    try {
      setResult(await fn());
      onLogged();
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
        <button className="btn ghost" onClick={reset}>
          Log another meal
        </button>
      </div>
    );
  }

  return (
    <div className="form">
      <div className="tabs">
        <button className={`tab ${method === "photo" ? "active" : ""}`} onClick={() => { setMethod("photo"); setErr(null); }}>
          Photo
        </button>
        <button className={`tab ${method === "text" ? "active" : ""}`} onClick={() => { setMethod("text"); setErr(null); }}>
          Describe
        </button>
      </div>

      {method === "photo" ? (
        <>
          <div className="photo-picks">
            <label className="photo-pick">
              <input type="file" accept="image/*" capture="environment" multiple onChange={pick} hidden />
              <span>Take photo</span>
            </label>
            <label className="photo-pick">
              <input type="file" accept="image/*" multiple onChange={pick} hidden />
              <span>Camera roll</span>
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
          {err && <p className="form-err">{err}</p>}
          <button
            className="btn"
            onClick={() =>
              run(async () => {
                const compressed = await Promise.all(files.map((f) => compressImage(f)));
                return api.analyzeMeal(todayLocal(), compressed);
              })
            }
            disabled={busy || !files.length}
          >
            {busy ? "Analyzing…" : "Analyze with AI"}
          </button>
          <p className="meta">
            {files.length
              ? `${files.length}/5 photos of one meal`
              : "Add up to 5 photos of one meal (multiple angles) — AI estimates calories + protein."}
          </p>
        </>
      ) : (
        <>
          <textarea
            className="describe-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="e.g. chicken breast + salad from The Bite — ate all the chicken with a side of toum, skipped most of the salad but had the olives, feta, cucumber, and cherry tomatoes"
          />
          {err && <p className="form-err">{err}</p>}
          <button className="btn" onClick={() => run(() => api.describeMeal(todayLocal(), text.trim()))} disabled={busy || !text.trim()}>
            {busy ? "Analyzing…" : "Analyze description"}
          </button>
          <p className="meta">Describe what you actually ate (mention what you skipped) — AI estimates calories + protein.</p>
        </>
      )}
    </div>
  );
}

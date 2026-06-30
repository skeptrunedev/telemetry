import { useState } from "react";
import { api, todayLocal } from "./api";
import type { MealAnalysis, MealMode } from "./api";
import { compressImage } from "./image";

type Method = "photo" | "text";

export function MealAnalyzer({ onLogged }: { onLogged: () => void }) {
  const [method, setMethod] = useState<Method>("photo");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [mode, setMode] = useState<MealMode>("angles");
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
        <p className="analyzer-head">
          logged · {result.totalKcal} kcal / {result.totalProteinG} g protein
        </p>
        <ol className="stories">
          {result.items.map((it, i) => (
            <li className="story" key={i}>
              <span className="story-rank">{i + 1}.</span>
              <span className="story-body">
                <div className="story-title">
                  {it.name} {it.kcal} kcal
                </div>
                <div className="story-sub">{Math.round(it.proteinG)} g protein</div>
              </span>
            </li>
          ))}
        </ol>
        {result.note && <p className="empty">{result.note}</p>}
        <button className="btn" onClick={reset}>
          log another meal
        </button>
      </div>
    );
  }

  return (
    <div className="form">
      <div className="subtabs">
        <button className={`subtab ${method === "photo" ? "active" : ""}`} onClick={() => { setMethod("photo"); setErr(null); }}>
          photo
        </button>
        <span className="subtab-sep">|</span>
        <button className={`subtab ${method === "text" ? "active" : ""}`} onClick={() => { setMethod("text"); setErr(null); }}>
          describe
        </button>
      </div>

      {method === "photo" ? (
        <>
          <div className="subtabs">
            <button className={`subtab ${mode === "angles" ? "active" : ""}`} onClick={() => setMode("angles")}>
              one meal
            </button>
            <span className="subtab-sep">|</span>
            <button className={`subtab ${mode === "beforeafter" ? "active" : ""}`} onClick={() => setMode("beforeafter")}>
              before / after
            </button>
          </div>
          <div className="photo-picks">
            <label className="photo-pick">
              <input type="file" accept="image/*" capture="environment" multiple onChange={pick} hidden />
              <span>take photo</span>
            </label>
            <label className="photo-pick">
              <input type="file" accept="image/*" multiple onChange={pick} hidden />
              <span>camera roll</span>
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
            className="btn primary"
            onClick={() =>
              run(async () => {
                const compressed = await Promise.all(files.map((f) => compressImage(f)));
                return api.analyzeMeal(todayLocal(), compressed, mode);
              })
            }
            disabled={busy || !files.length}
          >
            {busy ? "analyzing…" : "analyze with ai"}
          </button>
          <p className="empty">
            {mode === "beforeafter"
              ? "First photo = full plate, then the leftovers — AI logs only what you ate."
              : files.length
                ? `${files.length}/5 photos of one meal`
                : "Add up to 5 photos of one meal (multiple angles)"}
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
          <button className="btn primary" onClick={() => run(() => api.describeMeal(todayLocal(), text.trim()))} disabled={busy || !text.trim()}>
            {busy ? "analyzing…" : "analyze description"}
          </button>
          <p className="empty">describe what you actually ate (mention what you skipped) — ai estimates calories + protein.</p>
        </>
      )}
    </div>
  );
}

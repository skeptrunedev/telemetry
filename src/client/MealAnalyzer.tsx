import { useEffect, useState } from "react";
import { api, todayLocal } from "./api";
import type { MealAnalysis } from "./api";
import { compressImage } from "./image";

export function MealAnalyzer({ onLogged }: { onLogged: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<MealAnalysis | null>(null);

  function addFiles(incoming: File[]) {
    if (!incoming.length) return;
    setFiles((prev) => [...prev, ...incoming].slice(0, 5));
    setPreviews((prev) => [...prev, ...incoming.map((f) => URL.createObjectURL(f))].slice(0, 5));
    setResult(null);
    setErr(null);
  }

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  }

  // Paste an image from the clipboard (screenshot, copied photo) to attach it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const imgs = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => f != null);
      if (imgs.length) {
        e.preventDefault();
        addFiles(imgs);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  function clearPhotos() {
    previews.forEach((u) => URL.revokeObjectURL(u));
    setFiles([]);
    setPreviews([]);
  }

  function reset() {
    clearPhotos();
    setDescription("");
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

  const hasPhotos = files.length > 0;
  const hasText = description.trim().length > 0;

  return (
    <div className="form">
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
      <textarea
        className="describe-input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={hasPhotos ? 2 : 4}
        maxLength={2000}
        placeholder={
          hasPhotos
            ? "Add context (optional) — e.g. the white sauce is toum, that's a 12oz steak, ignore the drink"
            : "Describe what you ate (or add a photo) — e.g. chicken breast + toum, skipped most of the salad but had the olives and feta"
        }
      />
      {err && <p className="form-err">{err}</p>}
      <button
        className="btn"
        onClick={() =>
          run(async () => {
            const text = description.trim();
            if (hasPhotos) {
              const compressed = await Promise.all(files.map((f) => compressImage(f)));
              return api.analyzeMeal(todayLocal(), compressed, text);
            }
            return api.describeMeal(todayLocal(), text);
          })
        }
        disabled={busy || (!hasPhotos && !hasText)}
      >
        {busy ? "Analyzing…" : "Analyze with AI"}
      </button>
      <p className="meta">
        {hasPhotos
          ? `${files.length}/5 photos of one meal — AI estimates calories + protein.`
          : "Add a photo (or paste one), a description, or both — AI estimates calories + protein."}
      </p>
    </div>
  );
}

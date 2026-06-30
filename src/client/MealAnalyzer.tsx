import { useState } from "react";
import { api, todayLocal } from "./api";
import type { MealAnalysis } from "./api";

export function MealAnalyzer({ onLogged }: { onLogged: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<MealAnalysis | null>(null);

  function reset() {
    setText("");
    setResult(null);
    setErr(null);
  }

  async function analyze() {
    setBusy(true);
    setErr(null);
    try {
      setResult(await api.describeMeal(todayLocal(), text.trim()));
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
      <textarea
        className="describe-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder="e.g. chicken breast + salad from The Bite — ate all the chicken with a side of toum, skipped most of the salad but had the olives, feta, cucumber, and cherry tomatoes"
      />
      {err && <p className="form-err">{err}</p>}
      <button className="btn" onClick={analyze} disabled={busy || !text.trim()}>
        {busy ? "Analyzing…" : "Analyze description"}
      </button>
      <p className="meta">Describe what you actually ate (mention what you skipped) — AI estimates calories + protein.</p>
    </div>
  );
}

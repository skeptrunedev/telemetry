import { useCallback, useEffect, useState } from "react";
import { api, todayLocal } from "./api";
import type { Meal } from "./api";

export function FoodLog({ refreshKey, onChange }: { refreshKey: number; onChange: () => void }) {
  const [meals, setMeals] = useState<Meal[] | null>(null);

  const load = useCallback(() => {
    api.meals(todayLocal()).then(setMeals).catch(() => setMeals([]));
  }, []);
  useEffect(load, [load, refreshKey]);

  async function removeItem(id: number) {
    await api.deleteItem(id);
    load();
    onChange();
  }
  async function removeMeal(id: string) {
    await api.deleteMeal(id);
    load();
    onChange();
  }

  if (!meals) return null;
  if (meals.length === 0) return <p className="empty">no meals logged yet — add one from the add link</p>;

  return (
    <ol className="stories">
      {meals.map((m, i) => {
        const kcal = m.items.reduce((s, it) => s + it.kcal, 0);
        const protein = Math.round(m.items.reduce((s, it) => s + it.proteinG, 0));
        const title = m.note?.trim() ? m.note.trim() : `${kcal} kcal · ${protein} g`;
        return (
          <li className="story" key={m.id}>
            <span className="story-rank">{i + 1}.</span>
            <span className="story-body">
              <div className="story-title">
                {title}
                {m.note?.trim() ? <span className="delta">{kcal} kcal · {protein} g</span> : null}
              </div>
              <div className="story-sub">
                {m.items.map((it, j) => (
                  <span key={it.id}>
                    {j > 0 && " · "}
                    {it.name.toLowerCase()} {it.kcal}
                    <button className="linkbtn itemx" onClick={() => removeItem(it.id)} aria-label={`Remove ${it.name}`}>
                      ✕
                    </button>
                  </span>
                ))}
                <span className="subsep"> | </span>
                <button className="linkbtn" onClick={() => removeMeal(m.id)} aria-label="Remove whole meal">
                  delete
                </button>
              </div>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

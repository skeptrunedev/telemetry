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

  return (
    <section className="card">
      <p className="label">Food log / today</p>
      {meals.length === 0 ? (
        <p className="empty">no meals logged yet — tap + → nutrition</p>
      ) : (
        <div className="meals">
          {meals.map((m) => {
            const kcal = m.items.reduce((s, i) => s + i.kcal, 0);
            const protein = Math.round(m.items.reduce((s, i) => s + i.proteinG, 0));
            return (
              <div className="meal" key={m.id}>
                <div className="meal-head">
                  <div className="meal-sum">
                    <span className="meal-total">{kcal} kcal · {protein}g</span>
                    {m.note && <span className="meal-note">{m.note}</span>}
                  </div>
                  <button className="x" onClick={() => removeMeal(m.id)} aria-label="Remove whole meal">✕</button>
                </div>
                <div className="rows">
                  {m.items.map((it) => (
                    <div className="crow" key={it.id}>
                      <div className="crow-top">
                        <span className="crow-label">{it.name}</span>
                        <span className="item-right">
                          <span className="crow-val">
                            {it.kcal}
                            <span className="unit"> · {Math.round(it.proteinG)}g</span>
                          </span>
                          <button className="x sm" onClick={() => removeItem(it.id)} aria-label="Remove item">✕</button>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

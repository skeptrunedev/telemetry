import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, todayLocal } from "./api";
import type { Meal } from "./api";

// Shift a local YYYY-MM-DD string by whole days (noon-safe, DST-safe).
function shiftDay(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

export function FoodLog({ refreshKey, onChange }: { refreshKey: number; onChange: () => void }) {
  const [date, setDate] = useState(() => todayLocal());
  const [meals, setMeals] = useState<Meal[] | null>(null);

  const load = useCallback(() => {
    api.meals(date).then(setMeals).catch(() => setMeals([]));
  }, [date]);
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

  const today = todayLocal();
  const isToday = date === today;
  const label = isToday
    ? "today"
    : new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <section className="card">
      <div className="foodlog-head">
        <p className="label">Food log</p>
        <div className="daynav">
          <button className="daynav-btn" onClick={() => setDate((d) => shiftDay(d, -1))} aria-label="Previous day">
            <ChevronLeft />
          </button>
          <span className="daynav-label">{label}</span>
          <button
            className="daynav-btn"
            onClick={() => setDate((d) => shiftDay(d, 1))}
            disabled={isToday}
            aria-label="Next day"
          >
            <ChevronRight />
          </button>
        </div>
      </div>
      {!meals ? null : meals.length === 0 ? (
        <p className="empty">{isToday ? "no meals logged yet — tap + → nutrition" : "no meals logged this day"}</p>
      ) : (
        <div className="meals">
          {meals.map((m) => {
            const kcal = m.items.reduce((s, i) => s + i.kcal, 0);
            const protein = Math.round(m.items.reduce((s, i) => s + i.proteinG, 0));
            return (
              <div className="meal" key={m.id}>
                <div className="meal-head">
                  {m.photoKeys[0] && <img className="meal-thumb" src={api.photoUrl(m.photoKeys[0])} alt="" />}
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

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { dayLabel } from "./dates";
import type { Workout } from "./api";

// The day shown is owned by the Today view's day-strip; this card just renders
// the workouts for whatever day it's given (logged via the coach/agents).
export function WorkoutLog({ date, refreshKey }: { date: string; refreshKey: number }) {
  const [workouts, setWorkouts] = useState<Workout[] | null>(null);

  const load = useCallback(() => {
    api.workouts(date).then(setWorkouts).catch(() => setWorkouts([]));
  }, [date]);
  useEffect(load, [load, refreshKey]);

  async function remove(id: string) {
    await api.deleteWorkout(id);
    load();
  }

  const label = dayLabel(date);

  return (
    <section className="card">
      <p className="label">Workouts / {label}</p>
      {!workouts ? null : workouts.length === 0 ? (
        <p className="empty">{label === "today" ? "no workouts logged yet — tell the coach what you did" : "no workouts logged this day"}</p>
      ) : (
        <div className="rows">
          {workouts.map((w) => (
            <div className="crow" key={w.id}>
              <div className="crow-top">
                <span className="crow-label">{w.summary}</span>
                <button className="x sm" onClick={() => remove(w.id)} aria-label="Remove workout">✕</button>
              </div>
              {w.description !== w.summary && <p className="meta">{w.description}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

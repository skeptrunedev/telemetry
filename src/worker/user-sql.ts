// Read-only, per-user SQL for the coach's query_user_data tool. Pure (no
// Worker imports) so the scoping rules are unit-tested directly.
//
// D1 has no row-level security, so scoping is done by shadowing: the model's
// SELECT runs as a subquery under a WITH clause that defines a CTE for EVERY
// table in the database. Exposed tables become this user's rows (a curated
// column list, bound to ?1 = their email); every other table, including ones
// added later, becomes an empty CTE. Unqualified table names resolve to the
// CTEs, and anything that could reach the real tables (schema-qualified names,
// sqlite_ internals) is rejected. Because the model's text is a subquery, a
// write statement is a syntax error rather than a write.

/** Exposed tables: CTE body selecting this user's rows (?1 = email). */
const EXPOSED: Record<string, { columns: string; from: string }> = {
  meals: { columns: "id, date, note, photo_keys, created_at", from: "main.meals WHERE user_email = ?1" },
  nutrition_items: {
    columns: "id, meal_id, date, name, kcal, protein_g, source, created_at",
    from: "main.nutrition_items WHERE user_email = ?1",
  },
  nutrition_days: { columns: "date, kcal, protein_g, hit_protein, adherence", from: "main.nutrition_days WHERE user_email = ?1" },
  weight_readings: { columns: "id, ts, weight_kg, body_fat_pct, source, note", from: "main.weight_readings WHERE user_email = ?1" },
  measurements: { columns: "id, ts, site, value_cm, source", from: "main.measurements WHERE user_email = ?1" },
  workouts: {
    columns:
      "id, source, activity_type, summary, description, started_at, duration_s, moving_duration_s, distance_m, elevation_gain_m, energy_kcal, avg_hr, max_hr, avg_power_w, avg_cadence, details, created_at",
    from: "main.workouts WHERE user_email = ?1",
  },
  photos: { columns: "id, ts, pose, notes", from: "main.photos WHERE user_email = ?1" },
  targets: {
    columns: "id, goal_weight_kg, target_date, start_weight_kg, start_date, daily_kcal_target, protein_target_g, height_cm, sex",
    from: "main.targets WHERE user_email = ?1",
  },
  reminders: {
    columns: "id, instruction, hour, minute, days, once_date, tz, enabled, next_fire_at, last_sent_at, created_at",
    from: "main.reminders WHERE user_email = ?1",
  },
  agent_memories: { columns: "id, content, created_at", from: "main.agent_memories WHERE user_email = ?1" },
  coach_conversations: { columns: "id, title, created_at, updated_at", from: "main.coach_conversations WHERE user_email = ?1" },
  coach_messages: {
    columns: "m.id AS id, m.conversation_id AS conversation_id, m.role AS role, m.content AS content, m.created_at AS created_at",
    from: "main.coach_messages m JOIN main.coach_conversations cc ON cc.id = m.conversation_id WHERE cc.user_email = ?1",
  },
};

/** Schema text for the tool description. */
export const USER_SQL_SCHEMA = [
  ...Object.entries(EXPOSED).map(([t, d]) => `${t}(${d.columns.replace(/\b\w+\.\w+ AS /g, "")})`),
  "Units: weight_kg in kilograms (x 2.2046 for pounds), value_cm/height_cm in centimeters, distance_m in meters, duration_s in seconds, energy_kcal in kcal. ts, created_at, updated_at, started_at, next_fire_at and last_sent_at are Unix epoch MILLISECONDS (UTC); date, target_date, start_date and once_date are local YYYY-MM-DD text. Use date(ts/1000, 'unixepoch') for a UTC day.",
].join("\n");

export const USER_SQL_MAX_ROWS = 200;

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Validate the model's query and wrap it in the per-user shadowing WITH.
 * `allTables` is every table name in the database (from sqlite_master), so
 * tables that are not exposed are shadowed as empty.
 */
export function buildUserQuery(userSql: string, allTables: string[]): { sql: string } | { error: string } {
  const q = userSql.trim().replace(/;+\s*$/, "");
  if (!q) return { error: "sql is required" };
  if (q.length > 4000) return { error: "sql too long (max 4000 characters)" };
  if (!/^(select|with)\b/i.test(q)) return { error: "only a single SELECT (optionally starting with WITH) is allowed" };
  if (q.includes(";")) return { error: "only one statement is allowed" };
  if (/--|\/\*/.test(q)) return { error: "comments are not allowed" };
  if (/sqlite_/i.test(q)) return { error: "sqlite_ internals are not available" };
  if (/["`[]?\b(main|temp)\b["`\]]?\s*\./i.test(q)) return { error: "schema-qualified names (main./temp.) are not allowed; use the plain table names" };

  const names = new Set([...allTables, ...Object.keys(EXPOSED)]);
  const ctes = [...names]
    .filter((t) => !/^sqlite_/i.test(t))
    .map((t) => {
      const d = EXPOSED[t];
      return d ? `${quoteIdent(t)} AS (SELECT ${d.columns} FROM ${d.from})` : `${quoteIdent(t)} AS (SELECT NULL AS unavailable WHERE 0)`;
    });
  return { sql: `WITH ${ctes.join(",\n")}\nSELECT * FROM (\n${q}\n) LIMIT ${USER_SQL_MAX_ROWS + 1}` };
}

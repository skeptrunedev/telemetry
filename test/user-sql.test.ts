import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { buildUserQuery } from "../src/worker/user-sql";

// A miniature copy of the real schema with two users' rows, so the scoping is
// checked by actually running the built SQL, not by string inspection.
const A = "a@example.com";
const B = "b@example.com";
let db: DatabaseSync;
let tables: string[];

beforeAll(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user (id TEXT, email TEXT, phone_number TEXT);
    CREATE TABLE session (id TEXT, token TEXT, user_id TEXT);
    CREATE TABLE api_keys (id TEXT, user_email TEXT, token_hash TEXT);
    CREATE TABLE weight_readings (id INTEGER, ts INTEGER, weight_kg REAL, body_fat_pct REAL, source TEXT, raw_payload TEXT, user_email TEXT, note TEXT);
    CREATE TABLE meals (id TEXT, user_email TEXT, date TEXT, note TEXT, photo_keys TEXT, created_at INTEGER);
    CREATE TABLE coach_conversations (id TEXT, user_email TEXT, title TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE coach_messages (id TEXT, conversation_id TEXT, role TEXT, content TEXT, created_at INTEGER);
    INSERT INTO user VALUES ('ua', '${A}', '+1555'), ('ub', '${B}', '+1666');
    INSERT INTO session VALUES ('s1', 'secret-token', 'ua');
    INSERT INTO api_keys VALUES ('k1', '${A}', 'hash');
    INSERT INTO weight_readings VALUES (1, 1000, 80, NULL, 'manual', 'raw', '${A}', 'a1'), (2, 2000, 79, NULL, 'manual', 'raw', '${A}', 'a2'), (3, 1500, 60, NULL, 'manual', 'raw', '${B}', 'b1');
    INSERT INTO meals VALUES ('m1', '${A}', '2026-09-01', 'eggs', NULL, 1), ('m2', '${B}', '2026-09-01', 'b meal', NULL, 1);
    INSERT INTO coach_conversations VALUES ('ca', '${A}', 'a chat', 1, 1), ('cb', '${B}', 'b chat', 1, 1);
    INSERT INTO coach_messages VALUES ('x1', 'ca', 'user', 'hello from a', 1), ('x2', 'cb', 'user', 'hello from b', 1);
  `);
  tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
});

function run(sql: string, email = A) {
  const built = buildUserQuery(sql, tables);
  if ("error" in built) return built;
  return { rows: db.prepare(built.sql).all(email) as Record<string, unknown>[] };
}

describe("query_user_data scoping", () => {
  it("sees only the caller's rows", () => {
    const r = run("SELECT note FROM weight_readings ORDER BY ts");
    expect(r).toEqual({ rows: [{ note: "a1" }, { note: "a2" }] });
    expect(run("SELECT COUNT(*) n FROM weight_readings", B)).toEqual({ rows: [{ n: 1 }] });
  });

  it("scopes joins and tables without a user column", () => {
    expect(run("SELECT content FROM coach_messages")).toEqual({ rows: [{ content: "hello from a" }] });
    const joined = run("SELECT m.note, w.weight_kg FROM meals m JOIN weight_readings w ON w.id = 1");
    expect(joined).toEqual({ rows: [{ note: "eggs", weight_kg: 80 }] });
  });

  it("allows the model's own WITH and aggregates", () => {
    const r = run("WITH w AS (SELECT weight_kg FROM weight_readings) SELECT MIN(weight_kg) lo, MAX(weight_kg) hi FROM w");
    expect(r).toEqual({ rows: [{ lo: 79, hi: 80 }] });
  });

  it("hides columns that are not exposed", () => {
    expect(() => run("SELECT raw_payload FROM weight_readings")).toThrow(/no such column/);
    expect(() => run("SELECT user_email FROM meals")).toThrow(/no such column/);
  });

  it("returns nothing from tables that are not exposed", () => {
    for (const t of ["user", "session", "api_keys", '"user"', "[session]"]) {
      expect(run(`SELECT * FROM ${t}`), t).toEqual({ rows: [] });
    }
  });

  it("rejects ways around the shadowing", () => {
    for (const sql of [
      "SELECT * FROM main.session",
      'SELECT * FROM "main"."session"',
      "SELECT * FROM [main].[user]",
      "SELECT * FROM temp.session",
      "SELECT sql FROM sqlite_master",
      "SELECT * FROM sqlite_schema",
      "SELECT * FROM weight_readings; DELETE FROM weight_readings",
      "SELECT 1 -- ",
      "SELECT /* x */ 1",
    ]) {
      expect(run(sql), sql).toHaveProperty("error");
    }
  });

  it("cannot write", () => {
    for (const sql of ["DELETE FROM weight_readings", "UPDATE meals SET note = 'x'", "INSERT INTO meals VALUES (1)", "DROP TABLE meals"]) {
      expect(run(sql), sql).toHaveProperty("error");
    }
    // A WITH wrapping a write is not a valid subquery: SQLite refuses it.
    expect(() => run("WITH x AS (SELECT 1) DELETE FROM weight_readings")).toThrow();
    expect((db.prepare("SELECT COUNT(*) n FROM weight_readings").get() as { n: number }).n).toBe(3);
  });
});

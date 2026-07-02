#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { browserLogin } from "./auth";
import { TelemetryClient, NotAuthenticatedError, ApiError } from "./client";
import {
  DEFAULT_BASE_URL,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  decodeJwt,
  secondsUntilExpiry,
} from "./config";

const LB_PER_KG = 2.2046226218;
const toKg = (lb: number) => lb / LB_PER_KG;
const toLb = (kg: number) => kg * LB_PER_KG;
const f1 = (n: number) => n.toFixed(1);
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local

function emailOf(token: string): string {
  const c = decodeJwt(token);
  return c && typeof c.email === "string" ? c.email : "unknown";
}

/** Wrap a command body with consistent error handling + exit codes. */
function action(fn: (...args: never[]) => Promise<void>) {
  return async (...args: unknown[]) => {
    try {
      await fn(...(args as never[]));
    } catch (err) {
      if (err instanceof NotAuthenticatedError) {
        console.error(pc.red("✗ ") + err.message);
      } else if (err instanceof ApiError) {
        console.error(pc.red(`✗ API error (${err.status}): `) + err.message);
      } else {
        console.error(pc.red("✗ ") + (err instanceof Error ? err.message : String(err)));
      }
      process.exitCode = 1;
    }
  };
}

const program = new Command();
program
  .name("skcal")
  .description("Command-line client for the skcal calorie + body-composition API — built for developers and AI power users.")
  .version(require("../package.json").version, "-v, --version");

// ---- auth ------------------------------------------------------------------
program
  .command("login")
  .description("Sign in via your browser (default), or with --api-key")
  .option("--url <url>", "API base URL", DEFAULT_BASE_URL)
  .option("--api-key <key>", "authenticate with a skcal API key instead of the browser flow")
  .action(
    action(async (opts: { url: string; apiKey?: string }) => {
      const baseUrl = opts.url.replace(/\/$/, "");
      if (opts.apiKey) {
        const apiKey = opts.apiKey.trim();
        // Verify the key before saving so a bad key doesn't get cached.
        const me = await new TelemetryClient(baseUrl, apiKey).whoami();
        saveCredentials({ baseUrl, apiKey, savedAt: new Date().toISOString() });
        console.log(pc.green("✓ ") + `Signed in as ${pc.bold(me.email)} via API key (${baseUrl})`);
        return;
      }
      const { token } = await browserLogin(baseUrl);
      saveCredentials({ baseUrl, token, savedAt: new Date().toISOString() });
      const client = new TelemetryClient(baseUrl, token);
      const me = await client.whoami().catch(() => ({ email: emailOf(token) }));
      console.log(pc.green("✓ ") + `Signed in as ${pc.bold(me.email)} (${baseUrl})`);
    }),
  );

program
  .command("logout")
  .description("Remove the cached credentials")
  .action(
    action(async () => {
      console.log(clearCredentials() ? pc.green("✓ Signed out.") : "Already signed out.");
    }),
  );

program
  .command("whoami")
  .description("Show the signed-in account and how you're authenticated")
  .action(
    action(async () => {
      const creds = loadCredentials();
      const envKey = !!process.env.SKCAL_API_KEY;
      if (!creds && !envKey) throw new NotAuthenticatedError();
      const me = await TelemetryClient.fromConfig().whoami();
      const baseUrl = creds?.baseUrl || process.env.SKCAL_BASE_URL || DEFAULT_BASE_URL;
      let via: string;
      if (envKey) {
        via = pc.dim(" (API key from SKCAL_API_KEY)");
      } else if (creds?.apiKey) {
        via = pc.dim(" (API key)");
      } else if (creds?.token) {
        const left = secondsUntilExpiry(creds.token);
        via = left == null ? "" : left <= 0 ? pc.red(" (session expired — run `skcal login`)") : pc.dim(` (session ~${Math.round(left / 3600)}h)`);
      } else {
        via = "";
      }
      console.log(`${pc.bold(me.email)} @ ${baseUrl}${via}`);
    }),
  );

// ---- status / dashboard ----------------------------------------------------
program
  .command("status")
  .description("Today's snapshot: weight, ratio, and nutrition vs target")
  .option("--date <yyyy-mm-dd>", "day to report nutrition for", today())
  .action(
    action(async (opts: { date: string }) => {
      const d = await TelemetryClient.fromConfig().dashboard(opts.date);
      const w = d.weight;
      const line = (label: string, val: string) => console.log(pc.dim(label.padEnd(14)) + val);
      console.log(pc.bold("skcal") + pc.dim(`  ·  ${opts.date}`));
      line("Weight", w.latestKg != null ? `${f1(toLb(w.latestKg))} lb` : "—");
      line("7-day avg", w.weeklyAvgKg != null ? `${f1(toLb(w.weeklyAvgKg))} lb` : "—");
      if (w.note) line("Last note", pc.italic(`"${w.note}"`));
      line("Shoulder:Waist", d.shoulderToWaist != null ? d.shoulderToWaist.toFixed(3) : "—");
      const n = d.nutritionToday;
      const t = d.targets;
      line("Calories", n?.kcal != null ? `${n.kcal} / ${t.dailyKcalTarget ?? "—"} kcal` : "— none logged");
      line("Protein", n?.proteinG != null ? `${n.proteinG} / ${t.proteinTargetG ?? "—"} g` : "—");
      if (d.measurementsLatest.length) {
        line("Measurements", d.measurementsLatest.map((m) => `${m.site} ${f1(m.valueCm / 2.54)}in`).join("  "));
      }
    }),
  );

// ---- weight ----------------------------------------------------------------
const weight = program.command("weight").description("Log and review weigh-ins");
weight
  .command("log <value>")
  .description("Log a weigh-in (pounds by default)")
  .option("--kg", "treat <value> as kilograms instead of pounds")
  .option("--bf <pct>", "body-fat percentage")
  .option("--note <text>", "note for this reading")
  .action(
    action(async (value: string, opts: { kg?: boolean; bf?: string; note?: string }) => {
      const num = Number(value);
      if (!isFinite(num)) throw new Error(`not a number: ${value}`);
      const kg = opts.kg ? num : toKg(num);
      const bf = opts.bf != null ? Number(opts.bf) : undefined;
      await TelemetryClient.fromConfig().addWeight(kg, bf, opts.note ?? undefined);
      console.log(pc.green("✓ ") + `Logged ${f1(opts.kg ? toLb(kg) : num)} lb${bf != null ? ` · ${bf}% bf` : ""}.`);
    }),
  );
weight
  .command("list")
  .description("List recent weigh-ins")
  .option("-n, --limit <n>", "how many to show", "10")
  .action(
    action(async (opts: { limit: string }) => {
      const rows = await TelemetryClient.fromConfig().listWeight();
      const limit = Math.max(1, Number(opts.limit) || 10);
      if (!rows.length) return console.log(pc.dim("no weigh-ins yet"));
      for (const r of rows.slice(0, limit)) {
        const date = new Date(r.ts).toLocaleDateString("en-CA");
        const bf = r.bodyFatPct != null ? pc.dim(` ${f1(r.bodyFatPct)}%bf`) : "";
        const note = r.note ? pc.dim(`  "${r.note}"`) : "";
        console.log(`${pc.dim(date)}  ${pc.bold(f1(toLb(r.weightKg)) + " lb")}${bf}  ${pc.dim("#" + r.id)}${note}`);
      }
    }),
  );
weight
  .command("note <id> <text...>")
  .description("Set (or clear) the note on a past weigh-in")
  .action(
    action(async (id: string, text: string[]) => {
      const note = text.join(" ").trim() || null;
      await TelemetryClient.fromConfig().setWeightNote(Number(id), note);
      console.log(pc.green("✓ ") + (note ? `Note set on #${id}.` : `Note cleared on #${id}.`));
    }),
  );

// ---- nutrition -------------------------------------------------------------
const meal = program.command("meal").description("Log and review meals");
meal
  .command("describe <text...>")
  .description("Log a meal from a description; AI estimates calories + protein")
  .option("--date <yyyy-mm-dd>", "day to log against", today())
  .action(
    action(async (text: string[], opts: { date: string }) => {
      const desc = text.join(" ").trim();
      if (!desc) throw new Error("describe what you ate");
      process.stderr.write(pc.dim("analyzing…\n"));
      const r = await TelemetryClient.fromConfig().describeMeal(desc, opts.date);
      console.log(pc.green("✓ ") + pc.bold(`${r.totalKcal} kcal · ${r.totalProteinG} g protein`));
      for (const it of r.items) console.log(`  ${pc.dim("·")} ${it.name}  ${pc.dim(`${it.kcal} kcal / ${Math.round(it.proteinG)} g`)}`);
      if (r.note) console.log(pc.dim(`  ${r.note}`));
    }),
  );
meal
  .command("list")
  .description("List meals logged on a day")
  .option("--date <yyyy-mm-dd>", "day to list", today())
  .action(
    action(async (opts: { date: string }) => {
      const meals = await TelemetryClient.fromConfig().listMeals(opts.date);
      if (!meals.length) return console.log(pc.dim(`no meals logged on ${opts.date}`));
      for (const m of meals) {
        const kcal = m.items.reduce((s, i) => s + i.kcal, 0);
        const protein = Math.round(m.items.reduce((s, i) => s + i.proteinG, 0));
        console.log(pc.bold(`${kcal} kcal · ${protein} g`) + (m.note ? pc.dim(`  "${m.note.slice(0, 60)}"`) : ""));
        for (const it of m.items) console.log(`  ${pc.dim("·")} ${it.name}  ${pc.dim(`${it.kcal}/${Math.round(it.proteinG)}g`)}`);
      }
    }),
  );

// ---- measurements ----------------------------------------------------------
program
  .command("measure <site> <inches>")
  .description("Record a body measurement in inches (e.g. waist 32.5)")
  .option("--cm", "treat the value as centimetres instead of inches")
  .action(
    action(async (site: string, value: string, opts: { cm?: boolean }) => {
      const num = Number(value);
      if (!isFinite(num)) throw new Error(`not a number: ${value}`);
      const cm = opts.cm ? num : num * 2.54;
      await TelemetryClient.fromConfig().addMeasurement(site, cm);
      console.log(pc.green("✓ ") + `Recorded ${site} = ${opts.cm ? `${f1(cm)} cm` : `${f1(num)} in`}.`);
    }),
  );

// ---- targets ---------------------------------------------------------------
program
  .command("targets")
  .description("Show your goals")
  .action(
    action(async () => {
      const t = await TelemetryClient.fromConfig().targets();
      const lb = (kg: number | null) => (kg != null ? `${f1(toLb(kg))} lb` : "—");
      console.log(`${pc.dim("Goal weight".padEnd(14))}${lb(t.goalWeightKg)}`);
      console.log(`${pc.dim("Start weight".padEnd(14))}${lb(t.startWeightKg)}`);
      console.log(`${pc.dim("Daily kcal".padEnd(14))}${t.dailyKcalTarget ?? "—"}`);
      console.log(`${pc.dim("Protein/day".padEnd(14))}${t.proteinTargetG != null ? `${t.proteinTargetG} g` : "—"}`);
    }),
  );

program.parseAsync().catch((e) => {
  console.error(pc.red("✗ ") + (e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
});

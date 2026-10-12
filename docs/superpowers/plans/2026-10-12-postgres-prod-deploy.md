# Dual-Driver DB (SQLite Dev / Postgres Prod) + Vercel Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed Vercel app work correctly end-to-end (generate → evaluate → feedback → revise, with results persisting across requests) by adding a Postgres driver for production, while local development keeps using SQLite exactly as today.

**Architecture:** `src/lib/db/client.ts` picks a driver at runtime: if `DATABASE_URL` is set, it opens `node-postgres` (`pg`) against Neon Postgres and uses a Postgres-dialect schema (`schema.pg.ts`); otherwise it keeps using the existing `better-sqlite3` path unchanged. Because Postgres's Drizzle driver has no synchronous query methods, every function that calls `.all()`/`.get()`/`.run()` on a Drizzle query becomes `async`/`await` — this is the bulk of the work, spread across ~10 lib files and their callers (pages, routes, CLI commands). Drizzle's SQLite query builder is already thenable, so `await db.select()...` works unchanged against the existing SQLite driver too — no per-call-site branching needed.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM 0.45, `better-sqlite3` (existing, dev), `pg` + `@types/pg` (new, prod), Neon Postgres (provisioned via Vercel Marketplace, already connected to the `vryse-ai-blog-writing` Vercel project), `@vercel/functions` (`attachDatabasePool`), Vitest, Commander.js (CLI).

**Spec:** `docs/superpowers/specs/2026-10-12-postgres-prod-deploy-design.md`

## Global Constraints

- Local dev must keep working on SQLite with zero required config changes — no new env var is mandatory for `pnpm dev`/`pnpm vryse ...` to behave exactly as before.
- Driver selection is automatic: Postgres iff `process.env.DATABASE_URL` is set, SQLite otherwise. No new flag.
- DB migration scope is exactly the 8 Drizzle tables (`articles`, `profiles`, `runs`, `iterations`, `evaluations`, `feedback`, `memory`, `llm_calls`). The vector index (`data/index/*.json`) and style profiles (`data/profiles/*.json`) ship as bundled, read-only files — no code reads/writes them differently.
- Use `node-postgres` (`pg`) with `attachDatabasePool` from `@vercel/functions`, not `@neondatabase/serverless`/`neon-http` — per Neon's own Vercel guidance, the latter is for edge/one-shot runtimes.
- Use the **direct/unpooled** connection string (`DATABASE_URL_UNPOOLED`) for `drizzle-kit` migrations and the one-off data-seed script; use the **pooled** `DATABASE_URL` for the app's runtime queries.
- `pnpm typecheck` and `pnpm test` must pass throughout, run against SQLite (no `DATABASE_URL` set locally/in CI).
- `data/index/` must be un-gitignored and committed — currently excluded by `.gitignore:47`, which would break every live generation request (`loadIndex()` throws if the file is missing, with no fallback).
- No change to ingestion/profiling/index-build CLI commands' *outputs* — they still write SQLite + files locally exactly as today; only their internal DB calls become awaited.

## Review Focus

- **Fresh Postgres DB with no seed data run against the live site before the migration script runs**: every page that reads `runs`/`iterations` (`/`, `/runs/[id]`, `/runs/[id]/compare`) must render its "no runs yet" / "no evaluation" empty state cleanly, not throw, since the deployed app will briefly be empty between first deploy and the seed script running.
- **`DATABASE_URL` set but unreachable at build time** (e.g., Neon compute asleep, or the var briefly missing during a redeploy): `next build` must not crash — `getDb()` must lazily construct the pool inside the function body, never at module load/top level.
- **Budget cap (`assertWithinBudget`) still enforced correctly once async**: a run that reaches `VRYSE_BUDGET_USD` must still throw before the next paid LLM call, against both drivers — the await conversion must not accidentally swallow or race this check.
- **`ingestDirectory`'s transaction (delete + N inserts) stays atomic under Postgres**: Postgres transactions require an async callback (`db.transaction(async (tx) => ...)`), unlike SQLite's sync callback — a half-converted transaction would silently stop being atomic (e.g., delete commits without the following inserts if an insert throws and the rejection isn't awaited/propagated).
- **Existing Vitest suite (`tests/feedback/llm-steps.test.ts`) calling `memory.rememberInstructions`/`listMemory`/`forget` directly**: these become async; the test must `await` them or it will assert on a `Promise` object instead of the resolved array/value and pass trivially while testing nothing.

---

## File Structure

New files:
- `src/lib/db/schema.pg.ts` — Postgres-dialect Drizzle schema, same 8 tables as `schema.ts`.
- `drizzle.config.sqlite.ts` — renamed/retargeted from today's `drizzle.config.ts` (SQLite only).
- `drizzle.config.pg.ts` — new, targets `schema.pg.ts` + `DATABASE_URL_UNPOOLED`.
- `./drizzle-pg/` — generated Postgres migrations folder (parallel to existing `./drizzle`).
- `scripts/migrate-sqlite-to-pg.ts` — one-off data seed script, run manually, not part of the app.

Modified files:
- `src/lib/db/client.ts` — driver branch, lazy pool init, `attachDatabasePool`.
- `src/lib/config.ts` — add optional `DATABASE_URL`.
- `.env.example` — document `DATABASE_URL`.
- `next.config.ts` — `outputFileTracingIncludes` for `data/profiles/**` and `data/index/**`.
- `.gitignore` — un-ignore `/data/index/`.
- `package.json` — `db:generate` → sqlite-specific name, add `db:generate:pg`, `db:migrate:pg`; add `pg`, `@types/pg`, `@vercel/functions` deps.
- `src/lib/pipeline.ts`, `src/lib/export.ts`, `src/lib/ui/data.ts`, `src/lib/ingest/ingest.ts`, `src/lib/feedback/memory.ts`, `src/lib/analysis/stats.ts`, `src/lib/llm/call.ts` — sync → async conversions.
- `scripts/cli.ts` — `async` added to 4 action callbacks; `await` added at ~6 call sites.
- `src/app/page.tsx`, `src/app/memory/page.tsx`, `src/app/observability/page.tsx`, `src/app/runs/[id]/page.tsx`, `src/app/runs/[id]/compare/page.tsx` — `async`/`await` added.
- `tests/feedback/llm-steps.test.ts` — `await` added at 5 call sites.

---

### Task 1: Add the Postgres schema file and migration config

**Files:**
- Create: `src/lib/db/schema.pg.ts`
- Create: `drizzle.config.pg.ts`
- Modify: `drizzle.config.ts` → rename to `drizzle.config.sqlite.ts`
- Modify: `package.json` (scripts section)
- Test: manual verification (drizzle-kit generate output), no automated test for this task — it's pure schema/config, verified by the next task's migration run

**Interfaces:**
- Produces: `src/lib/db/schema.pg.ts` exports the same symbol names as `src/lib/db/schema.ts` (`articles`, `profiles`, `runs`, `iterations`, `evaluations`, `feedback`, `memory`, `llmCalls`), same column names, same TS types for `jsonb`/`timestamp`/`boolean` columns as the SQLite schema's `json`/`timestamp_ms`/`boolean` modes produce (so call sites can be dialect-agnostic later).

- [ ] **Step 1: Rename the existing SQLite drizzle config**

```bash
git mv drizzle.config.ts drizzle.config.sqlite.ts
```

- [ ] **Step 2: Update the renamed config's `out` path to stay `./drizzle` (unchanged) but confirm it still targets the SQLite schema**

Read `drizzle.config.sqlite.ts` and confirm it still reads:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.VRYSE_DB_PATH ?? "./data/vryse.db" },
});
```

No content change needed — this step only confirms the rename didn't alter it.

- [ ] **Step 3: Write `src/lib/db/schema.pg.ts`**

```ts
import { sql } from "drizzle-orm";
import { boolean, doublePrecision, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { mode: "date" }).notNull().defaultNow();

export const articles = pgTable("articles", {
  id: text("id").primaryKey(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  sourcePath: text("source_path").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  ast: jsonb("ast").notNull(),
  markdown: text("markdown").notNull(),
  contentHash: text("content_hash").notNull(),
  split: text("split", { enum: ["train", "test"] }).notNull().default("train"),
  createdAt: createdAt(),
});

export const profiles = pgTable("profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  company: text("company").notNull(),
  version: integer("version").notNull(),
  profile: jsonb("profile").notNull(),
  createdAt: createdAt(),
});

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  company: text("company").notNull(),
  brief: jsonb("brief").notNull(),
  profileVersion: integer("profile_version"),
  status: text("status").notNull().default("pending"),
  createdAt: createdAt(),
});

export const iterations = pgTable("iterations", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  version: integer("version").notNull(),
  parentIterationId: text("parent_iteration_id"),
  mode: text("mode", { enum: ["generate", "revise", "regenerate"] }).notNull(),
  outline: jsonb("outline"),
  markdown: text("markdown").notNull(),
  instructions: jsonb("instructions"),
  approved: boolean("approved").notNull().default(false),
  createdAt: createdAt(),
});

export const evaluations = pgTable("evaluations", {
  id: text("id").primaryKey(),
  iterationId: text("iteration_id")
    .notNull()
    .references(() => iterations.id),
  overall: doublePrecision("overall").notNull(),
  dimensions: jsonb("dimensions").notNull(),
  report: jsonb("report").notNull(),
  judgeModel: text("judge_model").notNull(),
  createdAt: createdAt(),
});

export const feedback = pgTable("feedback", {
  id: text("id").primaryKey(),
  iterationId: text("iteration_id")
    .notNull()
    .references(() => iterations.id),
  rating: integer("rating"),
  text: text("text"),
  sectionNotes: jsonb("section_notes"),
  selectedRecommendations: jsonb("selected_recommendations"),
  compiledInstructions: jsonb("compiled_instructions"),
  decision: text("decision", { enum: ["approve", "reject"] }),
  createdAt: createdAt(),
});

export const memory = pgTable("memory", {
  id: text("id").primaryKey(),
  company: text("company").notNull(),
  instruction: text("instruction").notNull(),
  sourceFeedbackId: text("source_feedback_id"),
  createdAt: createdAt(),
});

export const llmCalls = pgTable("llm_calls", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  stage: text("stage").notNull(),
  role: text("role").notNull(),
  model: text("model").notNull(),
  runId: text("run_id"),
  iterationId: text("iteration_id"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  latencyMs: integer("latency_ms").notNull(),
  costUsd: doublePrecision("cost_usd"),
  devCacheHit: boolean("dev_cache_hit").notNull().default(false),
  status: text("status", { enum: ["ok", "error"] }).notNull(),
  error: text("error"),
  generationId: text("generation_id"),
  createdAt: createdAt(),
});
```

Note: `sql` import from `drizzle-orm` is unused in this file (SQLite's version needed it for the `unixepoch()` default; Postgres uses `.defaultNow()` instead) — remove the `import { sql } ...` line if your editor flags it as unused.

- [ ] **Step 4: Write `drizzle.config.pg.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.pg.ts",
  out: "./drizzle-pg",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED! },
});
```

- [ ] **Step 5: Update `package.json` scripts**

Change:
```json
"db:generate": "drizzle-kit generate"
```
To:
```json
"db:generate": "drizzle-kit generate --config drizzle.config.sqlite.ts",
"db:generate:pg": "dotenv -e .env.local -- drizzle-kit generate --config drizzle.config.pg.ts",
"db:migrate:pg": "dotenv -e .env.local -- drizzle-kit migrate --config drizzle.config.pg.ts"
```

Add `dotenv-cli` to devDependencies (drizzle-kit doesn't auto-load `.env.local`):

```bash
pnpm add -D dotenv-cli
```

- [ ] **Step 6: Verify the SQLite config still works unchanged**

Run: `pnpm db:generate`
Expected: no new migration generated (schema unchanged), command exits 0. This confirms the rename + `--config` flag didn't break the existing SQLite migration path.

- [ ] **Step 7: Generate the Postgres migration**

Run: `pnpm db:generate:pg`
Expected: creates `./drizzle-pg/0000_<name>.sql` with `CREATE TABLE` statements for all 8 tables, plus a `./drizzle-pg/meta/` folder. Read the generated SQL file and confirm all 8 tables are present with the expected columns.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.pg.ts drizzle.config.pg.ts drizzle.config.sqlite.ts package.json pnpm-lock.yaml drizzle-pg/
git rm drizzle.config.ts 2>/dev/null || true
git commit -m "Add Postgres schema and migration config alongside existing SQLite config"
```

---

### Task 2: Run the Postgres migration against Neon and verify connectivity

**Files:**
- No file changes — this task applies the migration generated in Task 1 to the real database and confirms connectivity before any app code depends on it.
- Test: manual SQL verification via `psql`/Neon dashboard or a scratch script.

**Interfaces:**
- Consumes: `./drizzle-pg/*.sql` (Task 1), `DATABASE_URL_UNPOOLED` (already in `.env.local` from Neon provisioning).
- Produces: a live Neon Postgres database with all 8 tables created, confirmed reachable, for Task 3+ to seed and Task 5+ to query.

- [ ] **Step 1: Confirm `DATABASE_URL_UNPOOLED` is present**

Run: `grep DATABASE_URL_UNPOOLED .env.local`
Expected: a `postgresql://...@ep-....c-14.us-east-1.aws.neon.tech/neondb?sslmode=require` URL (no `-pooler` in the hostname).

- [ ] **Step 2: Apply the migration**

Run: `pnpm db:migrate:pg`
Expected: output confirms the migration applied (drizzle-kit reports the migration as applied, no errors).

- [ ] **Step 3: Verify tables exist**

Run:
```bash
pnpm dotenv -e .env.local -- node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
c.connect().then(() => c.query(\"select table_name from information_schema.tables where table_schema='public' order by 1\")).then(r => { console.log(r.rows.map(x => x.table_name)); return c.end(); });
"
```
(This requires `pg` to be installed first — if Task 3 hasn't run yet, `pnpm add pg @types/pg @vercel/functions` first, then run this verification, then proceed to Task 3 which formalizes that dependency add.)

Expected output: an array containing all 8 table names: `articles`, `evaluations`, `feedback`, `iterations`, `llm_calls`, `memory`, `profiles`, `runs`.

- [ ] **Step 4: No commit for this task** (no file changes — purely an infrastructure verification step)

---

### Task 3: Add the Postgres driver to `src/lib/db/client.ts`

**Files:**
- Modify: `src/lib/db/client.ts`
- Modify: `src/lib/config.ts`
- Modify: `.env.example`
- Modify: `package.json` (dependencies)
- Test: `tests/db/client.test.ts` (new)

**Interfaces:**
- Consumes: `schema.pg.ts` (Task 1, exports `articles`, `profiles`, `runs`, `iterations`, `evaluations`, `feedback`, `memory`, `llmCalls`), `getConfig()` (existing, `src/lib/config.ts`).
- Produces: `getDb(): Db` where `Db = BetterSQLite3Database<typeof sqliteSchema> | NodePgDatabase<typeof pgSchema>`. Every later task that calls `getDb()` gets back whichever driver is active; both expose `.select()`, `.insert()`, `.update()`, `.delete()`, `.transaction()` with the same chainable query-builder shape, callable via `await` on both.

- [ ] **Step 1: Install new dependencies**

```bash
pnpm add pg @vercel/functions
pnpm add -D @types/pg
```

- [ ] **Step 2: Add `DATABASE_URL` to the config schema**

In `src/lib/config.ts`, add inside `EnvSchema`:

```ts
DATABASE_URL: unsetIfEmpty(z.string().optional()),
```

(Place it near `VRYSE_DB_PATH` for readability — exact position doesn't matter, Zod object key order isn't significant.)

- [ ] **Step 3: Document it in `.env.example`**

Add near the `VRYSE_DB_PATH` line in `.env.example`:

```
# Set automatically by the Neon Vercel integration in production/preview.
# When set, the app uses Postgres instead of the local SQLite file below.
DATABASE_URL=
```

- [ ] **Step 4: Write the failing test first**

Create `tests/db/client.test.ts`:

```ts
import { describe, expect, it, afterEach } from "vitest";

describe("getDb driver selection", () => {
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    vi.resetModules();
  });

  it("uses the sqlite driver when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { getDb } = await import("@/lib/db/client");
    const db = getDb();
    // better-sqlite3's drizzle instance exposes a `.$client` with a `.pragma` method; pg's does not.
    expect(typeof (db as unknown as { $client: { pragma?: unknown } }).$client.pragma).toBe("function");
  });
});
```

Add `import { vi } from "vitest";` to the top of the file alongside the existing import.

- [ ] **Step 2: Run it to verify it fails (or passes trivially before the client is modified)**

Run: `pnpm vitest run tests/db/client.test.ts`
Expected: PASS already, since `DATABASE_URL` is unset in the test env and the current client is SQLite-only — this test is a regression guard for Step 6, not a red/green TDD step on its own. Proceed to modify the client, then re-run this test plus a manually-verified Postgres-path check in Step 7.

- [ ] **Step 5: Rewrite `src/lib/db/client.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { getConfig } from "@/lib/config";
import * as sqliteSchema from "./schema";
import * as pgSchema from "./schema.pg";

export type Db = BetterSQLite3Database<typeof sqliteSchema> | NodePgDatabase<typeof pgSchema>;

let db: Db | undefined;

function openSqlite(): BetterSQLite3Database<typeof sqliteSchema> {
  const dbPath = path.resolve(getConfig().VRYSE_DB_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("busy_timeout = 5000");
  // Rollback journal, not WAL: the web server and short-lived CLI processes share this file, and in WAL
  // mode a long-running dev server kept a stale view of the database after CLI runs wrote to it.
  // The one-time switch can fail if another connection is mid-switch (seen as "disk I/O error" when the
  // dev server opened two connections at once); the database still works in WAL, so carry on.
  if (sqlite.pragma("journal_mode", { simple: true }) === "wal") {
    try {
      sqlite.pragma("journal_mode = DELETE");
    } catch (error) {
      console.warn(`[vryse] Could not switch the database out of WAL mode yet: ${error instanceof Error ? error.message : error}`);
    }
  }
  sqlite.pragma("foreign_keys = ON");
  const instance = drizzleSqlite(sqlite, { schema: sqliteSchema });
  migrateSqlite(instance, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  return instance;
}

async function openPostgres(databaseUrl: string): Promise<NodePgDatabase<typeof pgSchema>> {
  const pool = new Pool({ connectionString: databaseUrl });
  attachDatabasePool(pool);
  const instance = drizzlePg(pool, { schema: pgSchema });
  await migratePg(instance, { migrationsFolder: path.resolve(process.cwd(), "drizzle-pg") });
  return instance;
}

/**
 * Opens the database and applies pending migrations on first use.
 * Postgres (Neon, via DATABASE_URL) in production; local SQLite file otherwise.
 */
export async function getDbAsync(): Promise<Db> {
  if (db) return db;
  const databaseUrl = process.env.DATABASE_URL;
  db = databaseUrl ? await openPostgres(databaseUrl) : openSqlite();
  return db;
}

/** Synchronous accessor for the already-open DB. Call `getDbAsync()` once per process first (Next.js routes/pages and CLI commands do this via their entry points). */
export function getDb(): Db {
  if (!db) throw new Error("Database not initialized. Call getDbAsync() before getDb().");
  return db;
}
```

Note: this introduces a two-step init (`getDbAsync()` once, then synchronous `getDb()` everywhere else) because migration itself is async for Postgres but all ~30 existing call sites use the synchronous `getDb()` name. Re-evaluate in Step 6 below whether this split is actually necessary — see the alternative.

- [ ] **Step 6: Simplify — single async `getDb()`, no split**

On reflection, the two-function split in Step 5 adds a second thing every caller must remember to do first. Since Task 4+ is already converting every `getDb()` call site to be inside an `async` function and to `await` its query results, it costs nothing extra to also `await getDb()` itself at the same call sites. Replace the bottom of the file from Step 5 with a single function:

```ts
export async function getDb(): Promise<Db> {
  if (db) return db;
  const databaseUrl = process.env.DATABASE_URL;
  db = databaseUrl ? await openPostgres(databaseUrl) : openSqlite();
  return db;
}
```

Delete `getDbAsync`. Every call site becomes `const db = await getDb();` instead of `const db = getDb();` — this is folded into the mechanical conversion in Tasks 4–8 below (each of those tasks' steps already add `await` at `getDb()` call sites; this just means the `await` goes on `getDb()` itself too, not only on the query that follows it).

- [ ] **Step 7: Update the test for the async signature**

Rewrite `tests/db/client.test.ts`:

```ts
import { describe, expect, it, afterEach, vi } from "vitest";

describe("getDb driver selection", () => {
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    vi.resetModules();
  });

  it("uses the sqlite driver when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { getDb } = await import("@/lib/db/client");
    const db = await getDb();
    expect(typeof (db as unknown as { $client: { pragma?: unknown } }).$client.pragma).toBe("function");
  });
});
```

- [ ] **Step 8: Run the test**

Run: `pnpm vitest run tests/db/client.test.ts`
Expected: PASS.

- [ ] **Step 9: Manually verify the Postgres path**

Run:
```bash
pnpm dotenv -e .env.local -- tsx -e "
import { getDb } from './src/lib/db/client';
getDb().then(async (db) => {
  console.log('driver OK, $client has query:', typeof (db as any).\$client.query === 'function');
  process.exit(0);
});
"
```
Expected: prints `driver OK, $client has query: true` with no errors, confirming the Postgres branch connects and migrates successfully against the real Neon DB (Task 2's tables already exist, so this just re-confirms migration state and connectivity — drizzle-kit's migrator is idempotent and no-ops if already applied).

- [ ] **Step 10: Commit**

```bash
git add src/lib/db/client.ts src/lib/config.ts .env.example package.json pnpm-lock.yaml tests/db/client.test.ts
git commit -m "Add Postgres driver to getDb(), selected via DATABASE_URL"
```

Note: this commit intentionally leaves every existing caller of `getDb()` broken (it's now async-returning instead of sync-returning) — Tasks 4–8 fix every caller. Run `pnpm typecheck` now to get the full, precise list of what's broken (expected to fail) before starting Task 4; use that output as a checklist.

---

### Task 4: Convert `src/lib/pipeline.ts` to async-safe DB calls

**Files:**
- Modify: `src/lib/pipeline.ts`
- Test: existing `tests/` files that exercise `runGeneration`/`runRevision`/`evaluateIteration` (run as regression check; no new test file needed since behavior is unchanged, only the calling convention)

**Interfaces:**
- Consumes: `getDb(): Promise<Db>` (Task 3).
- Produces: `saveEvaluation`, `loadIterationContext`, `latestEvaluation`, `latestVersion` all become `async` and return `Promise<...>` of what they returned before. `evaluateIteration`, `runGeneration`, `runRevision`, `compileForRun` keep their existing signatures (already async) but now correctly `await` their internal DB calls.

- [ ] **Step 1: Convert `saveEvaluation` (around line 72)**

Change:
```ts
export function saveEvaluation(iterationId: string, evaluation: EvaluationResult) {
  const { dimensions, lint: _lint, ...report } = evaluation; // eslint-disable-line @typescript-eslint/no-unused-vars
  getDb()
    .insert(evaluations)
    .values({ id: randomUUID(), iterationId, overall: evaluation.overall, dimensions, report, judgeModel: evaluation.judge.model })
    .run();
}
```
To:
```ts
export async function saveEvaluation(iterationId: string, evaluation: EvaluationResult) {
  const { dimensions, lint: _lint, ...report } = evaluation; // eslint-disable-line @typescript-eslint/no-unused-vars
  const db = await getDb();
  await db
    .insert(evaluations)
    .values({ id: randomUUID(), iterationId, overall: evaluation.overall, dimensions, report, judgeModel: evaluation.judge.model });
}
```

- [ ] **Step 2: Convert `loadIterationContext` (around line 81)**

Change:
```ts
export function loadIterationContext(runId: string, version?: number) {
  const db = getDb();
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) throw new Error(`No run ${runId}`);
  const all = db.select().from(iterations).where(eq(iterations.runId, runId)).all();
  ...
```
To:
```ts
export async function loadIterationContext(runId: string, version?: number) {
  const db = await getDb();
  const run = (await db.select().from(runs).where(eq(runs.id, runId)))[0];
  if (!run) throw new Error(`No run ${runId}`);
  const all = await db.select().from(iterations).where(eq(iterations.runId, runId));
  ...
```
(The rest of the function body is unchanged — `all`, `wanted`, `iteration`, `profile`, `index`, `meta`, `chunkIds`, `sources` all stay as-is since they don't call `.get()`/`.all()` again. Change the `return` statement's type only insofar as the function is now `async` — callers already `await` it per later steps.)

- [ ] **Step 3: Convert `evaluateIteration` (around line 98) to await the now-async helpers**

Change:
```ts
export async function evaluateIteration(runId: string, version = 1, opts: { judgeRuns?: number } = {}): Promise<EvaluationResult> {
  const ctx = loadIterationContext(runId, version);
  const evaluation = await evaluateArticle(...);
  saveEvaluation(ctx.iteration.id, evaluation);
  ...
```
To:
```ts
export async function evaluateIteration(runId: string, version = 1, opts: { judgeRuns?: number } = {}): Promise<EvaluationResult> {
  const ctx = await loadIterationContext(runId, version);
  const evaluation = await evaluateArticle(...);
  await saveEvaluation(ctx.iteration.id, evaluation);
  ...
```

- [ ] **Step 4: Convert `runGeneration` (around line 110) — add `await` to every DB call**

Line-by-line changes within the existing `async function runGeneration`:
- `const db = getDb();` → `const db = await getDb();`
- `db.insert(runs).values({...}).run();` → `await db.insert(runs).values({...});`
- `db.insert(iterations).values({...}).run();` → `await db.insert(iterations).values({...});`
- `saveEvaluation(iterationId, evaluation);` → `await saveEvaluation(iterationId, evaluation);`
- `db.update(runs).set({ status: "evaluated" }).where(eq(runs.id, runId)).run();` → `await db.update(runs).set({ status: "evaluated" }).where(eq(runs.id, runId));`
- `const [{ cost }] = db.select({...}).from(llmCalls).where(eq(llmCalls.runId, runId)).all();` → `const [{ cost }] = await db.select({...}).from(llmCalls).where(eq(llmCalls.runId, runId));`
- In the `catch` block: `db.update(runs).set({ status: "failed" }).where(eq(runs.id, runId)).run();` → `await db.update(runs).set({ status: "failed" }).where(eq(runs.id, runId));`

- [ ] **Step 5: Convert `latestEvaluation` (around line 218)**

Change:
```ts
export function latestEvaluation(iterationId: string) {
  const row = getDb().select().from(evaluations).where(eq(evaluations.iterationId, iterationId)).orderBy(desc(evaluations.createdAt)).limit(1).get();
  if (!row) return null;
  ...
```
To:
```ts
export async function latestEvaluation(iterationId: string) {
  const db = await getDb();
  const rows = await db.select().from(evaluations).where(eq(evaluations.iterationId, iterationId)).orderBy(desc(evaluations.createdAt)).limit(1);
  const row = rows[0];
  if (!row) return null;
  ...
```

- [ ] **Step 6: Convert `latestVersion` (around line 225)**

Change:
```ts
const latestVersion = (runId: string) =>
  Math.max(...getDb().select({ v: iterations.version }).from(iterations).where(eq(iterations.runId, runId)).all().map((r) => r.v));
```
To:
```ts
const latestVersion = async (runId: string) => {
  const db = await getDb();
  const rows = await db.select({ v: iterations.version }).from(iterations).where(eq(iterations.runId, runId));
  return Math.max(...rows.map((r) => r.v));
};
```

- [ ] **Step 7: Convert `runRevision` (around line 232) — add `await` to every DB call and helper call**

Within the existing `async function runRevision`:
- `const fromVersion = input.fromVersion ?? latestVersion(input.runId);` → `const fromVersion = input.fromVersion ?? (await latestVersion(input.runId));`
- `const ctx = loadIterationContext(input.runId, fromVersion);` → `const ctx = await loadIterationContext(input.runId, fromVersion);`
- `const stored = latestEvaluation(ctx.iteration.id);` → `const stored = await latestEvaluation(ctx.iteration.id);`
- `const db = getDb();` → `const db = await getDb();`
- `db.insert(feedbackTable).values({...}).run();` → `await db.insert(feedbackTable).values({...});`
- `db.insert(iterations).values({...}).run();` → `await db.insert(iterations).values({...});`
- `saveEvaluation(iterationId, evaluation);` → `await saveEvaluation(iterationId, evaluation);`
- `db.update(runs).set({ status: "revised" }).where(eq(runs.id, input.runId)).run();` → `await db.update(runs).set({ status: "revised" }).where(eq(runs.id, input.runId));`
- `const version = latestVersion(input.runId) + 1;` → `const version = (await latestVersion(input.runId)) + 1;`
- `const [{ cost }] = db.select({...}).from(llmCalls).where(and(...)).all();` → `const [{ cost }] = await db.select({...}).from(llmCalls).where(and(...));`

- [ ] **Step 8: Convert `compileForRun` (around line 359) — add `await` to its calls**

It calls `loadIterationContext` and `latestEvaluation` — add `await` to both call sites, matching the pattern above.

- [ ] **Step 9: Run typecheck to catch anything missed in this file**

Run: `pnpm typecheck`
Expected: errors remaining only in files not yet converted (export.ts, ui/data.ts, ingest.ts, feedback/memory.ts, analysis/stats.ts, analysis/profile.ts, llm/call.ts, scripts/cli.ts, the app pages) — zero errors originating from `pipeline.ts` itself.

- [ ] **Step 10: Commit**

```bash
git add src/lib/pipeline.ts
git commit -m "Convert pipeline.ts DB calls to async/await"
```

---

### Task 5: Convert `src/lib/llm/call.ts`, `src/lib/feedback/memory.ts`, `src/lib/analysis/stats.ts`, `src/lib/analysis/profile.ts`

**Files:**
- Modify: `src/lib/llm/call.ts`
- Modify: `src/lib/feedback/memory.ts`
- Modify: `src/lib/analysis/stats.ts`
- Modify: `src/lib/analysis/profile.ts`
- Test: `tests/feedback/llm-steps.test.ts` (update existing calls to `await`)

**Interfaces:**
- Consumes: `getDb(): Promise<Db>` (Task 3).
- Produces: `logCall`, `assertWithinBudget` become `async` (internal to `call.ts`, not exported — no external interface change). `listMemory`, `rememberInstructions`, `forget` become `async`, same return shapes wrapped in `Promise`. `buildCorpusStats` becomes `async`. `buildProfile` (already async) now correctly awaits its internal DB calls.

- [ ] **Step 1: Convert `logCall` in `src/lib/llm/call.ts` (around line 62)**

Change:
```ts
function logCall(opts: CallOptions, model: string, entry: {...}) {
  getDb()
    .insert(llmCalls)
    .values({...})
    .run();
}
```
To:
```ts
async function logCall(opts: CallOptions, model: string, entry: {...}) {
  const db = await getDb();
  await db.insert(llmCalls).values({...});
}
```

- [ ] **Step 2: Convert `assertWithinBudget` (around line 92)**

Change:
```ts
function assertWithinBudget() {
  const budget = getConfig().VRYSE_BUDGET_USD;
  const [{ spent }] = getDb().select({ spent: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` }).from(llmCalls).all();
  if (spent >= budget) {
    throw new Error(`Budget reached: $${spent.toFixed(2)} of $${budget.toFixed(2)} spent. Raise VRYSE_BUDGET_USD in .env.local to continue.`);
  }
}
```
To:
```ts
async function assertWithinBudget() {
  const budget = getConfig().VRYSE_BUDGET_USD;
  const db = await getDb();
  const [{ spent }] = await db.select({ spent: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` }).from(llmCalls);
  if (spent >= budget) {
    throw new Error(`Budget reached: $${spent.toFixed(2)} of $${budget.toFixed(2)} spent. Raise VRYSE_BUDGET_USD in .env.local to continue.`);
  }
}
```

- [ ] **Step 3: Update `invoke` in the same file to await the now-async helpers**

In the cache-hit branch: `logCall(opts, name, { latencyMs: 0, costUsd: 0, devCacheHit: true });` → `await logCall(opts, name, { latencyMs: 0, costUsd: 0, devCacheHit: true });`

Before `const model = ...`: `assertWithinBudget();` → `await assertWithinBudget();`

Inside `attempt`'s try block: `logCall(opts, name, {...});` → `await logCall(opts, name, {...});`

Inside `attempt`'s catch block: `logCall(opts, name, {...});` → `await logCall(opts, name, {...});`

(`invoke` is already `async`, so no signature change — only `await` additions at these 4 call sites.)

- [ ] **Step 4: Run the budget-cap regression test**

Check for an existing test covering `assertWithinBudget`/budget enforcement:

Run: `grep -rl "VRYSE_BUDGET_USD\|Budget reached" tests/`

If a test exists, run it now (`pnpm vitest run <that file>`) and confirm it still passes with the `await` added — this is the Review Focus item on budget enforcement staying correct. If no such test exists, write one in `tests/llm/call.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

describe("assertWithinBudget", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws once logged spend reaches the budget", async () => {
    process.env.VRYSE_BUDGET_USD = "0.01";
    process.env.VRYSE_DEV_CACHE = "false";
    const { callText } = await import("@/lib/llm/call");
    // First call under budget should log $0 cost in test doubles / mocked model paths used elsewhere in the suite;
    // reuse whatever model-mocking convention the existing llm tests use (check tests/ for a mock LanguageModel pattern)
    // rather than inventing a new one here.
  });
});
```

Note: if no existing mock convention is found, skip writing a new test for this step and instead rely on Step 5's `tests/feedback/llm-steps.test.ts` run plus a manual CLI check (`pnpm vryse cost` after a real run) as the regression signal — don't invent a mocking pattern that diverges from the rest of the suite.

- [ ] **Step 5: Convert `src/lib/feedback/memory.ts`**

Change:
```ts
export function listMemory(company: string) {
  return getDb().select().from(memory).where(eq(memory.company, company)).orderBy(asc(memory.createdAt)).all();
}
```
To:
```ts
export async function listMemory(company: string) {
  const db = await getDb();
  return db.select().from(memory).where(eq(memory.company, company)).orderBy(asc(memory.createdAt));
}
```

Change:
```ts
export function rememberInstructions(company: string, instructions: RevisionInstruction[], sourceFeedbackId?: string): string[] {
  const known = new Set(listMemory(company).map((m) => norm(m.instruction)));
  const added: string[] = [];
  for (const i of instructions.filter((x) => x.persist)) {
    if (known.has(norm(i.instruction))) continue;
    getDb().insert(memory).values({ id: randomUUID(), company, instruction: i.instruction, sourceFeedbackId }).run();
    known.add(norm(i.instruction));
    added.push(i.instruction);
  }
  return added;
}
```
To:
```ts
export async function rememberInstructions(company: string, instructions: RevisionInstruction[], sourceFeedbackId?: string): Promise<string[]> {
  const db = await getDb();
  const known = new Set((await listMemory(company)).map((m) => norm(m.instruction)));
  const added: string[] = [];
  for (const i of instructions.filter((x) => x.persist)) {
    if (known.has(norm(i.instruction))) continue;
    await db.insert(memory).values({ id: randomUUID(), company, instruction: i.instruction, sourceFeedbackId });
    known.add(norm(i.instruction));
    added.push(i.instruction);
  }
  return added;
}
```

Change:
```ts
export function forget(id: string) {
  getDb().delete(memory).where(eq(memory.id, id)).run();
}
```
To:
```ts
export async function forget(id: string) {
  const db = await getDb();
  await db.delete(memory).where(eq(memory.id, id));
}
```

- [ ] **Step 6: Convert `src/lib/analysis/stats.ts`**

Change:
```ts
export function buildCorpusStats(company: string, brandTerms: string[]) {
  const rows = getDb().select({...}).from(articles).where(...).all();
  ...
```
To:
```ts
export async function buildCorpusStats(company: string, brandTerms: string[]) {
  const db = await getDb();
  const rows = await db.select({...}).from(articles).where(...);
  ...
```
(`saveCorpusStats` in the same file has no DB call — leave it unchanged.)

- [ ] **Step 7: Convert the DB calls inside `src/lib/analysis/profile.ts`'s `buildProfile`**

This function is already `async`. Add `await` and remove `.all()`/`.run()` at each of its DB call sites:
- `const db = getDb();` → `const db = await getDb();`
- each `db.select(...).all()` → `await db.select(...)`
- `db.insert(profiles).values(...).run();` → `await db.insert(profiles).values(...);`

Also update its call to `buildCorpusStats` (now async): `const stats = buildCorpusStats(...)` → `const stats = await buildCorpusStats(...)`.

- [ ] **Step 8: Update `tests/feedback/llm-steps.test.ts`**

Change lines 141–149 from:
```ts
memory.rememberInstructions("acme", [instruction("I1", { persist: true, instruction: "Never use em dashes" }), instruction("I2")]);
memory.rememberInstructions("acme", [instruction("I3", { persist: true, instruction: "never use em dashes" })]);
expect(memory.listMemory("acme").map((m) => m.instruction)).toEqual(["Never use em dashes"]);
```
and
```ts
const [entry] = memory.listMemory("acme");
memory.forget(entry.id);
expect(memory.listMemory("acme")).toEqual([]);
```
To:
```ts
await memory.rememberInstructions("acme", [instruction("I1", { persist: true, instruction: "Never use em dashes" }), instruction("I2")]);
await memory.rememberInstructions("acme", [instruction("I3", { persist: true, instruction: "never use em dashes" })]);
expect((await memory.listMemory("acme")).map((m) => m.instruction)).toEqual(["Never use em dashes"]);
```
and
```ts
const [entry] = await memory.listMemory("acme");
await memory.forget(entry.id);
expect(await memory.listMemory("acme")).toEqual([]);
```

Confirm the enclosing `it(...)` blocks are already `async` (Vitest test bodies using `await` must be declared `async (...) => {...}` — check and add if missing).

- [ ] **Step 9: Run the test**

Run: `pnpm vitest run tests/feedback/llm-steps.test.ts`
Expected: PASS.

- [ ] **Step 10: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors originating from `call.ts`, `memory.ts`, `stats.ts`, `profile.ts`, or `tests/feedback/llm-steps.test.ts`.

- [ ] **Step 11: Commit**

```bash
git add src/lib/llm/call.ts src/lib/feedback/memory.ts src/lib/analysis/stats.ts src/lib/analysis/profile.ts tests/feedback/llm-steps.test.ts
git commit -m "Convert llm/call, feedback/memory, analysis/stats, analysis/profile to async DB calls"
```

---

### Task 6: Convert `src/lib/export.ts`, `src/lib/ui/data.ts`, `src/lib/ingest/ingest.ts`

**Files:**
- Modify: `src/lib/export.ts`
- Modify: `src/lib/ui/data.ts`
- Modify: `src/lib/ingest/ingest.ts`
- Test: manual CLI smoke test (no existing automated test directly covers these — see Step 7)

**Interfaces:**
- Consumes: `getDb(): Promise<Db>` (Task 3), `latestEvaluation` (now async, Task 4).
- Produces: `exportRun`, `listRuns`, `getRunView`, `costSummary` become `async`. `ingestDirectory` (already async) now uses an async transaction callback.

- [ ] **Step 1: Convert `exportRun` in `src/lib/export.ts` (around line 74)**

Change:
```ts
export function exportRun(runId: string, outDir: string): { files: string[] } {
  const db = getDb();
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) throw new Error(`No run ${runId}`);
  const brief = run.brief as ResolvedBrief;
  const its = db.select().from(iterations).where(eq(iterations.runId, runId)).all().sort((a, b) => a.version - b.version);
  fs.mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  const write = (name: string, content: string) => {
    fs.writeFileSync(path.join(outDir, name), content);
    files.push(name);
  };

  write("brief.json", JSON.stringify(brief, null, 2));
  const versions: SummaryInput["versions"] = [];
  const revisions: SummaryInput["revisions"] = [];
  for (const it of its) {
    write(`v${it.version}.md`, it.markdown);
    const e = latestEvaluation(it.id);
    if (e) {
      write(`v${it.version}.evaluation.json`, JSON.stringify(e, null, 2));
      const words = extractFeatures(markdownToBlocks(it.markdown), { brandTerms: [] }).wordCount;
      versions.push({ version: it.version, overall: e.overall, dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, e.dimensions[d].score])) as Record<Dimension, number>, words, judgeRuns: e.judge.runs });
    }
    const r = readRevision(runId, it.version);
    if (r) {
      write(`v${it.version}.revision.json`, JSON.stringify(r, null, 2));
      const before = its.find((x) => x.version === r.fromVersion)!;
      write(`diff-v${r.fromVersion}-v${it.version}.diff`, createTwoFilesPatch(`v${r.fromVersion}.md`, `v${it.version}.md`, before.markdown, it.markdown));
      revisions.push({ version: it.version, fromVersion: r.fromVersion, feedback: r.feedback.text, instructions: r.instructions, verification: r.verification, verdict: r.verdict });
    }
  }
  const [{ cost }] = db.select({ cost: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` }).from(llmCalls).where(eq(llmCalls.runId, runId)).all();
  write("README.md", renderSummary({ brief, versions, revisions, cost }));
  return { files };
}
```
To:
```ts
export async function exportRun(runId: string, outDir: string): Promise<{ files: string[] }> {
  const db = await getDb();
  const runRows = await db.select().from(runs).where(eq(runs.id, runId));
  const run = runRows[0];
  if (!run) throw new Error(`No run ${runId}`);
  const brief = run.brief as ResolvedBrief;
  const its = (await db.select().from(iterations).where(eq(iterations.runId, runId))).sort((a, b) => a.version - b.version);
  fs.mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  const write = (name: string, content: string) => {
    fs.writeFileSync(path.join(outDir, name), content);
    files.push(name);
  };

  write("brief.json", JSON.stringify(brief, null, 2));
  const versions: SummaryInput["versions"] = [];
  const revisions: SummaryInput["revisions"] = [];
  for (const it of its) {
    write(`v${it.version}.md`, it.markdown);
    const e = await latestEvaluation(it.id);
    if (e) {
      write(`v${it.version}.evaluation.json`, JSON.stringify(e, null, 2));
      const words = extractFeatures(markdownToBlocks(it.markdown), { brandTerms: [] }).wordCount;
      versions.push({ version: it.version, overall: e.overall, dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, e.dimensions[d].score])) as Record<Dimension, number>, words, judgeRuns: e.judge.runs });
    }
    const r = readRevision(runId, it.version);
    if (r) {
      write(`v${it.version}.revision.json`, JSON.stringify(r, null, 2));
      const before = its.find((x) => x.version === r.fromVersion)!;
      write(`diff-v${r.fromVersion}-v${it.version}.diff`, createTwoFilesPatch(`v${r.fromVersion}.md`, `v${it.version}.md`, before.markdown, it.markdown));
      revisions.push({ version: it.version, fromVersion: r.fromVersion, feedback: r.feedback.text, instructions: r.instructions, verification: r.verification, verdict: r.verdict });
    }
  }
  const [{ cost }] = await db.select({ cost: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` }).from(llmCalls).where(eq(llmCalls.runId, runId));
  write("README.md", renderSummary({ brief, versions, revisions, cost }));
  return { files };
}
```
(`readRevision` is file-based, not DB, confirmed earlier, so it stays sync and unawaited.)

- [ ] **Step 2: Convert `src/lib/ui/data.ts`'s `listRuns`, `getRunView`, `costSummary`**

Change:
```ts
export function listRuns() {
  const db = getDb();
  return db
    .select()
    .from(runs)
    .orderBy(desc(runs.createdAt))
    .all()
    .map((run) => {
      const its = db.select().from(iterations).where(eq(iterations.runId, run.id)).all().sort((a, b) => a.version - b.version);
      const scores = its.map((i) => latestEvaluation(i.id)?.overall ?? null);
      return {...};
    })
    .filter((r) => r.versions > 0);
}
```
To:
```ts
export async function listRuns() {
  const db = await getDb();
  const allRuns = await db.select().from(runs).orderBy(desc(runs.createdAt));
  const withScores = await Promise.all(
    allRuns.map(async (run) => {
      const its = (await db.select().from(iterations).where(eq(iterations.runId, run.id))).sort((a, b) => a.version - b.version);
      const scores = await Promise.all(its.map(async (i) => (await latestEvaluation(i.id))?.overall ?? null));
      return { id: run.id, company: run.company, topic: (run.brief as ResolvedBrief).topic, status: run.status, createdAt: run.createdAt, versions: its.length, scores };
    }),
  );
  return withScores.filter((r) => r.versions > 0);
}
```

Change:
```ts
export function getRunView(runId: string, version?: number) {
  const db = getDb();
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) return null;
  const its = db.select().from(iterations).where(eq(iterations.runId, runId)).all().sort((a, b) => a.version - b.version);
  if (!its.length) return null;
  const current = its.find((i) => i.version === version) ?? its[its.length - 1];
  return {
    run,
    brief: run.brief as ResolvedBrief,
    versions: its.map((i) => ({ version: i.version, mode: i.mode, overall: latestEvaluation(i.id)?.overall ?? null })),
    current,
    evaluation: latestEvaluation(current.id),
    revision: readRevision(runId, current.version),
  };
}
```
To:
```ts
export async function getRunView(runId: string, version?: number) {
  const db = await getDb();
  const runRows = await db.select().from(runs).where(eq(runs.id, runId));
  const run = runRows[0];
  if (!run) return null;
  const its = (await db.select().from(iterations).where(eq(iterations.runId, runId))).sort((a, b) => a.version - b.version);
  if (!its.length) return null;
  const current = its.find((i) => i.version === version) ?? its[its.length - 1];
  const versions = await Promise.all(its.map(async (i) => ({ version: i.version, mode: i.mode, overall: (await latestEvaluation(i.id))?.overall ?? null })));
  return {
    run,
    brief: run.brief as ResolvedBrief,
    versions,
    current,
    evaluation: await latestEvaluation(current.id),
    revision: readRevision(runId, current.version),
  };
}
```

Change:
```ts
export function costSummary() {
  const db = getDb();
  const byStage = db.select({...}).from(llmCalls).groupBy(...).orderBy(...).all();
  const [{ total }] = db.select({...}).from(llmCalls).all();
  const evaluated = db.select({...}).from(evaluations).all()[0].n;
  return { byStage, total, budget: getConfig().VRYSE_BUDGET_USD, evaluated };
}
```
To:
```ts
export async function costSummary() {
  const db = await getDb();
  const byStage = await db.select({...}).from(llmCalls).groupBy(...).orderBy(...);
  const [{ total }] = await db.select({...}).from(llmCalls);
  const evaluatedRows = await db.select({...}).from(evaluations);
  const evaluated = evaluatedRows[0].n;
  return { byStage, total, budget: getConfig().VRYSE_BUDGET_USD, evaluated };
}
```

(`listCompanies` and `readProfile` in the same file have no DB calls — confirmed earlier — leave unchanged.)

- [ ] **Step 3: Convert the transaction in `src/lib/ingest/ingest.ts`'s `ingestDirectory` (around line 103)**

Change:
```ts
const db = getDb();
db.transaction((tx) => {
  tx.delete(articles).where(eq(articles.company, company)).run();
  for (const a of final) {
    tx.insert(articles)
      .values({...})
      .run();
  }
});
```
To:
```ts
const db = await getDb();
await db.transaction(async (tx) => {
  await tx.delete(articles).where(eq(articles.company, company));
  for (const a of final) {
    await tx.insert(articles).values({...});
  }
});
```

This is the Review Focus item on transaction atomicity: `drizzle-orm/node-postgres`'s `db.transaction()` requires (and only accepts) an async callback; `better-sqlite3`'s accepts a sync callback but — confirmed by Drizzle's API — also accepts returning a Promise from a sync-looking callback correctly as of the version in use here (sync driver transactions execute the callback and await any returned promise before committing). Verify this explicitly in Step 4 below rather than assuming.

- [ ] **Step 4: Verify the SQLite transaction still commits atomically with an async callback**

Run:
```bash
pnpm tsx -e "
import { getDb } from './src/lib/db/client';
import { articles } from './src/lib/db/schema';
import { eq } from 'drizzle-orm';
getDb().then(async (db) => {
  await db.transaction(async (tx) => {
    await tx.delete(articles).where(eq(articles.company, '__txtest__'));
    await tx.insert(articles).values({ id: '__txtest__-1', company: '__txtest__', title: 't', sourcePath: 'p', ast: [], markdown: 'm', contentHash: 'h' });
  });
  const rows = await db.select().from(articles).where(eq(articles.company, '__txtest__'));
  console.log('rows after commit:', rows.length);
  await db.delete(articles).where(eq(articles.company, '__txtest__'));
  process.exit(0);
});
"
```
Expected: `rows after commit: 1`, confirming the async transaction callback commits correctly against the local SQLite driver (no `DATABASE_URL` set, so this exercises the SQLite path). This is a throwaway manual check, not a permanent test file — clean up the temp data as the script already does.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors originating from `export.ts`, `ui/data.ts`, or `ingest/ingest.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/export.ts src/lib/ui/data.ts src/lib/ingest/ingest.ts
git commit -m "Convert export.ts, ui/data.ts, ingest.ts to async DB calls"
```

---

### Task 7: Update `scripts/cli.ts` callers

**Files:**
- Modify: `scripts/cli.ts`
- Test: manual CLI smoke test (Step 5)

**Interfaces:**
- Consumes: all functions converted in Tasks 4–6 (now async).
- Produces: no new interface — CLI behavior is unchanged, only its internal `await`ing is corrected.

- [ ] **Step 1: Add `async` + `await` to the `profile stats` action (around line 105)**

Change:
```ts
.action((opts: { company: string; brand?: string }) => {
  const brandTerms = (opts.brand ?? opts.company).split(",").map((s) => s.trim()).filter(Boolean);
  const { perArticle, ...stats } = buildCorpusStats(opts.company, brandTerms);
  ...
```
To:
```ts
.action(async (opts: { company: string; brand?: string }) => {
  const brandTerms = (opts.brand ?? opts.company).split(",").map((s) => s.trim()).filter(Boolean);
  const { perArticle, ...stats } = await buildCorpusStats(opts.company, brandTerms);
  ...
```

- [ ] **Step 2: Add `async` + `await` to the `weaknesses` action (around line 229)**

Change:
```ts
.action((opts: { run: string; version?: string }) => {
  const ctx = loadIterationContext(opts.run, opts.version ? Number(opts.version) : undefined);
  const e = latestEvaluation(ctx.iteration.id);
  ...
```
To:
```ts
.action(async (opts: { run: string; version?: string }) => {
  const ctx = await loadIterationContext(opts.run, opts.version ? Number(opts.version) : undefined);
  const e = await latestEvaluation(ctx.iteration.id);
  ...
```

- [ ] **Step 3: Add `async` + `await` to the `export` action (around line 277)**

Change:
```ts
.action((opts: { run: string; out: string }) => {
  const { files } = exportRun(opts.run, opts.out);
  ...
```
To:
```ts
.action(async (opts: { run: string; out: string }) => {
  const { files } = await exportRun(opts.run, opts.out);
  ...
```

- [ ] **Step 4: Add `async` + `await` to the `memory` action (around line 287)**

Change:
```ts
.action((opts: { company: string; forget?: string }) => {
  if (opts.forget) forget(opts.forget);
  const items = listMemory(opts.company);
  ...
```
To:
```ts
.action(async (opts: { company: string; forget?: string }) => {
  if (opts.forget) await forget(opts.forget);
  const items = await listMemory(opts.company);
  ...
```

- [ ] **Step 5: Convert `noise` action's call to `loadIterationContext` (around line 301, already an async action)**

Find the `loadIterationContext(...)` call inside the existing `async (opts) => {...}` body for `noise` and add `await` before it.

- [ ] **Step 6: Convert the `cost` command's inline DB query (around lines 352–364)**

Change:
```ts
const rows = getDb()
  .select({...})
  .from(llmCalls)
  .groupBy(llmCalls.stage, llmCalls.model)
  .all();
```
To:
```ts
const db = await getDb();
const rows = await db
  .select({...})
  .from(llmCalls)
  .groupBy(llmCalls.stage, llmCalls.model);
```
(`cost`'s action callback is already `async`.)

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: zero errors remaining anywhere in `scripts/cli.ts`.

- [ ] **Step 8: Manual CLI smoke test**

Run: `pnpm vryse memory --company routematic` (or whatever company slug exists in local dev data per `data/profiles/`)
Expected: prints saved preferences (or "No saved preferences.") with no runtime error, confirming the SQLite path works through the newly-async CLI action.

Run: `pnpm vryse cost`
Expected: prints the cost table with no runtime error.

- [ ] **Step 9: Commit**

```bash
git add scripts/cli.ts
git commit -m "Await the now-async lib calls in CLI command actions"
```

---

### Task 8: Update React pages (`src/app/**`)

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/memory/page.tsx`
- Modify: `src/app/observability/page.tsx`
- Modify: `src/app/runs/[id]/page.tsx`
- Modify: `src/app/runs/[id]/compare/page.tsx`
- Test: manual browser smoke test (Step 6) — this plan's app has no existing component/route tests to extend (confirmed: `tests/` only covers `src/lib/**`)

**Interfaces:**
- Consumes: `listRuns`, `listMemory`, `forget`, `costSummary`, `getRunView`, `latestEvaluation` — all async per Tasks 4–6.
- Produces: no change to page props/exports visible to Next.js routing; only internal data-fetching becomes properly awaited.

- [ ] **Step 1: Convert `src/app/page.tsx`**

Change:
```ts
export default function Home() {
  const runs = listRuns();
  ...
```
To:
```ts
export default async function Home() {
  const runs = await listRuns();
  ...
```

- [ ] **Step 2: Convert `src/app/memory/page.tsx`**

Full current file:
```tsx
import { revalidatePath } from "next/cache";
import { Button } from "@/components/ui/button";
import { forget, listMemory } from "@/lib/feedback/memory";
import { listCompanies } from "@/lib/ui/data";

export const dynamic = "force-dynamic";

async function remove(form: FormData) {
  "use server";
  forget(String(form.get("id")));
  revalidatePath("/memory");
}

export default function MemoryPage() {
  const companies = listCompanies();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
        <p className="text-sm text-muted-foreground">General rules from your feedback (&quot;never…&quot;, &quot;always…&quot;). They are applied to every future article for the company.</p>
      </div>
      {companies.map((company) => {
        const items = listMemory(company);
        return (
          <section key={company} className="rounded-xl border p-5">
            <h2 className="mb-3 font-semibold capitalize">{company}</h2>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved rules yet.</p>
            ) : (
              <ul className="divide-y">
                {items.map((m) => (
                  <li key={m.id} className="flex items-center gap-4 py-2 text-sm">
                    <span className="flex-1">{m.instruction}</span>
                    <span className="text-xs text-muted-foreground">{m.createdAt.toLocaleDateString()}</span>
                    <form action={remove}>
                      <input type="hidden" name="id" value={m.id} />
                      <Button type="submit" size="sm" variant="ghost">Delete</Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

Replace the `remove` action and default export with:
```tsx
async function remove(form: FormData) {
  "use server";
  await forget(String(form.get("id")));
  revalidatePath("/memory");
}

export default async function MemoryPage() {
  const companies = listCompanies();
  const companiesWithMemory = await Promise.all(
    companies.map(async (company) => ({ company, items: await listMemory(company) })),
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
        <p className="text-sm text-muted-foreground">General rules from your feedback (&quot;never…&quot;, &quot;always…&quot;). They are applied to every future article for the company.</p>
      </div>
      {companiesWithMemory.map(({ company, items }) => (
        <section key={company} className="rounded-xl border p-5">
          <h2 className="mb-3 font-semibold capitalize">{company}</h2>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved rules yet.</p>
          ) : (
            <ul className="divide-y">
              {items.map((m) => (
                <li key={m.id} className="flex items-center gap-4 py-2 text-sm">
                  <span className="flex-1">{m.instruction}</span>
                  <span className="text-xs text-muted-foreground">{m.createdAt.toLocaleDateString()}</span>
                  <form action={remove}>
                    <input type="hidden" name="id" value={m.id} />
                    <Button type="submit" size="sm" variant="ghost">Delete</Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Convert `src/app/observability/page.tsx`**

Change:
```ts
export default function UsagePage() {
  const data = costSummary();
  ...
```
To:
```ts
export default async function UsagePage() {
  const data = await costSummary();
  ...
```

- [ ] **Step 4: Update `src/app/runs/[id]/page.tsx`**

This component is already `export default async function`. Find the `getRunView(...)` call and add `await`.

- [ ] **Step 5: Update `src/app/runs/[id]/compare/page.tsx`**

Already `export default async function`. Find the two `getRunView(...)` calls and two `latestEvaluation(...)` calls; add `await` to all four.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: zero errors anywhere in the project. This is the first point where the full conversion is verified end-to-end by the compiler.

- [ ] **Step 7: Manual browser smoke test against local SQLite**

Run: `pnpm dev`, then in a browser visit `/`, `/memory`, `/observability`, and (if any run exists locally) `/runs/<id>` and `/runs/<id>/compare`.
Expected: every page renders without error, showing the same data as before this plan's changes (confirm against `git stash` + reload if in doubt about baseline appearance, then `git stash pop`).

- [ ] **Step 8: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/app/page.tsx src/app/memory/page.tsx src/app/observability/page.tsx "src/app/runs/[id]/page.tsx" "src/app/runs/[id]/compare/page.tsx"
git commit -m "Await the now-async lib calls in page components"
```

---

### Task 9: File bundling for read-only reference data

**Files:**
- Modify: `.gitignore`
- Modify: `next.config.ts`
- Test: manual build inspection (Step 4)

**Interfaces:**
- Consumes: existing `data/index/*.json`, `data/profiles/*.json` files already on disk from local `pnpm vryse ingest|profile|index build` runs.
- Produces: these files committed to git and included in the Next.js build output trace, so they're present in the deployed bundle.

- [ ] **Step 1: Un-ignore the index directory**

In `.gitignore`, remove the line `/data/index/` (currently line 47).

- [ ] **Step 2: Commit the existing index files**

```bash
git add data/index/
git status
```
Confirm the `git status` output shows the expected `data/index/<company>.json` files being added (one per ingested company — check `data/profiles/` for the company list first: `ls data/profiles/*.json`).

- [ ] **Step 3: Add `outputFileTracingIncludes` to `next.config.ts`**

Read the current `next.config.ts` first (it's small per earlier inspection — a `NextConfig` object). Add:

```ts
const nextConfig: NextConfig = {
  // ...existing config...
  outputFileTracingIncludes: {
    "/": ["./data/profiles/**", "./data/index/**"],
    "/articles/new": ["./data/profiles/**"],
    "/company/[slug]": ["./data/profiles/**"],
    "/runs/[id]": ["./data/profiles/**", "./data/index/**"],
    "/runs/[id]/compare": ["./data/profiles/**", "./data/index/**"],
  },
};
```

Merge this into the existing config object structure rather than replacing it — read the file's current export shape first.

- [ ] **Step 4: Verify the build includes the files**

Run: `pnpm build`
Expected: build succeeds. Then check the trace output:

```bash
find .next/server -iname "*.nft.json" | xargs grep -l "data/index" | head -3
```
Expected: at least one `.nft.json` (Next.js file trace) file references `data/index`, confirming the files are tracked for inclusion in the deployment bundle.

- [ ] **Step 5: Commit**

```bash
git add .gitignore data/index/ next.config.ts
git commit -m "Bundle the retrieval index and style profiles for deployment"
```

---

### Task 10: Seed Postgres with existing local data

**Files:**
- Create: `scripts/migrate-sqlite-to-pg.ts`
- Test: manual row-count verification (Step 4) — this is a one-off operational script, not app code, so no Vitest test is written for it

**Interfaces:**
- Consumes: the local `data/vryse.db` SQLite file (read directly via `better-sqlite3`, not through `getDb()`, since this script needs to read SQLite specifically regardless of `DATABASE_URL`), the Postgres schema from Task 1.
- Produces: all 8 tables in Neon populated with the current local dev data.

- [ ] **Step 1: Write the migration script**

```ts
// scripts/migrate-sqlite-to-pg.ts
// One-off: copies all rows from the local SQLite dev DB into Neon Postgres.
// Run manually: pnpm dotenv -e .env.local -- tsx scripts/migrate-sqlite-to-pg.ts
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as sqliteSchema from "../src/lib/db/schema";
import * as pgSchema from "../src/lib/db/schema.pg";

async function main() {
  const sqlite = new Database(process.env.VRYSE_DB_PATH ?? "./data/vryse.db");
  const source = drizzleSqlite(sqlite, { schema: sqliteSchema });

  const databaseUrl = process.env.DATABASE_URL_UNPOOLED;
  if (!databaseUrl) throw new Error("Set DATABASE_URL_UNPOOLED (direct Neon connection) before running this script.");
  const pool = new Pool({ connectionString: databaseUrl });
  const target = drizzlePg(pool, { schema: pgSchema });

  // Dependency order: articles/profiles have no FKs to the others; runs before iterations;
  // iterations before evaluations/feedback; memory and llm_calls are independent.
  const articles = source.select().from(sqliteSchema.articles).all();
  if (articles.length) await target.insert(pgSchema.articles).values(articles);
  console.log(`articles: ${articles.length}`);

  const profiles = source.select().from(sqliteSchema.profiles).all();
  if (profiles.length) await target.insert(pgSchema.profiles).values(profiles.map(({ id: _id, ...p }) => p)); // let Postgres assign new identity ids
  console.log(`profiles: ${profiles.length}`);

  const runs = source.select().from(sqliteSchema.runs).all();
  if (runs.length) await target.insert(pgSchema.runs).values(runs);
  console.log(`runs: ${runs.length}`);

  const iterations = source.select().from(sqliteSchema.iterations).all();
  if (iterations.length) await target.insert(pgSchema.iterations).values(iterations);
  console.log(`iterations: ${iterations.length}`);

  const evaluations = source.select().from(sqliteSchema.evaluations).all();
  if (evaluations.length) await target.insert(pgSchema.evaluations).values(evaluations);
  console.log(`evaluations: ${evaluations.length}`);

  const feedback = source.select().from(sqliteSchema.feedback).all();
  if (feedback.length) await target.insert(pgSchema.feedback).values(feedback);
  console.log(`feedback: ${feedback.length}`);

  const memory = source.select().from(sqliteSchema.memory).all();
  if (memory.length) await target.insert(pgSchema.memory).values(memory);
  console.log(`memory: ${memory.length}`);

  const llmCalls = source.select().from(sqliteSchema.llmCalls).all();
  if (llmCalls.length) await target.insert(pgSchema.llmCalls).values(llmCalls.map(({ id: _id, ...c }) => c)); // let Postgres assign new identity ids
  console.log(`llm_calls: ${llmCalls.length}`);

  await pool.end();
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm dotenv -e .env.local -- tsx scripts/migrate-sqlite-to-pg.ts`
Expected: prints a row count per table, all matching (or close to) the counts visible in local SQLite, no errors. If a foreign-key error occurs (e.g., an `iterations` row referencing a `runId` not yet inserted), check the insert order matches the dependency order in Step 1's comment — it's already ordered correctly, so this would indicate a data integrity issue in the source SQLite DB worth investigating rather than papering over.

- [ ] **Step 3: Spot-check row counts match**

Run against SQLite:
```bash
sqlite3 data/vryse.db "select count(*) from runs; select count(*) from iterations; select count(*) from evaluations;"
```
Run against Postgres:
```bash
pnpm dotenv -e .env.local -- node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
c.connect().then(() => c.query('select (select count(*) from runs) as runs, (select count(*) from iterations) as iterations, (select count(*) from evaluations) as evaluations')).then(r => { console.log(r.rows[0]); return c.end(); });
"
```
Expected: counts match between the two outputs.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-sqlite-to-pg.ts
git commit -m "Add one-off script to seed Neon Postgres from local SQLite data"
```

---

### Task 11: Deploy to Vercel and verify

**Files:** none — this task is operational, not code changes.

**Interfaces:** none new.

- [ ] **Step 1: Confirm `DATABASE_URL` is set for the Preview and Production environments**

Run: `vercel env ls`
Expected: `DATABASE_URL` listed for `production`, `preview`, and `development` (Neon's Vercel integration sets it for all three by default, confirmed during provisioning in this conversation).

- [ ] **Step 2: Push all commits from Tasks 1–10 to the GitHub remote**

```bash
git push origin main
```

- [ ] **Step 3: Deploy a preview build first**

Run: `vercel`
Expected: build succeeds, preview URL printed. If the build fails, fetch logs with `vercel logs <preview-url>` and check for errors related to `pg`/`better-sqlite3` native bindings or missing `DATABASE_URL` at build time (should not happen, since `getDb()` is lazy per Task 3 — if it does happen, that's a regression to fix before proceeding, not something to work around).

- [ ] **Step 4: Smoke-test the preview deployment**

Visit the preview URL. Confirm:
- `/` loads and shows the seeded runs from Task 10 (or the empty state if seeding hasn't run against this environment's DB yet — Neon's Vercel integration may provision one DB shared across preview/production via the same `DATABASE_URL`, or per-environment URLs; confirm which via `vercel env ls` output and re-run Task 10's seed script against whichever `DATABASE_URL_UNPOOLED` preview actually uses, if different from the one already seeded).
- `/articles/new` loads and shows the style-profile-derived defaults (confirms `data/profiles/` bundling from Task 9 worked).
- Start a new generation run end-to-end: submit a brief, confirm it completes and shows an evaluation (confirms the Postgres write path, the bundled vector index read path, and the AI Gateway call path all work together).
- On that new run, submit feedback and trigger a revision; confirm the revised version and updated evaluation appear and the comparison page (`/runs/[id]/compare`) renders both versions.

- [ ] **Step 5: Promote to production**

Only after Step 4 passes cleanly: run `vercel --prod`, then repeat the Step 4 smoke test against the production URL.

- [ ] **Step 6: No commit for this task** (operational deployment steps only).

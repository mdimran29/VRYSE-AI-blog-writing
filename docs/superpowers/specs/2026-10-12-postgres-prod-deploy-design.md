# Dual-driver DB: SQLite dev / Postgres prod, then deploy to Vercel

## Goal

Deploy the app to Vercel so the full generate → evaluate → feedback → revise workflow works correctly in production, without touching the existing local SQLite dev setup.

## Context

The app's data layer (`src/lib/db/client.ts`, `src/lib/db/schema.ts`) uses `better-sqlite3` against a single file (`./data/vryse.db`). Vercel's serverless filesystem is ephemeral outside `/tmp`, so this file would reset on every cold start — any run, iteration, evaluation, or feedback created in production would vanish. ~10 files across the app (`pipeline.ts`, `ui/data.ts`, `ingest.ts`, `retrieval/store.ts`, `feedback/memory.ts`, `analysis/stats.ts`, `analysis/profile.ts`, `evaluation/calibrate.ts`, `llm/call.ts`, `export.ts`) call `getDb()` and use SQLite-only sync methods (`.all()`, `.get()`, `.run()`).

Separately, the app reads two kinds of pre-built, read-only reference data straight from disk at request time: the retrieval vector index (`data/index/<company>.json`) and style profiles (`data/profiles/<company>.json`, via `src/lib/ui/data.ts`). These are built offline by CLI commands (`pnpm vryse ingest|profile|index build`) and never written to from a web request path. They are out of scope for the DB migration — they ship as bundled, read-only files in the deployment.

Decisions already made with the user:
- Local dev stays on SQLite, completely unchanged.
- Production (Vercel) uses Postgres, chosen automatically when `DATABASE_URL` is set — no new flag.
- DB migration scope is the 8 Drizzle tables only (`articles`, `profiles`, `runs`, `iterations`, `evaluations`, `feedback`, `memory`, `llm_calls`). Vector index / profiles / LLM dev-cache stay as files.
- Neon Postgres is already provisioned via Vercel Marketplace and connected to the `vryse-ai-blog-writing` project (org `mdimran29s-projects`). `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) are in `.env.local`.
- Per Neon's own Vercel guidance, the driver for Vercel specifically is `node-postgres` (`pg`) + Vercel Fluid Compute's `attachDatabasePool`, not `@neondatabase/serverless`/`neon-http` (that one is for edge/one-shot runtimes like Netlify). This supersedes the `neon-http` driver originally proposed in discussion.

## Approach

### 1. Schema: add a parallel Postgres schema file

Keep `src/lib/db/schema.ts` (SQLite) untouched — it stays the source of truth for local dev and its existing migrations in `./drizzle`.

Add `src/lib/db/schema.pg.ts`: the same 8 tables expressed with `pgTable`. Column mapping:
- `integer(..., {mode:"timestamp_ms"})` → `timestamp("created_at", { mode: "date" }).notNull().defaultNow()`
- `integer(..., {mode:"boolean"})` → `boolean(...)`
- `text(..., {mode:"json"})` → `jsonb(...)`
- `text(..., {enum:[...]})` → keep as `text` with the same TS union type (Drizzle supports `enum` on pg `text` the same way); no native Postgres enum type, to avoid a second migration path for adding values later
- `real(...)` → `doublePrecision(...)`
- Primary keys / foreign keys / defaults: same structure, pg syntax

New migrations folder: `./drizzle-pg`, generated fresh via `drizzle-kit generate` against `schema.pg.ts`.

### 2. `drizzle.config.ts`: split into two configs

Replace the single config with two files (`drizzle.config.sqlite.ts`, `drizzle.config.pg.ts`), since `drizzle-kit` config is dialect-specific. The Postgres config points `dbCredentials.url` at `DATABASE_URL_UNPOOLED` (direct connection — required for migrations per Neon's guidance; the pooled PgBouncer connection doesn't support the session-level operations migrations need). Update `package.json`'s `db:generate` script and add `db:generate:pg` / `db:migrate:pg`.

### 3. `src/lib/db/client.ts`: branch on `DATABASE_URL`

```ts
export function getDb(): Db {
  if (db) return db;
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzlePg(pool, { schema: pgSchema });
    // migrate via drizzle-orm/node-postgres/migrator, migrationsFolder: ./drizzle-pg
  } else {
    // existing better-sqlite3 path, unchanged
  }
  return db;
}
```

`Db` becomes a union type (`BetterSQLite3Database<...> | NodePgDatabase<...>`). Per Neon's Vercel guidance, use `attachDatabasePool` from `@vercel/functions` so the pool is reused across invocations under Fluid Compute instead of reconnecting per request. Lazy-init only (no top-level `new Pool()` at module scope), so `next build` never touches `DATABASE_URL` and can't crash if it's briefly unset.

### 4. Call-site changes: sync → async

Confirmed by testing: Drizzle's SQLite query builder is thenable — `await db.select().from(t)` already works against the existing `better-sqlite3` driver and returns the same rows `.all()` does. Postgres's builder has no sync methods at all. So the plan is:

- Replace every `.all()` / `.get()` / `.run()` call with `await` on the bare query (drop the trailing method).
- Mark every function that calls `getDb()` and wasn't already `async` as `async`, and add `await` at each of its call sites, cascading up through callers (page components, API route handlers, CLI command actions). Next.js Server Components, route handlers, and the CLI's Commander action handlers all already support async natively — this is additive, not structural.
- No branching logic needed per call site: the same `await db.select()...` line works unchanged against both drivers.

Files touched: `pipeline.ts`, `export.ts`, `ui/data.ts`, `ingest/ingest.ts`, `retrieval/store.ts`, `feedback/memory.ts`, `analysis/stats.ts`, `analysis/profile.ts`, `evaluation/calibrate.ts`, `llm/call.ts`, plus their callers.

### 5. Data migration (seed Postgres from current SQLite data)

One-off script (`scripts/migrate-sqlite-to-pg.ts`, run manually, not part of the app): opens the existing `better-sqlite3` file directly, reads all rows from all 8 tables in dependency order (`articles`, `profiles` → `runs` → `iterations` → `evaluations`/`feedback` → `memory`, `llm_calls`), inserts into Postgres via the new `node-postgres` client. Run once against the real Neon DB before first deploy, so the demo doesn't start empty.

### 6. Config

Add `DATABASE_URL` (optional) to `src/lib/config.ts`'s `EnvSchema` and `.env.example`. `VRYSE_DB_PATH` stays as-is (still used by the SQLite path). No new required env var for existing local dev.

### 7. Dependencies

Add `pg`, `@types/pg`, `@vercel/functions` (for `attachDatabasePool`). Keep `better-sqlite3` (still used locally). `better-sqlite3` is a native addon — Vercel's build environment compiles native deps during `next build` the same way any Node host does, and since the Postgres path is what actually runs in production, `better-sqlite3` being present but unused at runtime in prod is harmless (no code path imports it unless `DATABASE_URL` is unset).

### 8. Vercel: file bundling for read-only reference data

`data/profiles/*.json` and `data/index/*.json` must be included in the deployed bundle (they're read via `fs.readFileSync(path.resolve(getConfig().VRYSE_DATA_DIR, ...))` at request time, not imported, so Next.js's static analysis won't auto-trace them).

Checked: `data/profiles/` is already tracked in git. `data/index/` is currently **gitignored** (`.gitignore:47`) — this must be fixed, or the deployed app throws `"No retrieval index for ..."` on every generation request, since `loadIndex()` has no fallback. Action: remove `/data/index/` from `.gitignore` and commit the existing `data/index/*.json` files. Leave `/data/raw/`, `/data/processed/`, `/data/runs/`, `/data/*.db*`, `/data/.llm-cache/`, `/data/.models/` ignored — those are either source material, SQLite-only runtime state, or caches, none of which the deployed app reads.

Then add `outputFileTracingIncludes` in `next.config.ts` for the routes that read these files (`/`, `/articles/new`, `/company/[slug]`, `/runs/[id]`, `/runs/[id]/compare`), pointing at `data/profiles/**` and `data/index/**`.

### 9. Deploy

1. Run `drizzle-kit generate` against `schema.pg.ts` → commit `./drizzle-pg`.
2. Run migrations against Neon (direct URL).
3. Run the seed script against Neon.
4. `vercel env pull` to confirm `DATABASE_URL` is set for Production/Preview (Neon integration sets it for all environments by default).
5. `vercel --prod` (or preview first, verify, then promote).
6. Post-deploy: load the deployed URL, run through generate → evaluate → feedback → revise once to confirm the full loop works against Postgres.

## Testing

- `pnpm typecheck` and `pnpm test` must pass unchanged (they run against SQLite locally — no `DATABASE_URL` set in CI/test env).
- Before deploying: run the CLI pipeline locally with `DATABASE_URL` pointed at the real Neon DB (`DATABASE_URL=... pnpm vryse ingest ...` etc. through to `pnpm dev` with the same env) to exercise the Postgres path end-to-end before it's live.
- After deploying: smoke-test the full feedback loop on the live URL per step 9.6 above.

## Out of scope

- Moving the vector index or LLM dev-cache into Postgres/Blob — these stay as local-build, bundled, read-only files.
- Any change to the ingestion/profiling/index-build CLI commands — they remain local-only, writing to SQLite + files, exactly as today.
- Removing `better-sqlite3` or unifying on a single driver — explicitly rejected; dual-driver is intentional so local dev is never put at risk.

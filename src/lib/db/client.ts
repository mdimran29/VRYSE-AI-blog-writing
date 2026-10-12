import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getConfig } from "@/lib/config";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

let db: Db | undefined;

/** Opens the SQLite database and applies pending migrations on first use. */
export function getDb(): Db {
  if (db) return db;
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
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  return db;
}

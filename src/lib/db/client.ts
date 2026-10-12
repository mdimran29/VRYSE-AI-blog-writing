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
  // Rollback journal, not WAL: the web server and short-lived CLI processes share this file, and in WAL
  // mode a long-running dev server kept a stale view of the database after CLI runs wrote to it.
  // (The switch only takes effect when no other process has the database open.)
  sqlite.pragma("journal_mode = DELETE");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  return db;
}

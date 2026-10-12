import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function cacheKey(parts: unknown): string {
  return createHash("sha256").update(stableStringify(parts)).digest("hex");
}

export function readCache<T>(dir: string, key: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function writeCache(dir: string, key: string, value: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(value));
}

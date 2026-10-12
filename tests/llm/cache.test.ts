import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cacheKey, readCache, writeCache } from "@/lib/llm/cache";

describe("cacheKey", () => {
  it("ignores object key order", () => {
    expect(cacheKey({ a: 1, b: { c: 2, d: 3 } })).toBe(cacheKey({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("changes when any value changes", () => {
    expect(cacheKey({ prompt: "x" })).not.toBe(cacheKey({ prompt: "y" }));
  });

  it("returns a sha256 hex digest", () => {
    expect(cacheKey("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("readCache / writeCache", () => {
  it("round-trips a value and misses on unknown keys", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vryse-cache-"));
    writeCache(dir, "k1", { output: { ok: true } });
    expect(readCache(dir, "k1")).toEqual({ output: { ok: true } });
    expect(readCache(dir, "missing")).toBeUndefined();
  });
});

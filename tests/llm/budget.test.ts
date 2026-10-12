import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vryse-budget-"));
process.env.VRYSE_DB_PATH = path.join(tmp, "test.db");
process.env.VRYSE_DATA_DIR = tmp;
process.env.VRYSE_BUDGET_USD = "1";

let calls = 0;
const model = new MockLanguageModelV4({
  doGenerate: async () => {
    calls++;
    return {
      content: [{ type: "text", text: '{"ok":true}' }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    };
  },
});
const schema = z.object({ ok: z.boolean() });

let call: typeof import("@/lib/llm/call");
let db: typeof import("@/lib/db/client");
let tables: typeof import("@/lib/db/schema");
beforeAll(async () => {
  call = await import("@/lib/llm/call");
  db = await import("@/lib/db/client");
  tables = await import("@/lib/db/schema");
});

describe("spending cap", () => {
  it("allows calls while logged spend is under the budget", async () => {
    await expect(call.callObject({ stage: "t", role: "analysis", model, instructions: "i", prompt: "under", schema, cache: false })).resolves.toBeDefined();
  });

  it("refuses new model calls once logged spend reaches the budget, without calling the model", async () => {
    db.getDb().insert(tables.llmCalls).values({ stage: "past", role: "writer", model: "x", latencyMs: 1, costUsd: 1.2, status: "ok" }).run();
    const before = calls;
    await expect(call.callObject({ stage: "t", role: "analysis", model, instructions: "i", prompt: "over", schema, cache: false })).rejects.toThrow(/budget/i);
    expect(calls).toBe(before);
  });

  it("still serves cached answers, which cost nothing", async () => {
    // Cached before the budget was reached in a fresh key, then requested again after.
    db.getDb().delete(tables.llmCalls).run();
    await call.callObject({ stage: "t", role: "analysis", model, instructions: "i", prompt: "cached", schema, cache: true, cacheModelKey: "m" });
    db.getDb().insert(tables.llmCalls).values({ stage: "past", role: "writer", model: "x", latencyMs: 1, costUsd: 5, status: "ok" }).run();
    await expect(call.callObject({ stage: "t", role: "analysis", model, instructions: "i", prompt: "cached", schema, cache: true, cacheModelKey: "m" })).resolves.toBeDefined();
  });
});

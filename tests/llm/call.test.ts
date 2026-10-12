import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { desc } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vryse-call-"));
process.env.VRYSE_DB_PATH = path.join(tmp, "test.db");
process.env.VRYSE_DATA_DIR = tmp;
process.env.VRYSE_DEV_CACHE = "true";

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

function mockModel(texts: string[]) {
  let i = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: texts[Math.min(i++, texts.length - 1)] }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });
  return { model, calls: () => i };
}

const Schema = z.object({ status: z.literal("ok"), message: z.string() });

let mod: typeof import("@/lib/llm/call");
let db: typeof import("@/lib/db/client");
let schema: typeof import("@/lib/db/schema");

beforeAll(async () => {
  mod = await import("@/lib/llm/call");
  db = await import("@/lib/db/client");
  schema = await import("@/lib/db/schema");
});

function lastCall() {
  return db.getDb().select().from(schema.llmCalls).orderBy(desc(schema.llmCalls.id)).limit(1).get();
}

describe("callObject", () => {
  it("returns validated output and logs the call", async () => {
    const { model } = mockModel(['{"status":"ok","message":"hello"}']);
    const result = await mod.callObject({
      stage: "test",
      role: "analysis",
      model,
      instructions: "sys",
      prompt: "p1",
      schema: Schema,
    });
    expect(result.output).toEqual({ status: "ok", message: "hello" });
    const row = lastCall();
    expect(row?.stage).toBe("test");
    expect(row?.status).toBe("ok");
    expect(row?.inputTokens).toBe(100);
    expect(row?.outputTokens).toBe(20);
    expect(row?.devCacheHit).toBe(false);
  });

  it("retries once when the output fails validation", async () => {
    const { model, calls } = mockModel(['{"status":"nope"}', '{"status":"ok","message":"fixed"}']);
    const result = await mod.callObject({
      stage: "test-retry",
      role: "analysis",
      model,
      instructions: "sys",
      prompt: "p2",
      schema: Schema,
      cache: false,
    });
    expect(result.output.message).toBe("fixed");
    expect(calls()).toBe(2);
  });

  it("logs an error row and throws when the retry also fails", async () => {
    const { model } = mockModel(['{"status":"nope"}']);
    await expect(
      mod.callObject({ stage: "test-fail", role: "analysis", model, instructions: "sys", prompt: "p3", schema: Schema, cache: false }),
    ).rejects.toThrow();
    const row = lastCall();
    expect(row?.stage).toBe("test-fail");
    expect(row?.status).toBe("error");
    expect(row?.error).toBeTruthy();
  });

  it("serves a repeated identical call from the dev cache", async () => {
    const first = mockModel(['{"status":"ok","message":"cached"}']);
    const args = { stage: "test-cache", role: "analysis" as const, instructions: "sys", prompt: "same", schema: Schema, cacheModelKey: "mock/model" };
    await mod.callObject({ ...args, model: first.model });
    const second = mockModel(['{"status":"ok","message":"should-not-be-used"}']);
    const result = await mod.callObject({ ...args, model: second.model });
    expect(result.output.message).toBe("cached");
    expect(second.calls()).toBe(0);
    expect(lastCall()?.devCacheHit).toBe(true);
  });
});

describe("callText", () => {
  it("returns plain text", async () => {
    const { model } = mockModel(["# Title\n\nBody"]);
    const result = await mod.callText({ stage: "test-text", role: "writer", model, instructions: "sys", prompt: "p4", cache: false });
    expect(result.text).toBe("# Title\n\nBody");
  });
});

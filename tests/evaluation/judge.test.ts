import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import type { ResolvedBrief } from "@/lib/schemas/generation";
import { testProfile } from "../fixtures/profile";
import { judgeFixture } from "../fixtures/judge";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vryse-judge-"));
process.env.VRYSE_DB_PATH = path.join(tmp, "test.db");
process.env.VRYSE_DATA_DIR = tmp;

function capturingModel(output: unknown) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, prompts };
}

const brief: ResolvedBrief = { company: "acme", topic: "EV fleets", audience: "x", targetWords: 1500, keyPoints: ["KEYPOINT-MARKER"], requiredSections: [] };

let judge: typeof import("@/lib/evaluation/judge");
beforeAll(async () => {
  judge = await import("@/lib/evaluation/judge");
});

describe("judgeArticle", () => {
  it("sends the rubric, house style, brief, sources and article, and returns the validated result", async () => {
    const { model, prompts } = capturingModel(judgeFixture);
    const source = { id: "s", articleId: "a", articleTitle: "Ref", role: "body" as const, heading: "H", markdown: "SOURCE-MARKER\n", words: 1 };
    const result = await judge.judgeArticle({ markdown: "# ARTICLE-MARKER", brief, profile: testProfile, sources: [source] }, { model });
    expect(result.dimensions.style.score).toBe(4);
    for (const marker of ["anchors", "DO-RULE-MARKER", "KEYPOINT-MARKER", "SOURCE-MARKER", "ARTICLE-MARKER"]) expect(prompts[0]).toContain(marker);
    expect(prompts[0]).not.toMatch(/v\d|version \d|revised/i);
  });
});

describe("comparePair", () => {
  const pair = { first: "# FIRST", second: "# SECOND", brief, profile: testProfile };

  it("maps the judge's A/B answer back to the caller's order", async () => {
    // random() < 0.5 → the first draft is shown as A
    const asA = capturingModel({ winner: "A", confidence: 4, reasons: ["r"] });
    expect(await judge.comparePair(pair, { model: asA.model, random: () => 0.1 })).toMatchObject({ winner: "first", order: "first-as-A" });

    // random() ≥ 0.5 → the second draft is shown as A, so an "A" verdict means the second won
    const swapped = capturingModel({ winner: "A", confidence: 4, reasons: ["r"] });
    expect(await judge.comparePair(pair, { model: swapped.model, random: () => 0.9 })).toMatchObject({ winner: "second", order: "second-as-A" });
    expect(swapped.prompts[0].indexOf("SECOND")).toBeLessThan(swapped.prompts[0].indexOf("FIRST"));
  });

  it("keeps ties as ties", async () => {
    const tie = capturingModel({ winner: "tie", confidence: 1, reasons: ["r"] });
    expect((await judge.comparePair(pair, { model: tie.model, random: () => 0.9 })).winner).toBe("tie");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import type { RetrievalIndex } from "@/lib/retrieval/store";
import type { ResolvedBrief } from "@/lib/schemas/generation";
import { judgeFixture } from "../fixtures/judge";
import { testProfile } from "../fixtures/profile";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vryse-eval-"));
process.env.VRYSE_DB_PATH = path.join(tmp, "test.db");
process.env.VRYSE_DATA_DIR = tmp;

const model = (respond: () => string) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: respond() }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    }),
  });

const v = (x: number, y: number) => new Float32Array([x, y].map((n) => n / Math.hypot(x, y)));
const index: RetrievalIndex = {
  company: "acme",
  model: "test",
  dims: 2,
  builtAt: "",
  chunks: ["A", "B", "C"].map((id, i) => ({
    id: `${id}#0`,
    articleId: id,
    articleTitle: id,
    role: "body" as const,
    heading: "H",
    markdown: `Reference text ${id} with [a link](https://acme.com/${id}).\n`,
    words: 4,
    embedText: "x",
    vector: v(1, i * 0.1),
  })),
};
const embedders = { embedPassages: async (t: string[]) => t.map(() => v(1, 0.05)), embedQuery: async () => v(1, 0) };

const brief: ResolvedBrief = { company: "acme", topic: "EV fleets", audience: "x", targetWords: 60, keyPoints: ["KEYPOINT-MARKER"], requiredSections: ["Costs"] };
const article = [
  "# EV Fleets",
  "",
  "Fleets are going electric. This guide covers costs and charging.",
  "",
  "## Costs",
  "",
  "Running costs are lower with **EVs**. Plan charging around shifts. Read [more](https://acme.com/made-up).",
  "",
  "## Conclusion",
  "",
  "Start with a pilot.",
  "",
  "## FAQs",
  "",
  "### Are EVs cheaper?",
  "",
  "Usually over time.",
].join("\n");

let evaluate: typeof import("@/lib/evaluation/evaluate");
beforeAll(async () => {
  evaluate = await import("@/lib/evaluation/evaluate");
});

describe("evaluateArticle", () => {
  it("combines measured and judged scores into an overall score with ranked weaknesses", async () => {
    const result = await evaluate.evaluateArticle(
      { markdown: article, brief, profile: testProfile, index, sources: [] },
      { judgeModel: model(() => JSON.stringify(judgeFixture)), embedders },
    );
    expect(result.judge.available).toBe(true);
    expect(result.overall).toBeGreaterThan(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    // Key point marked "partial" by the judge → 50 for the judged half of completeness
    expect(result.dimensions.completeness.judge).toBe(50);
    expect(result.dimensions.tone.score).toBe(75); // judge 4/5, no measured part
    // The invented link is caught by lint and surfaced as a high-severity weakness
    expect(result.weaknesses.some((w) => w.source === "lint" && w.issue.includes("made-up"))).toBe(true);
    expect(result.weaknesses[0].severity).toBe("high");
    expect(result.unsupportedClaims).toHaveLength(1);
  });

  it("counts only the brief's own key points towards coverage", async () => {
    const extra = {
      ...judgeFixture,
      keyPoints: [
        { point: "KEYPOINT-MARKER", status: "covered" as const, evidence: "q" },
        { point: "Required sections: FAQ", status: "missing" as const, evidence: "" },
      ],
    };
    const result = await evaluate.evaluateArticle(
      { markdown: article, brief, profile: testProfile, index, sources: [] },
      { judgeModel: model(() => JSON.stringify(extra)), embedders },
    );
    expect(result.dimensions.completeness.judge).toBe(100);
    expect(result.keyPoints.map((k) => k.point)).toEqual(["KEYPOINT-MARKER"]);
  });

  it("still returns measured scores when the judge fails", async () => {
    const result = await evaluate.evaluateArticle(
      { markdown: article, brief, profile: testProfile, index, sources: [] },
      { judgeModel: model(() => "not json"), embedders },
    );
    expect(result.judge.available).toBe(false);
    expect(result.dimensions.tone.weight).toBe(0);
    expect(result.dimensions.structure.score).toBe(result.dimensions.structure.deterministic);
    expect(result.overall).toBeGreaterThan(0);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import type { RevisionInstruction } from "@/lib/schemas/feedback";
import type { Weakness } from "@/lib/schemas/evaluation";
import { testProfile } from "../fixtures/profile";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vryse-feedback-"));
process.env.VRYSE_DB_PATH = path.join(tmp, "test.db");
process.env.VRYSE_DATA_DIR = tmp;

function capturingModel(output: string) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return {
        content: [{ type: "text", text: output }],
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

const instruction = (id: string, extra: Partial<RevisionInstruction> = {}): RevisionInstruction => ({
  id,
  scope: "section",
  target: "Costs",
  action: "rewrite",
  instruction: `INSTRUCTION-${id}`,
  acceptanceCheck: "check",
  source: "human",
  persist: false,
  ...extra,
});

const weakness: Weakness = {
  issue: "WEAKNESS-MARKER paragraphs too short",
  severity: "high",
  dimension: "style",
  evidence: "",
  recommendation: "Merge paragraphs",
  target: "global",
  source: "measured",
};

let compile: typeof import("@/lib/feedback/compile");
let reviser: typeof import("@/lib/generation/reviser");
let verify: typeof import("@/lib/evaluation/verify");
let memory: typeof import("@/lib/feedback/memory");
beforeAll(async () => {
  compile = await import("@/lib/feedback/compile");
  reviser = await import("@/lib/generation/reviser");
  verify = await import("@/lib/evaluation/verify");
  memory = await import("@/lib/feedback/memory");
});

describe("compileFeedback", () => {
  it("sends the feedback, the selected weaknesses and the draft's sections, and renumbers the instructions", async () => {
    const { model, prompts } = capturingModel(JSON.stringify({ instructions: [instruction("x"), instruction("y", { source: "evaluator" })], summary: "s" }));
    const result = await compile.compileFeedback(
      { feedback: { text: "FEEDBACK-MARKER the intro is generic", rating: 3, sectionNotes: [{ section: "Costs", note: "NOTE-MARKER" }] }, weaknesses: [weakness], headings: ["Costs", "Safety"], profile: testProfile },
      { model },
    );
    expect(result.instructions.map((i) => i.id)).toEqual(["I1", "I2"]);
    for (const marker of ["FEEDBACK-MARKER", "NOTE-MARKER", "WEAKNESS-MARKER", "Safety", "3/5"]) expect(prompts[0]).toContain(marker);
  });
});

describe("compileFeedback persistence", () => {
  it("never lets an evaluator-sourced instruction be saved as a standing preference", async () => {
    const { model } = capturingModel(JSON.stringify({ instructions: [instruction("x", { source: "evaluator", persist: true }), instruction("y", { source: "human", persist: true })], summary: "s" }));
    const result = await compile.compileFeedback({ feedback: { text: "Never use em dashes in our articles." }, weaknesses: [], headings: [], profile: testProfile }, { model });
    expect(result.instructions.map((i) => i.persist)).toEqual([false, false]); // y's text is unrelated to the rule sentence
  });
});

describe("isStandingRule", () => {
  it("accepts an instruction backed by a general-rule sentence in the editor's feedback", () => {
    const feedback = "The intro is weak. As a rule for all our articles, never call anything a game-changer.";
    expect(compile.isStandingRule("Never call anything a game-changer.", feedback)).toBe(true);
    expect(compile.isStandingRule("Avoid the phrase game-changer in every article.", feedback)).toBe(true);
  });

  it("rejects article-specific fixes even when the model marked them persistent", () => {
    const feedback = 'Remove every "(Routematic internal data)" label. Keep H2 headings to 4-6 words.';
    expect(compile.isStandingRule("Remove every instance of (Routematic internal data).", feedback)).toBe(false);
    expect(compile.isStandingRule("Edit every H2 heading to 4-6 words.", feedback)).toBe(false);
  });

  it("does not let a rule sentence about one topic make an unrelated instruction persistent", () => {
    const feedback = "Always use British spelling. Shorten the intro.";
    expect(compile.isStandingRule("Shorten the intro to 120 words.", feedback)).toBe(false);
  });
});

describe("selectWeaknesses", () => {
  it("picks 1-based numbers from the list the reviewer was shown and ignores bad numbers", () => {
    const shown = [weakness, { ...weakness, issue: "second" }, { ...weakness, issue: "third" }];
    expect(compile.selectWeaknesses(shown, [3, 1, 9, 0]).map((w) => w.issue)).toEqual(["third", weakness.issue]);
  });
});

describe("reviseArticle", () => {
  it("sends the previous draft and the instructions, and returns clean markdown", async () => {
    const { model, prompts } = capturingModel("```markdown\n# Revised\n\nBody.\n```");
    const md = await reviser.reviseArticle({ markdown: "# DRAFT-MARKER", instructions: [instruction("I1")], profile: testProfile }, { model });
    expect(md).toBe("# Revised\n\nBody.\n");
    expect(prompts[0]).toContain("DRAFT-MARKER");
    expect(prompts[0]).toContain("INSTRUCTION-I1");
  });
});

describe("verifyInstructions", () => {
  it("checks every instruction and reports the share addressed", async () => {
    const { model, prompts } = capturingModel(JSON.stringify({ results: [{ id: "I1", addressed: true, evidence: "q" }, { id: "I2", addressed: false, evidence: "no" }] }));
    const result = await verify.verifyInstructions({ before: "# BEFORE", after: "# AFTER", instructions: [instruction("I1"), instruction("I2")], profile: testProfile }, { model });
    expect(result.addressedRate).toBe(0.5);
    expect(result.results).toHaveLength(2);
    for (const marker of ["BEFORE", "AFTER", "INSTRUCTION-I2", "check"]) expect(prompts[0]).toContain(marker);
  });

  it("counts instructions the judge skipped as not addressed", async () => {
    const { model } = capturingModel(JSON.stringify({ results: [{ id: "I1", addressed: true, evidence: "q" }] }));
    const result = await verify.verifyInstructions({ before: "a", after: "b", instructions: [instruction("I1"), instruction("I2")], profile: testProfile }, { model });
    expect(result.results.find((r) => r.id === "I2")).toMatchObject({ addressed: false });
    expect(result.addressedRate).toBe(0.5);
  });
});

describe("company memory", () => {
  it("saves persistent instructions once and lists them", () => {
    memory.rememberInstructions("acme", [instruction("I1", { persist: true, instruction: "Never use em dashes" }), instruction("I2")]);
    memory.rememberInstructions("acme", [instruction("I3", { persist: true, instruction: "never use em dashes" })]);
    expect(memory.listMemory("acme").map((m) => m.instruction)).toEqual(["Never use em dashes"]);
  });

  it("deletes an entry", () => {
    const [entry] = memory.listMemory("acme");
    memory.forget(entry.id);
    expect(memory.listMemory("acme")).toEqual([]);
  });
});

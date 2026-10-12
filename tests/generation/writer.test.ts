import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Excerpts } from "@/lib/retrieval/search";
import type { Outline, ResolvedBrief } from "@/lib/schemas/generation";
import { testProfile } from "../fixtures/profile";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vryse-writer-"));
process.env.VRYSE_DB_PATH = path.join(tmp, "test.db");
process.env.VRYSE_DATA_DIR = tmp;

function capturingModel(responses: string[]) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return {
        content: [{ type: "text", text: responses[Math.min(prompts.length - 1, responses.length - 1)] }],
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

const brief: ResolvedBrief = {
  company: "acme",
  topic: "EV fleets",
  audience: "transport heads",
  targetWords: 1500,
  keyPoints: ["Charging infrastructure"],
  requiredSections: [],
};

const section = (heading: string, role: "body" | "conclusion" = "body") => ({
  heading,
  role,
  intent: "",
  keyPoints: heading === "Charging" ? ["Charging infrastructure"] : [],
  devices: [],
  subheadings: [],
  targetWords: 230,
});

const outline: Outline = {
  title: "OUTLINE-TITLE-MARKER",
  primaryKeyword: "ev fleet",
  metaDescription: "",
  intro: { hook: "", promise: "", targetWords: 125 },
  keyTakeaways: false,
  sections: [section("Why"), section("Charging"), section("Costs"), section("Rollout"), section("Risks"), section("Conclusion", "conclusion")],
  faq: ["Q1?", "Q2?", "Q3?", "Q4?"],
  cta: "none",
};

const chunk = (heading: string | null, markdown: string) => ({
  id: heading ?? "intro",
  articleId: "a",
  articleTitle: "Ref Article",
  role: "body" as const,
  heading,
  markdown,
  words: 10,
});

const excerpts: Excerpts = {
  articles: [{ id: "a", title: "Ref Article", score: 1 }],
  intro: chunk(null, "EXCERPT-INTRO-MARKER text with [a link](https://acme.com/blog/real).\n"),
  conclusion: null,
  body: [chunk("Body", "## Body\n\nEXCERPT-BODY-MARKER\n")],
  tokens: 50,
};

let writer: typeof import("@/lib/generation/writer");
let planner: typeof import("@/lib/generation/planner");

beforeAll(async () => {
  writer = await import("@/lib/generation/writer");
  planner = await import("@/lib/generation/planner");
});

describe("writer", () => {
  it("collects allowed URLs from the excerpts only", () => {
    expect(writer.allowedUrls(excerpts)).toEqual(["https://acme.com/blog/real"]);
  });

  it("strips code fences around the article", () => {
    expect(writer.cleanMarkdown("```markdown\n# T\n\nBody.\n```")).toBe("# T\n\nBody.\n");
  });

  it("sends the style guide, excerpts, allowed URLs and outline, and returns clean markdown", async () => {
    const { model, prompts } = capturingModel(["```md\n# Title\n\nBody.\n```"]);
    const md = await writer.writeArticle({ brief, profile: testProfile, outline, excerpts }, { model });
    expect(md).toBe("# Title\n\nBody.\n");
    for (const marker of ["DO-RULE-MARKER", "EXCERPT-INTRO-MARKER", "EXCERPT-BODY-MARKER", "https://acme.com/blog/real", "OUTLINE-TITLE-MARKER"]) {
      expect(prompts[0]).toContain(marker);
    }
  });
});

describe("planOutline", () => {
  it("re-plans once with the problems when the first outline fails its checks", async () => {
    const bad = { ...outline, faq: [] };
    const { model, prompts } = capturingModel([JSON.stringify(bad), JSON.stringify(outline)]);
    const result = await planner.planOutline({ brief, profile: testProfile, exemplars: [{ title: "Ref", headings: ["A", "B"] }] }, { model });
    expect(result.attempts).toBe(2);
    expect(result.issues).toEqual([]);
    expect(prompts[1]).toContain("FAQ needs at least");
  });
});

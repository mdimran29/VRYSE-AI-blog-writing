import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import type { ArticleTraits, StyleGuide } from "@/lib/schemas/profile";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vryse-extract-"));
process.env.VRYSE_DB_PATH = path.join(tmp, "test.db");
process.env.VRYSE_DATA_DIR = tmp;

const traits: ArticleTraits = {
  introPattern: "pain point → statistic → what the article covers",
  conclusionPattern: "recap → product tie-in → CTA",
  ctaStyle: "soft demo invitation",
  tone: ["practical", "authoritative"],
  audience: "HR heads",
  pointOfView: "you to the reader",
  exampleUsage: "client case results",
  dataUsage: "industry stats in tables",
  productMentions: "named in two sections",
  terminology: ["employee transport"],
  headingStyle: "keyword-led statements",
  faqStyle: "5 short questions",
  formattingDevices: ["bold lead-ins"],
};

const guide: StyleGuide = {
  summary: "Practical guides for HR heads.",
  audience: "HR heads",
  voice: { tone: ["practical"], formality: "professional", pointOfView: "you", personality: "direct" },
  structure: {
    typicalOutline: ["intro", "faq"],
    introPatterns: [{ pattern: "pain → stat", articles: 2, example: "" }],
    conclusionPatterns: [{ pattern: "recap → CTA", articles: 2, example: "" }],
    ctaPatterns: [{ pattern: "demo", articles: 1, example: "" }],
    headingStyle: "keyword-led",
    faqStyle: "short",
  },
  content: { exampleUsage: "cases", dataUsage: "stats", productMentions: "light" },
  vocabulary: { preferredTerms: ["fleet"], spelling: "British", avoid: [] },
  formatting: ["tables"],
  rules: { do: ["Open with a problem"], dont: ["No hype"] },
};

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

let extract: typeof import("@/lib/analysis/extract");

beforeAll(async () => {
  extract = await import("@/lib/analysis/extract");
});

describe("extractTraits", () => {
  it("sends the article markdown and returns validated traits", async () => {
    const { model, prompts } = capturingModel(traits);
    const result = await extract.extractTraits({ id: "a1", title: "Plan Routes", markdown: "# Plan Routes\n\nUNIQUE-MARKER body." }, { model });
    expect(result).toEqual(traits);
    expect(prompts[0]).toContain("UNIQUE-MARKER");
  });
});

describe("synthesizeGuide", () => {
  it("sends every article's traits and the stats digest, and returns the guide", async () => {
    const { model, prompts } = capturingModel(guide);
    const result = await extract.synthesizeGuide(
      { company: "acme", traits: [traits, { ...traits, ctaStyle: "SECOND-ARTICLE-CTA" }], statsDigest: "STATS-DIGEST-MARKER" },
      { model },
    );
    expect(result).toEqual(guide);
    expect(prompts[0]).toContain("SECOND-ARTICLE-CTA");
    expect(prompts[0]).toContain("STATS-DIGEST-MARKER");
    expect(prompts[0]).toContain("2 articles");
  });
});

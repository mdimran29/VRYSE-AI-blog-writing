import { describe, expect, it } from "vitest";
import { extractFeatures } from "@/lib/analysis/metrics";
import { measuredScores } from "@/lib/evaluation/measured";
import type { LintResult } from "@/lib/generation/lint";
import { markdownToBlocks } from "@/lib/ingest/markdown";
import type { ResolvedBrief } from "@/lib/schemas/generation";
import { testProfile } from "../fixtures/profile";

const brief: ResolvedBrief = { company: "acme", topic: "EV fleets", audience: "x", targetWords: 1500, keyPoints: [], requiredSections: ["Costs"] };

const cleanLint: LintResult = {
  issues: [],
  metrics: { words: 1500, h2Count: 7, faqQuestions: 5, copiedPassages: [], unverifiedUrls: [], unsupportedFigures: [], avoidPhrases: [] },
};

const features = (md: string) => extractFeatures(markdownToBlocks(md), { brandTerms: ["Acme"] });
const article = "# T\n\nIntro sentence here.\n\n## Costs\n\nShort one. Another short one.\n\n## FAQs\n\n### Q?\n\nA.";
const semantic = { styleSimilarity: null, styleBand: null, relevanceSimilarity: null, relevanceRef: null };

describe("measuredScores", () => {
  it("scores structure, style and readability from features against the profile bands", () => {
    const m = measuredScores({ features: features(article), profile: testProfile, brief, lint: cleanLint, semantic });
    expect(m.dimensions.structure.deterministic).not.toBeNull();
    expect(m.dimensions.style.features.find((f) => f.feature === "wordsPerSentenceMean")).toBeDefined();
    expect(m.dimensions.tone.deterministic).toBeNull();
  });

  it("gives zero for a missing FAQ when the house style always has one", () => {
    const m = measuredScores({ features: features("# T\n\nIntro.\n\n## Costs\n\nBody."), profile: testProfile, brief, lint: cleanLint, semantic });
    expect(m.dimensions.structure.features.find((f) => f.feature === "hasFaq")?.score).toBe(0);
  });

  it("turns badly-scored features into measured weaknesses with the house range", () => {
    const long = `# T\n\n${"word ".repeat(60)}end.\n\n## Costs\n\n${"word ".repeat(60)}end.\n\n## FAQs\n\n### Q?\n\nA.`;
    const m = measuredScores({ features: features(long), profile: testProfile, brief, lint: cleanLint, semantic });
    const sentence = m.weaknesses.find((w) => w.issue.includes("words per sentence"));
    expect(sentence?.source).toBe("measured");
    expect(sentence?.issue).toContain("11–18");
  });

  it("scores completeness from length and required sections", () => {
    const missing: LintResult = {
      ...cleanLint,
      issues: [{ code: "required-section-missing", severity: "hard", message: 'Required section "Costs" is missing.' }],
    };
    const m = measuredScores({ features: { ...features(article), wordCount: 1500 }, profile: testProfile, brief, lint: missing, semantic });
    expect(m.dimensions.completeness.deterministic).toBeCloseTo(50); // length 100, required 0
  });

  it("lowers specificity for each unsupported figure", () => {
    const base = measuredScores({ features: features(article), profile: testProfile, brief, lint: cleanLint, semantic });
    const flagged = measuredScores({
      features: features(article),
      profile: testProfile,
      brief,
      lint: { ...cleanLint, metrics: { ...cleanLint.metrics, unsupportedFigures: ["30%", "400 km"] } },
      semantic,
    });
    expect(base.dimensions.specificity.deterministic! - flagged.dimensions.specificity.deterministic!).toBeCloseTo(20);
  });

  it("uses embedding similarity for style and relevance when available", () => {
    const m = measuredScores({
      features: features(article),
      profile: testProfile,
      brief,
      lint: cleanLint,
      semantic: {
        styleSimilarity: 0.95,
        styleBand: { p10: 0.85, p25: 0.88, median: 0.9, p75: 0.92, p90: 0.94, mean: 0.9, n: 50 },
        relevanceSimilarity: 0.8,
        relevanceRef: { p50: 0.6, p90: 0.8 },
      },
    });
    expect(m.dimensions.style.features.find((f) => f.feature === "styleSimilarity")?.score).toBe(100);
    expect(m.dimensions.relevance.deterministic).toBe(100);
  });
});

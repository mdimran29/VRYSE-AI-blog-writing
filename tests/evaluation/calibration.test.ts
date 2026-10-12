import { describe, expect, it } from "vitest";
import { briefFromArticle, summarize } from "@/lib/evaluation/calibrate";
import { averageJudges } from "@/lib/evaluation/evaluate";
import { improvementThreshold, noiseStats } from "@/lib/evaluation/noise";
import type { Block } from "@/lib/schemas/article";
import { judgeFixture } from "../fixtures/judge";
import { testProfile } from "../fixtures/profile";

describe("averageJudges", () => {
  const withScores = (tone: number, covered: "covered" | "partial" | "missing", summary: string) => ({
    ...judgeFixture,
    dimensions: { ...judgeFixture.dimensions, tone: { ...judgeFixture.dimensions.tone, score: tone } },
    keyPoints: [{ point: "P", status: covered, evidence: "" }],
    summary,
  });

  it("averages dimension scores and key-point coverage across runs", () => {
    const avg = averageJudges([withScores(3, "covered", "a"), withScores(5, "partial", "b"), withScores(4, "covered", "c")]);
    expect(avg.dimensions.tone.score).toBeCloseTo(4);
    // coverage mean (1 + 0.5 + 1) / 3 ≈ 0.83 → covered
    expect(avg.keyPoints[0].status).toBe("covered");
  });

  it("takes the qualitative findings from the run closest to the average", () => {
    const avg = averageJudges([withScores(1, "missing", "low"), withScores(3, "covered", "middle"), withScores(5, "covered", "high")]);
    expect(avg.summary).toBe("middle");
  });

  it("returns a single run unchanged", () => {
    const one = withScores(4, "partial", "only");
    expect(averageJudges([one])).toEqual(one);
  });
});

describe("noise", () => {
  it("computes mean and sample standard deviation", () => {
    const s = noiseStats([78, 82, 80, 84]);
    expect(s.mean).toBeCloseTo(81);
    expect(s.std).toBeCloseTo(2.582, 3);
    expect(s.range).toBe(6);
  });

  it("derives the improvement threshold as 2σ of the difference between two means of k runs", () => {
    expect(improvementThreshold(3, 1)).toBeCloseTo(2 * Math.SQRT2 * 3);
    expect(improvementThreshold(3, 3)).toBeCloseTo((2 * Math.SQRT2 * 3) / Math.sqrt(3));
  });
});

describe("briefFromArticle", () => {
  const h = (level: number, text: string): Block => ({ type: "heading", level, text });
  const p = (text: string): Block => ({ type: "paragraph", text });
  const blocks: Block[] = [
    h(1, "Fleet Safety Guide"),
    p("Intro words here."),
    h(2, "Key Takeaways"),
    p("x"),
    h(2, "Why Safety Matters"),
    p("a b c"),
    h(2, "Driver Training"),
    p("d e f"),
    h(2, "Vehicle Checks"),
    p("g"),
    h(2, "GPS Tracking"),
    p("h"),
    h(2, "Escort Rules"),
    p("i"),
    h(2, "Conclusion"),
    p("j"),
    h(2, "FAQs"),
    p("k"),
  ];

  it("uses the title as topic and up to four body headings as key points", () => {
    const brief = briefFromArticle({ title: "Fleet Safety Guide", blocks }, testProfile);
    expect(brief.topic).toBe("Fleet Safety Guide");
    expect(brief.keyPoints).toEqual(["Why Safety Matters", "Driver Training", "Vehicle Checks", "GPS Tracking"]);
    expect(brief.company).toBe("acme");
    expect(brief.requiredSections).toEqual([]);
  });

  it("targets the article's own length, rounded to 50, within the brief limits", () => {
    expect(briefFromArticle({ title: "Fleet Safety Guide", blocks }, testProfile).targetWords).toBe(300);
  });
});

describe("summarize", () => {
  const row = (set: "human" | "generic" | "system", overall: number, style: number) => ({
    set,
    articleId: "a",
    title: "t",
    overall,
    dimensions: { structure: 0, style, relevance: 0, completeness: 0, tone: 0, readability: 0, specificity: 0 },
  });

  it("averages each set and checks the expected ordering", () => {
    const s = summarize([row("human", 80, 70), row("human", 90, 90), row("generic", 50, 40), row("system", 75, 60)]);
    expect(s.sets.human.overall).toBe(85);
    expect(s.sets.generic.n).toBe(1);
    expect(s.ordering).toEqual({ humanAboveGeneric: true, systemAboveGeneric: true, humanAtLeastSystem: true });
  });
});

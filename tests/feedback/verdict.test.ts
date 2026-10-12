import { describe, expect, it } from "vitest";
import { thresholdFor, improvementVerdict } from "@/lib/evaluation/verdict";
import { sectionChanges, untargetedChanges } from "@/lib/generation/reviser";
import type { RevisionInstruction } from "@/lib/schemas/feedback";

const dims = (overrides: Partial<Record<string, number>> = {}) =>
  Object.fromEntries(
    ["structure", "style", "relevance", "completeness", "tone", "readability", "specificity"].map((d) => [d, { score: overrides[d] ?? 80 }]),
  ) as Record<"structure" | "style" | "relevance" | "completeness" | "tone" | "readability" | "specificity", { score: number }>;

const ev = (overall: number, overrides: Partial<Record<string, number>> = {}, runs = 3) => ({ overall, dimensions: dims(overrides), judge: { runs } });
const verified = (addressed: boolean[]) => addressed.map((a, i) => ({ id: `I${i + 1}`, addressed: a, evidence: "" }));

describe("thresholdFor", () => {
  it("is 2√2·σ/√k, rounded up to the next half point", () => {
    expect(thresholdFor(1.63, 3)).toBe(3);
    expect(thresholdFor(1.63, 1)).toBe(5);
  });
});

describe("improvementVerdict", () => {
  const sigma = 1.63;

  it("is improved when the gain beats the threshold, nothing drops much and most instructions were done", () => {
    const v = improvementVerdict(ev(80), ev(85, { style: 90 }), verified([true, true, true, true, false]), sigma);
    expect(v.verdict).toBe("improved");
    expect(v.delta).toBe(5);
    expect(v.threshold).toBe(3);
    expect(v.addressedRate).toBeCloseTo(0.8);
  });

  it("is mixed when the gain is within noise", () => {
    expect(improvementVerdict(ev(80), ev(82), verified([true]), sigma).verdict).toBe("mixed");
  });

  it("is mixed when a dimension drops by more than 5 points", () => {
    const v = improvementVerdict(ev(80), ev(86, { tone: 70 }), verified([true]), sigma);
    expect(v.verdict).toBe("mixed");
    expect(v.dimensionDrops).toEqual([{ dimension: "tone", drop: 10 }]);
  });

  it("is mixed when fewer than 80% of instructions were addressed", () => {
    expect(improvementVerdict(ev(80), ev(90), verified([true, false]), sigma).verdict).toBe("mixed");
  });

  it("is regressed when the score falls by at least the threshold", () => {
    expect(improvementVerdict(ev(85), ev(80), verified([true]), sigma).verdict).toBe("regressed");
  });

  it("uses the stricter threshold when either side had fewer judge runs", () => {
    const v = improvementVerdict(ev(80, {}, 3), ev(84, {}, 1), verified([true]), sigma);
    expect(v.threshold).toBe(5);
    expect(v.verdict).toBe("mixed");
  });
});

describe("sectionChanges", () => {
  const before = "# T\n\nIntro.\n\n## Costs\n\nOld cost text.\n\n## Safety\n\nSafety text.\n\n## FAQs\n\n### Q?\n\nA.";
  const after = "# T\n\nIntro.\n\n## Costs\n\nNew cost text.\n\n## Safety\n\nSafety text.\n\n## Pilot\n\nNew section.\n\n## FAQs\n\n### Q?\n\nA.";

  it("classifies each section as unchanged, changed, added or removed", () => {
    expect(sectionChanges(before, after)).toEqual([
      { section: "intro", status: "unchanged" },
      { section: "Costs", status: "changed" },
      { section: "Safety", status: "unchanged" },
      { section: "FAQs", status: "unchanged" },
      { section: "Pilot", status: "added" },
    ]);
  });

  const instruction = (target: string, scope: "section" | "global" = "section"): RevisionInstruction => ({
    id: "I1",
    scope,
    target,
    action: "rewrite",
    instruction: "",
    acceptanceCheck: "",
    source: "human",
    persist: false,
  });

  it("reports sections that changed although no instruction targeted them", () => {
    expect(untargetedChanges(sectionChanges(before, after), [instruction("Safety")])).toEqual(["Costs", "Pilot"]);
    expect(untargetedChanges(sectionChanges(before, after), [instruction("costs"), instruction("Pilot")])).toEqual([]);
  });

  it("does not report anything when an instruction is global", () => {
    expect(untargetedChanges(sectionChanges(before, after), [instruction("global", "global")])).toEqual([]);
  });
});

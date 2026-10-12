import { describe, expect, it } from "vitest";
import { renderSummary } from "@/lib/export";

const dims = (base: number) => ({
  structure: base,
  style: base,
  relevance: base,
  completeness: base,
  tone: base,
  readability: base,
  specificity: base,
});

describe("renderSummary", () => {
  const md = renderSummary({
    brief: { topic: "Monsoon commutes", targetWords: 1450, keyPoints: ["Rerouting", "Safety"] },
    versions: [
      { version: 1, overall: 80, dimensions: dims(80), words: 1500, judgeRuns: 3 },
      { version: 2, overall: 86.5, dimensions: dims(86), words: 1480, judgeRuns: 3 },
    ],
    revisions: [
      {
        version: 2,
        fromVersion: 1,
        feedback: "The intro is generic.",
        instructions: [{ id: "I1", target: "intro", instruction: "Open with a flooded-route scenario.", persist: false }],
        verification: [{ id: "I1", addressed: true, evidence: "Last July…" }],
        verdict: { verdict: "improved", delta: 6.5, threshold: 3, reasons: ["Overall +6.5 (threshold ±3 for 3 judge runs)"], pairwise: { winner: "revised", confidence: 4, reasons: ["Better intro"] } },
      },
    ],
    cost: 0.123,
  });

  it("tabulates the scores of every version with the change", () => {
    expect(md).toContain("| Overall | 80.0 | 86.5 | +6.5 |");
    expect(md).toContain("| Style | 80.0 | 86.0 | +6.0 |");
  });

  it("lists the feedback, the instructions with ✓/✗ and the verdict", () => {
    expect(md).toContain("The intro is generic.");
    expect(md).toContain("✓ **I1** [intro] Open with a flooded-route scenario.");
    expect(md).toContain("**IMPROVED**");
    expect(md).toContain("preferred the revised version (4/5)");
  });

  it("states the cost", () => {
    expect(md).toContain("$0.123");
  });
});

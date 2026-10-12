import type { JudgeResult } from "@/lib/schemas/evaluation";

const d = (score: number) => ({ score, reasoning: "r", evidence: ["quote"] });

/** A valid judge response for tests. */
export const judgeFixture: JudgeResult = {
  dimensions: { structure: d(4), style: d(4), relevance: d(5), completeness: d(4), tone: d(4), readability: d(3), specificity: d(2) },
  keyPoints: [{ point: "KEYPOINT-MARKER", status: "partial", evidence: "quote" }],
  genericPassages: [{ quote: "In today's world…", why: "filler" }],
  unsupportedClaims: [{ quote: "costs fall 30%", why: "not in sources" }],
  strengths: ["Clear structure"],
  weaknesses: [{ issue: "Generic intro", severity: "high", evidence: "In today's world…", recommendation: "Open with a concrete problem", target: "intro" }],
  summary: "Solid but generic in places.",
};

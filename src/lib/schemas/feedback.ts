import { z } from "zod";

/** What a reviewer gives: a rating, free text, notes on sections, and which evaluator weaknesses they agree with. */
export type FeedbackInput = {
  rating?: number;
  text: string;
  sectionNotes?: { section: string; note: string }[];
  /** Indexes into the previous evaluation's ranked weaknesses. */
  selectedWeaknesses?: number[];
};

// LLM output schemas: every field required (OpenAI strict structured output).
export const RevisionInstructionSchema = z.object({
  id: z.string().describe("I1, I2, … in priority order"),
  scope: z.enum(["global", "section"]),
  target: z.string().describe("The exact H2 heading this applies to, 'intro', 'faq', or 'global'"),
  action: z.enum(["add", "remove", "rewrite", "restyle", "shorten", "expand"]),
  instruction: z.string().describe("One specific, actionable change"),
  acceptanceCheck: z.string().describe("How an editor can check in the new draft that this was done"),
  source: z.enum(["human", "evaluator"]),
  persist: z.boolean().describe("True only for a general preference that should apply to all future articles for this company"),
});
export type RevisionInstruction = z.infer<typeof RevisionInstructionSchema>;

export const CompiledFeedbackSchema = z.object({
  instructions: z.array(RevisionInstructionSchema),
  summary: z.string().describe("One sentence on what the revision should achieve"),
});
export type CompiledFeedback = z.infer<typeof CompiledFeedbackSchema>;

export const VerificationSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().describe("The instruction id"),
      addressed: z.boolean(),
      evidence: z.string().describe("A short quote from the new draft, or why it was not addressed"),
    }),
  ),
});
export type Verification = z.infer<typeof VerificationSchema>;

export type Verdict = {
  verdict: "improved" | "mixed" | "regressed";
  delta: number;
  threshold: number;
  dimensionDrops: { dimension: string; drop: number }[];
  addressedRate: number | null;
  pairwise: { winner: "previous" | "revised" | "tie"; confidence: number; reasons: string[] } | null;
  reasons: string[];
};

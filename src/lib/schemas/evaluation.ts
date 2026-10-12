import { z } from "zod";

export const DIMENSIONS = ["structure", "style", "relevance", "completeness", "tone", "readability", "specificity"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const WEIGHTS: Record<Dimension, number> = {
  structure: 0.2,
  style: 0.2,
  relevance: 0.15,
  completeness: 0.15,
  tone: 0.1,
  readability: 0.1,
  specificity: 0.1,
};

// Judge output: every field required (strict structured output on some providers).
const JudgeDimension = z.object({
  score: z.number().int().min(1).max(5).describe("1-5 on the anchored rubric"),
  reasoning: z.string().describe("One or two sentences explaining the score"),
  evidence: z.array(z.string()).describe("1-3 short verbatim quotes from the article that justify the score"),
});

export const JudgeSchema = z.object({
  dimensions: z.object({
    structure: JudgeDimension,
    style: JudgeDimension,
    relevance: JudgeDimension,
    completeness: JudgeDimension,
    tone: JudgeDimension,
    readability: JudgeDimension,
    specificity: JudgeDimension,
  }),
  keyPoints: z.array(
    z.object({
      point: z.string().describe("The key point from the brief, verbatim"),
      status: z.enum(["covered", "partial", "missing"]),
      evidence: z.string().describe("A short quote showing coverage; empty if missing"),
    }),
  ),
  genericPassages: z.array(
    z.object({ quote: z.string().describe("Verbatim quote"), why: z.string().describe("Why it reads as generic filler") }),
  ),
  unsupportedClaims: z.array(
    z.object({
      quote: z.string().describe("Verbatim quote containing a factual claim, figure or statistic"),
      why: z.string().describe("Why the source passages do not support it"),
    }),
  ),
  strengths: z.array(z.string()),
  weaknesses: z.array(
    z.object({
      issue: z.string(),
      severity: z.enum(["high", "medium", "low"]),
      evidence: z.string().describe("A short verbatim quote, or empty for structural issues"),
      recommendation: z.string().describe("A specific, actionable fix"),
      target: z.string().describe("The section heading the fix applies to, or 'global'"),
    }),
  ),
  summary: z.string().describe("Two or three sentences overall"),
});
export type JudgeResult = z.infer<typeof JudgeSchema>;

export const PairwiseSchema = z.object({
  winner: z.enum(["A", "B", "tie"]),
  confidence: z.number().int().min(1).max(5),
  reasons: z.array(z.string()).describe("2-4 specific reasons, citing both versions"),
});
export type PairwiseResult = z.infer<typeof PairwiseSchema>;

export type FeatureScore = { feature: string; value: number | null; band: string; score: number; note?: string };

export type DimensionScore = {
  score: number;
  weight: number;
  deterministic: number | null;
  judge: number | null;
  features: FeatureScore[];
  reasoning?: string;
  evidence?: string[];
};

export type Weakness = {
  issue: string;
  severity: "high" | "medium" | "low";
  dimension: Dimension | "general";
  evidence: string;
  recommendation: string;
  target: string;
  source: "judge" | "measured" | "lint";
};

export type Evaluation = {
  overall: number;
  capped: boolean;
  dimensions: Record<Dimension, DimensionScore>;
  keyPoints: JudgeResult["keyPoints"];
  genericPassages: JudgeResult["genericPassages"];
  unsupportedClaims: JudgeResult["unsupportedClaims"];
  strengths: string[];
  weaknesses: Weakness[];
  summary: string;
  judge: { model: string; available: boolean; runs: number; error?: string };
};

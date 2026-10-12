import type { LanguageModel } from "ai";
import { extractFeatures } from "@/lib/analysis/metrics";
import { buildCorpusFingerprint, lintArticle, type CorpusFingerprint, type LintResult } from "@/lib/generation/lint";
import { overlaps } from "@/lib/generation/planner";
import { markdownToBlocks } from "@/lib/ingest/markdown";
import { getConfig } from "@/lib/config";
import type { Chunk } from "@/lib/retrieval/chunks";
import type { RetrievalIndex } from "@/lib/retrieval/store";
import { DIMENSIONS, type Dimension, type Evaluation, type JudgeResult, type Weakness } from "@/lib/schemas/evaluation";
import type { Issue, ResolvedBrief } from "@/lib/schemas/generation";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";
import { judgeToScore } from "./bands";
import { judgeArticle } from "./judge";
import { measuredScores } from "./measured";
import { combine, type DimensionInput } from "./scoring";
import { semanticSignals, type Embedders } from "./semantic";

const JUDGE_SHARE: Record<Dimension, number> = {
  structure: 0.5,
  style: 0.5,
  relevance: 0.5,
  completeness: 0.6, // key-point coverage carries most of completeness
  tone: 1,
  readability: 0.5,
  specificity: 0.5,
};

// Lint codes already represented by a measured feature are not repeated as weaknesses.
const LINT_DIMENSION: Record<string, Dimension | null> = {
  h1: "structure",
  "faq-position": "structure",
  "required-section-missing": "completeness",
  "unverified-url": "specificity",
  "unsupported-figure": "specificity",
  "copied-text": "style",
  "close-paraphrase": "style",
  "avoid-phrase": "style",
  length: null,
  "faq-missing": null,
  "h2-count": null,
};

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const SOURCE_RANK = { judge: 0, measured: 1, lint: 2 } as const;

function lintWeaknesses(issues: Issue[]): Weakness[] {
  return issues
    .filter((i) => LINT_DIMENSION[i.code] !== null)
    .map((i) => ({
      issue: i.message,
      severity: i.severity === "hard" ? "high" : "low",
      dimension: LINT_DIMENSION[i.code] ?? "general",
      evidence: "",
      recommendation: i.severity === "hard" ? "Must be fixed before publishing." : "Review and fix if it applies.",
      target: "global",
      source: "lint",
    }));
}

/** The judge's verdicts for the brief's own key points only (it sometimes adds required sections). */
const briefKeyPoints = (judge: JudgeResult, brief: ResolvedBrief) =>
  judge.keyPoints.filter((k) => brief.keyPoints.some((p) => overlaps(p, k.point)));

/** Coverage of the brief's key points as judged: covered 1, partial 0.5, missing 0. */
function coverageScore(judge: JudgeResult, brief: ResolvedBrief): number {
  const points = briefKeyPoints(judge, brief);
  if (!brief.keyPoints.length || !points.length) return judgeToScore(judge.dimensions.completeness.score);
  return (100 * points.reduce((s, k) => s + KEY_POINT_VALUE[k.status], 0)) / points.length;
}

export type EvaluationResult = Evaluation & { lint: LintResult };

const KEY_POINT_VALUE: Record<"covered" | "partial" | "missing", number> = { covered: 1, partial: 0.5, missing: 0 };
const meanJudgeScore = (j: JudgeResult) => DIMENSIONS.reduce((s, d) => s + j.dimensions[d].score, 0) / DIMENSIONS.length;

/**
 * Averages several judge runs: dimension scores and key-point coverage are averaged; the quotes,
 * weaknesses and summary come from the run closest to the average (a real, coherent run).
 */
export function averageJudges(runs: JudgeResult[]): JudgeResult {
  if (runs.length === 1) return runs[0];
  const target = runs.reduce((s, r) => s + meanJudgeScore(r), 0) / runs.length;
  const representative = runs.reduce((best, r) => (Math.abs(meanJudgeScore(r) - target) < Math.abs(meanJudgeScore(best) - target) ? r : best));
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((d) => [d, { ...representative.dimensions[d], score: runs.reduce((s, r) => s + r.dimensions[d].score, 0) / runs.length }]),
  ) as JudgeResult["dimensions"];
  const keyPoints = representative.keyPoints.map((kp) => {
    const values = runs.map((r) => r.keyPoints.find((k) => overlaps(k.point, kp.point))).filter((k) => k !== undefined).map((k) => KEY_POINT_VALUE[k.status]);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return { ...kp, status: mean >= 0.75 ? ("covered" as const) : mean >= 0.25 ? ("partial" as const) : ("missing" as const) };
  });
  return { ...representative, dimensions, keyPoints };
}

/** Scores one draft: lint, measured features, embedding signals and the judge, combined per dimension. */
export async function evaluateArticle(
  input: {
    markdown: string;
    brief: ResolvedBrief;
    profile: CompanyStyleProfile;
    index: RetrievalIndex;
    sources: Chunk[];
    fingerprint?: CorpusFingerprint;
    /** Reference articles: their figures and links come from the author's research, not from our sources. */
    trustFigures?: boolean;
    runId?: string;
    iterationId?: string;
  },
  opts: { judgeModel?: string | LanguageModel; embedders?: Embedders; judgeRuns?: number } = {},
): Promise<EvaluationResult> {
  const { markdown, brief, profile, index } = input;
  const fingerprint = input.fingerprint ?? buildCorpusFingerprint(index.chunks.map((c) => c.markdown));
  const rawLint = lintArticle(markdown, { brief, profile, fingerprint });
  const lint: LintResult = input.trustFigures
    ? {
        issues: rawLint.issues.filter((i) => i.code !== "unsupported-figure" && i.code !== "unverified-url"),
        metrics: { ...rawLint.metrics, unsupportedFigures: [], unverifiedUrls: [] },
      }
    : rawLint;
  const judgeRuns = opts.judgeRuns ?? getConfig().VRYSE_JUDGE_RUNS;
  const features = extractFeatures(markdownToBlocks(markdown), { brandTerms: profile.brandTerms });

  const [semantic, judged] = await Promise.all([
    semanticSignals({ markdown, topic: brief.topic, keyPoints: brief.keyPoints }, index, opts.embedders),
    Promise.allSettled(
      Array.from({ length: judgeRuns }, () =>
        judgeArticle(
          { markdown, brief, profile, sources: input.sources, trustFigures: input.trustFigures, runId: input.runId, iterationId: input.iterationId },
          { model: opts.judgeModel },
        ),
      ),
    ).then((settled) => {
      const ok = settled.filter((s): s is PromiseFulfilledResult<JudgeResult> => s.status === "fulfilled").map((s) => s.value);
      const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
      const error = failed ? (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)) : undefined;
      return { result: ok.length ? averageJudges(ok) : null, runs: ok.length, error };
    }),
  ]);
  const judge = judged.result;
  const measured = measuredScores({ features, profile, brief, lint, semantic });

  const inputs = Object.fromEntries(
    DIMENSIONS.map((d) => {
      const jd = judge?.dimensions[d];
      const judgeScore = !judge ? null : d === "completeness" ? coverageScore(judge, brief) : judgeToScore(jd!.score);
      const dim: DimensionInput = {
        score: 0,
        weight: 0,
        deterministic: measured.dimensions[d].deterministic,
        judge: judgeScore,
        features: measured.dimensions[d].features,
        reasoning: jd?.reasoning,
        evidence: jd?.evidence,
        judgeShare: JUDGE_SHARE[d],
      };
      return [d, dim];
    }),
  ) as Record<Dimension, DimensionInput>;

  const missingRequired = lint.issues.some((i) => i.code === "required-section-missing" || i.code === "faq-missing");
  const { overall, capped, dimensions } = combine(inputs, { capAt: missingRequired ? 70 : null });

  const judgeWeaknesses: Weakness[] = (judge?.weaknesses ?? []).map((w) => ({ ...w, dimension: "general", source: "judge" }));
  const weaknesses = [...judgeWeaknesses, ...measured.weaknesses, ...lintWeaknesses(lint.issues)].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || SOURCE_RANK[a.source] - SOURCE_RANK[b.source],
  );

  return {
    overall,
    capped,
    dimensions,
    keyPoints: judge ? briefKeyPoints(judge, brief) : [],
    genericPassages: judge?.genericPassages ?? [],
    unsupportedClaims: judge?.unsupportedClaims ?? [],
    strengths: judge?.strengths ?? [],
    weaknesses,
    summary: judge?.summary ?? "The judge was unavailable; scores are measured only.",
    judge: {
      model: typeof opts.judgeModel === "string" || !opts.judgeModel ? (opts.judgeModel as string | undefined) ?? getConfig().VRYSE_JUDGE_MODEL : "custom",
      available: Boolean(judge),
      runs: judged.runs,
      thinkingBudget: getConfig().VRYSE_JUDGE_THINKING_BUDGET ?? null,
      error: judged.error,
    },
    lint,
  };
}

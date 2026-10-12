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
  const value = { covered: 1, partial: 0.5, missing: 0 } as const;
  return (100 * points.reduce((s, k) => s + value[k.status], 0)) / points.length;
}

export type EvaluationResult = Evaluation & { lint: LintResult };

/** Scores one draft: lint, measured features, embedding signals and the judge, combined per dimension. */
export async function evaluateArticle(
  input: {
    markdown: string;
    brief: ResolvedBrief;
    profile: CompanyStyleProfile;
    index: RetrievalIndex;
    sources: Chunk[];
    fingerprint?: CorpusFingerprint;
    runId?: string;
    iterationId?: string;
  },
  opts: { judgeModel?: string | LanguageModel; embedders?: Embedders } = {},
): Promise<EvaluationResult> {
  const { markdown, brief, profile, index } = input;
  const fingerprint = input.fingerprint ?? buildCorpusFingerprint(index.chunks.map((c) => c.markdown));
  const lint = lintArticle(markdown, { brief, profile, fingerprint });
  const features = extractFeatures(markdownToBlocks(markdown), { brandTerms: profile.brandTerms });

  const [semantic, judged] = await Promise.all([
    semanticSignals({ markdown, topic: brief.topic, keyPoints: brief.keyPoints }, index, opts.embedders),
    judgeArticle({ markdown, brief, profile, sources: input.sources, runId: input.runId, iterationId: input.iterationId }, { model: opts.judgeModel })
      .then((result) => ({ result, error: undefined }))
      .catch((error: unknown) => ({ result: null, error: error instanceof Error ? error.message : String(error) })),
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
      error: judged.error,
    },
    lint,
  };
}

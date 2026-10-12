import { DIMENSIONS, type Dimension } from "@/lib/schemas/evaluation";
import type { Verdict } from "@/lib/schemas/feedback";
import { improvementThreshold } from "./noise";

/** The improvement threshold for scores averaged over `judgeRuns` runs, rounded up to the next half point. */
export const thresholdFor = (sigma: number, judgeRuns: number) => Math.ceil(improvementThreshold(sigma, judgeRuns) * 2) / 2;

type Scored = { overall: number; dimensions: Record<Dimension, { score: number }>; judge: { runs: number } };

/**
 * Improved only if the overall gain beats the noise threshold, no dimension falls by more than
 * 5 points, and at least 80% of the instructions were addressed. Regressed if the score falls by at
 * least the threshold. Anything else is mixed.
 */
export function improvementVerdict(
  previous: Scored,
  revised: Scored,
  verification: { id: string; addressed: boolean }[] | null,
  sigma: number,
  pairwise: Verdict["pairwise"] = null,
): Verdict {
  const runs = Math.max(1, Math.min(previous.judge.runs, revised.judge.runs));
  const threshold = thresholdFor(sigma, runs);
  const delta = revised.overall - previous.overall;
  const dimensionDrops = DIMENSIONS.map((d) => ({ dimension: d, drop: previous.dimensions[d].score - revised.dimensions[d].score })).filter((d) => d.drop > 5);
  const addressedRate = verification?.length ? verification.filter((v) => v.addressed).length / verification.length : null;

  const reasons: string[] = [];
  reasons.push(`Overall ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} (threshold ±${threshold} for ${runs} judge run${runs > 1 ? "s" : ""})`);
  for (const d of dimensionDrops) reasons.push(`${d.dimension} fell by ${d.drop.toFixed(1)}`);
  if (addressedRate !== null) reasons.push(`${Math.round(addressedRate * 100)}% of instructions addressed`);
  if (pairwise) reasons.push(`Side-by-side judge preferred: ${pairwise.winner} (confidence ${pairwise.confidence}/5)`);

  const improved = delta >= threshold && dimensionDrops.length === 0 && (addressedRate === null || addressedRate >= 0.8);
  const verdict = improved ? "improved" : delta <= -threshold ? "regressed" : "mixed";
  return { verdict, delta, threshold, dimensionDrops, addressedRate, pairwise, reasons };
}

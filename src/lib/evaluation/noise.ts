import fs from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { DIMENSIONS, type Dimension } from "@/lib/schemas/evaluation";
import { evaluateArticle } from "./evaluate";

export function noiseStats(values: number[]): { n: number; mean: number; std: number; range: number } {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const std = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, std, range: Math.max(...values) - Math.min(...values) };
}

/**
 * Smallest overall-score rise that counts as a real improvement: two standard deviations of the
 * difference between two independent scores, each the mean of `judgeRuns` judge runs.
 */
export const improvementThreshold = (sigma: number, judgeRuns: number) => (2 * Math.SQRT2 * sigma) / Math.sqrt(judgeRuns);

export type NoiseReport = {
  runId: string;
  version: number;
  overall: { values: number[]; mean: number; std: number; range: number };
  dimensions: Record<Dimension, { values: number[]; std: number }>;
  measuredIdentical: boolean;
};

/** Scores one saved draft `times` times with a single judge run each, without saving the scores. */
export async function measureNoise(
  ctx: Parameters<typeof evaluateArticle>[0] & { runId: string },
  version: number,
  times: number,
): Promise<NoiseReport> {
  const results = await Promise.all(Array.from({ length: times }, () => evaluateArticle(ctx, { judgeRuns: 1 })));
  const overall = results.map((r) => r.overall);
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((d) => {
      const values = results.map((r) => r.dimensions[d].score);
      return [d, { values, std: noiseStats(values).std }];
    }),
  ) as NoiseReport["dimensions"];
  const measured = results.map((r) => JSON.stringify(DIMENSIONS.map((d) => r.dimensions[d].deterministic)));
  const report: NoiseReport = {
    runId: ctx.runId,
    version,
    overall: { values: overall, ...noiseStats(overall) },
    dimensions,
    measuredIdentical: new Set(measured).size === 1,
  };
  const dir = path.resolve(getConfig().VRYSE_DATA_DIR, "calibration");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `noise-${ctx.runId.slice(0, 8)}-v${version}.json`), JSON.stringify(report, null, 2));
  return report;
}

import { DIMENSIONS, WEIGHTS, type Dimension, type DimensionScore } from "@/lib/schemas/evaluation";

export type DimensionInput = DimensionScore & {
  /** Share of the dimension score that comes from the judge when both parts exist. */
  judgeShare: number;
};

/**
 * Blends the measured and judged parts of each dimension, then weights the dimensions into an
 * overall score. A dimension with neither part is dropped and the remaining weights are rescaled.
 */
export function combine(
  input: Record<Dimension, DimensionInput>,
  opts: { capAt: number | null },
): { overall: number; capped: boolean; dimensions: Record<Dimension, DimensionScore> } {
  const scored = DIMENSIONS.map((name) => {
    const { judgeShare, ...d } = input[name];
    const score =
      d.deterministic !== null && d.judge !== null
        ? (1 - judgeShare) * d.deterministic + judgeShare * d.judge
        : (d.deterministic ?? d.judge);
    return { name, d, score };
  });

  const totalWeight = scored.reduce((sum, s) => sum + (s.score === null ? 0 : WEIGHTS[s.name]), 0);
  const dimensions = Object.fromEntries(
    scored.map(({ name, d, score }) => [
      name,
      { ...d, score: score ?? 0, weight: score === null || !totalWeight ? 0 : WEIGHTS[name] / totalWeight },
    ]),
  ) as Record<Dimension, DimensionScore>;

  const raw = Object.values(dimensions).reduce((sum, d) => sum + d.score * d.weight, 0);
  const capped = opts.capAt !== null && raw > opts.capAt;
  return { overall: capped ? opts.capAt! : raw, capped, dimensions };
}

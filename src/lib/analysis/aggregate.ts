export type Band = { p10: number; p25: number; median: number; p75: number; p90: number; mean: number; n: number };

export type Distributions = {
  numeric: Record<string, Band>;
  /** Share of articles where a boolean feature is true. */
  rates: Record<string, number>;
};

/** Linear-interpolation percentile (the same method as numpy's default). */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function aggregate(rows: Record<string, number | boolean | null>[]): Distributions {
  const numeric: Record<string, number[]> = {};
  const flags: Record<string, boolean[]> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "number" && Number.isFinite(value)) (numeric[key] ??= []).push(value);
      else if (typeof value === "boolean") (flags[key] ??= []).push(value);
      else if (value === null) numeric[key] ??= [];
    }
  }
  const bands: Record<string, Band> = {};
  for (const [key, values] of Object.entries(numeric)) {
    if (!values.length) continue;
    bands[key] = {
      p10: percentile(values, 0.1),
      p25: percentile(values, 0.25),
      median: percentile(values, 0.5),
      p75: percentile(values, 0.75),
      p90: percentile(values, 0.9),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      n: values.length,
    };
  }
  const rates = Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, v.filter(Boolean).length / v.length]));
  return { numeric: bands, rates };
}

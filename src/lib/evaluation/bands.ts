import type { Band } from "@/lib/analysis/aggregate";

/**
 * 100 inside the reference corpus's p10–p90 band, falling linearly to 0 at one IQR outside it.
 * `side` limits the penalty to values below ("lower") or above ("upper") the band.
 */
export function bandScore(value: number, band: Band, side: "both" | "lower" | "upper" = "both"): number {
  const width = band.p75 - band.p25 || (band.p90 - band.p10) / 2 || 1;
  let distance = 0;
  if (value < band.p10 && side !== "upper") distance = band.p10 - value;
  if (value > band.p90 && side !== "lower") distance = value - band.p90;
  return 100 * Math.max(0, 1 - distance / width);
}

/** 100 within ±10% of the target length, falling linearly to 0 at ±50%. */
export function lengthScore(words: number, target: number): number {
  const drift = Math.abs(words - target) / target;
  return 100 * Math.min(1, Math.max(0, (0.5 - drift) / 0.4));
}

/** The judge's anchored 1–5 rubric score on a 0–100 scale. */
export const judgeToScore = (score: number) => (score - 1) * 25;

const short = (x: number) => (Math.abs(x) < 1 ? +x.toFixed(3) : +x.toFixed(1));
export const fmtBand = (b: Band) => `${short(b.p10)}–${short(b.p90)}`;

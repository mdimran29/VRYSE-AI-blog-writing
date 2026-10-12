import { describe, expect, it } from "vitest";
import { bandScore, judgeToScore, lengthScore } from "@/lib/evaluation/bands";
import { combine } from "@/lib/evaluation/scoring";
import type { DimensionScore } from "@/lib/schemas/evaluation";

const band = { p10: 10, p25: 12, median: 15, p75: 18, p90: 20, mean: 15, n: 50 };

describe("bandScore", () => {
  it("scores 100 anywhere inside p10–p90", () => {
    expect(bandScore(10, band)).toBe(100);
    expect(bandScore(20, band)).toBe(100);
  });

  it("falls linearly to 0 at one IQR outside the band", () => {
    // IQR = 6 → 23 is half an IQR above p90
    expect(bandScore(23, band)).toBeCloseTo(50);
    expect(bandScore(26, band)).toBe(0);
    expect(bandScore(4, band)).toBe(0);
  });

  it("can penalise only one side", () => {
    expect(bandScore(2, band, "upper")).toBe(100);
    expect(bandScore(23, band, "lower")).toBe(100);
    expect(bandScore(23, band, "upper")).toBeCloseTo(50);
  });

  it("uses half the p10–p90 width when the IQR is zero", () => {
    const flat = { ...band, p25: 15, p75: 15 }; // fallback width (20-10)/2 = 5
    expect(bandScore(22.5, flat)).toBeCloseTo(50);
  });
});

describe("lengthScore", () => {
  it("is 100 within ±10% and 0 at ±50%", () => {
    expect(lengthScore(1550, 1500)).toBe(100);
    expect(lengthScore(2250, 1500)).toBe(0);
    expect(lengthScore(1950, 1500)).toBeCloseTo(50); // +30%
  });
});

describe("judgeToScore", () => {
  it("maps 1–5 onto 0–100", () => {
    expect(judgeToScore(1)).toBe(0);
    expect(judgeToScore(3)).toBe(50);
    expect(judgeToScore(5)).toBe(100);
  });
});

const dim = (deterministic: number | null, judge: number | null, judgeShare = 0.5): DimensionScore & { judgeShare: number } => ({
  score: 0,
  weight: 0,
  deterministic,
  judge,
  features: [],
  judgeShare,
});

describe("combine", () => {
  const all = {
    structure: dim(80, 60),
    style: dim(90, 70),
    relevance: dim(100, 80),
    completeness: dim(100, 50, 0.6),
    tone: dim(null, 75, 1),
    readability: dim(60, 100),
    specificity: dim(40, 60),
  };

  it("blends each dimension and weights them into an overall score", () => {
    const result = combine(all, { capAt: null });
    expect(result.dimensions.structure.score).toBe(70);
    expect(result.dimensions.completeness.score).toBeCloseTo(0.4 * 100 + 0.6 * 50);
    expect(result.dimensions.tone.score).toBe(75);
    // 0.2·70 + 0.2·80 + 0.15·90 + 0.15·70 + 0.1·75 + 0.1·80 + 0.1·50
    expect(result.overall).toBeCloseTo(74.5);
    expect(result.capped).toBe(false);
  });

  it("falls back to the measured score when the judge is unavailable, and drops judge-only dimensions", () => {
    const noJudge = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { ...v, judge: null }])) as typeof all;
    const result = combine(noJudge, { capAt: null });
    expect(result.dimensions.structure.score).toBe(80);
    expect(result.dimensions.tone.weight).toBe(0);
    const weights = Object.values(result.dimensions).reduce((s, d) => s + d.weight, 0);
    expect(weights).toBeCloseTo(1);
  });

  it("caps the overall score when a required section is missing", () => {
    expect(combine(all, { capAt: 70 })).toMatchObject({ overall: 70, capped: true });
  });
});

import { describe, expect, it } from "vitest";
import { aggregate, percentile } from "@/lib/analysis/aggregate";
import { signatureTerms } from "@/lib/analysis/terms";

describe("percentile", () => {
  it("interpolates linearly between ranks", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.5)).toBeCloseTo(5.5);
    expect(percentile(values, 0.1)).toBeCloseTo(1.9);
    expect(percentile(values, 0.9)).toBeCloseTo(9.1);
  });
});

describe("aggregate", () => {
  it("summarises numeric features as bands and boolean features as rates", () => {
    const result = aggregate([
      { words: 1000, hasFaq: true },
      { words: 2000, hasFaq: true },
      { words: 3000, hasFaq: false },
      { words: 4000, hasFaq: true },
    ]);
    expect(result.numeric.words).toMatchObject({ median: 2500, mean: 2500, n: 4 });
    expect(result.rates.hasFaq).toBeCloseTo(0.75);
  });

  it("skips null values", () => {
    const result = aggregate([{ grade: 8 }, { grade: null }, { grade: 10 }]);
    expect(result.numeric.grade.n).toBe(2);
    expect(result.numeric.grade.median).toBe(9);
  });
});

describe("signatureTerms", () => {
  it("ranks domain terms used across many docs above one-off words and stopwords", () => {
    const docs = [
      "route optimisation reduces employee transport cost and the cost of commute",
      "employee transport needs route optimisation for every shift",
      "employee transport safety matters; route optimisation helps with a banana",
    ];
    const terms = signatureTerms(docs, 5).map((t) => t.term);
    expect(terms).toContain("route optimisation");
    expect(terms).toContain("employee transport");
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("banana");
  });
});

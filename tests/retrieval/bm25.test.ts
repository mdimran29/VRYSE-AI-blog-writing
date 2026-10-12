import { describe, expect, it } from "vitest";
import { Bm25 } from "@/lib/retrieval/bm25";

describe("Bm25", () => {
  const docs = [
    "route optimisation cuts fuel cost for employee transport",
    "night shift safety for women employees with escorts",
    "fuel cost fuel cost fuel cost",
    "a long article about many unrelated things such as weather sports music food travel and fuel",
  ];
  const bm25 = new Bm25(docs);

  it("scores documents containing the query terms above those that don't", () => {
    const s = bm25.scores("route optimisation");
    expect(s[0]).toBeGreaterThan(0);
    expect(s[1]).toBe(0);
  });

  it("ignores stopwords and case", () => {
    expect(bm25.scores("The SAFETY of")).toEqual(bm25.scores("safety"));
  });

  it("favours rarer terms (idf)", () => {
    const s = bm25.scores("escorts fuel");
    // "escorts" appears in one doc, "fuel" in three — the escorts doc should win.
    expect(s.indexOf(Math.max(...s))).toBe(1);
  });

  it("penalises long documents for the same term frequency", () => {
    const s = bm25.scores("fuel");
    expect(s[0]).toBeGreaterThan(s[3]);
  });

  it("returns zeros for an empty query", () => {
    expect(bm25.scores("the and of")).toEqual([0, 0, 0, 0]);
  });
});

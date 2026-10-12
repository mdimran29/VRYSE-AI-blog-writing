import { describe, expect, it } from "vitest";
import { countSyllables, fleschKincaidGrade, fleschReadingEase, readability } from "@/lib/analysis/readability";
import { splitSentences, splitWords } from "@/lib/analysis/text";

describe("splitWords", () => {
  it("keeps contractions and numbers as single words and drops punctuation", () => {
    expect(splitWords("Don't cut costs in 2026, e.g. by 50%!")).toEqual(["Don't", "cut", "costs", "in", "2026", "e.g", "by", "50"]);
  });

  it("returns nothing for empty text", () => {
    expect(splitWords("   ")).toEqual([]);
  });
});

describe("splitSentences", () => {
  it("splits on sentence punctuation and trims", () => {
    expect(splitSentences("Routes matter. Do they? Yes! Plan ahead.")).toEqual(["Routes matter.", "Do they?", "Yes!", "Plan ahead."]);
  });

  it("returns nothing for empty text", () => {
    expect(splitSentences("")).toEqual([]);
  });
});

describe("readability formulas", () => {
  // "The cat sat on the mat." → 6 words, 1 sentence, 6 syllables
  it("computes Flesch Reading Ease", () => {
    expect(fleschReadingEase({ words: 6, sentences: 1, syllables: 6 })).toBeCloseTo(116.145, 3);
  });

  it("computes Flesch-Kincaid grade", () => {
    expect(fleschKincaidGrade({ words: 6, sentences: 1, syllables: 6 })).toBeCloseTo(-1.45, 3);
  });

  it("counts syllables per word", () => {
    expect(countSyllables(["the", "cat", "transportation"])).toBe(1 + 1 + 4);
  });

  it("scores real text end to end and handles empty input", () => {
    const r = readability("The cat sat on the mat.");
    expect(r.fleschReadingEase).toBeCloseTo(116.145, 3);
    expect(readability("")).toEqual({ fleschReadingEase: null, fleschKincaidGrade: null });
  });
});

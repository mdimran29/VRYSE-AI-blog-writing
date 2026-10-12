import { describe, expect, it } from "vitest";
import { avoidPhrases, statsDigest } from "@/lib/analysis/profile";
import type { CorpusStats } from "@/lib/analysis/stats";

const band = (median: number) => ({ p10: median - 1, p25: median, median, p75: median, p90: median + 1, mean: median, n: 10 });

const stats: CorpusStats = {
  company: "acme",
  brandTerms: ["Acme"],
  articleCount: 50,
  articleIds: [],
  distributions: {
    numeric: { wordCount: band(1500), h2Count: band(7), wordsPerSentenceMean: band(15) },
    rates: { hasFaq: 1, hasKeyTakeaways: 0.28 },
  },
  signatureTerms: [
    { term: "route optimisation", docFrequency: 40, count: 300, score: 1 },
    { term: "fleet", docFrequency: 30, count: 100, score: 0.5 },
  ],
  aiIsms: [
    { phrase: "seamless", articles: 8, total: 12 },
    { phrase: "leverage", articles: 2, total: 2 },
  ],
  sectionOrder: {
    articles: 50,
    keyTakeaways: { articles: 15, firstSection: 11 },
    faq: { articles: 50, lastSection: 48 },
    conclusion: { articles: 30, beforeFaq: 30, afterFaq: 0 },
  },
  builtAt: "",
};

describe("avoidPhrases", () => {
  it("lists every known AI-ism the corpus uses in under 10% of articles", () => {
    const avoid = avoidPhrases(stats);
    expect(avoid).toContain("leverage"); // 2/50 = 4%
    expect(avoid).toContain("delve"); // never used
    expect(avoid).not.toContain("seamless"); // 8/50 = 16%, part of the house style
  });
});

describe("statsDigest", () => {
  it("summarises bands, rates and terms as compact text for a prompt", () => {
    const digest = statsDigest(stats);
    expect(digest).toContain("wordCount: p10 1499 · median 1500 · p90 1501");
    expect(digest).toContain("hasFaq: 100% of articles");
    expect(digest).toContain("hasKeyTakeaways: 28% of articles");
    expect(digest).toContain("route optimisation (40/50)");
    expect(digest).toContain("Key takeaways section in 15/50 articles (the first section after the intro in 11)");
    expect(digest).toContain("FAQ in 50/50 articles (the last section in 48)");
    expect(digest).toContain("Conclusion heading in 30/50 articles (before the FAQ in 30, after it in 0)");
  });
});

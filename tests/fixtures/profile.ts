import type { CompanyStyleProfile } from "@/lib/schemas/profile";

const band = (p10: number, median: number, p90: number) => ({ p10, p25: median, median, p75: median, p90, mean: median, n: 50 });

/** A small, hand-made profile for generation tests. */
export const testProfile: CompanyStyleProfile = {
  company: "acme",
  version: 1,
  brandTerms: ["Acme"],
  corpus: { articleCount: 50, articleIds: [], extractedArticles: 50 },
  stats: {
    distributions: {
      numeric: {
        wordCount: band(1200, 1500, 2200),
        h2Count: band(5, 7, 10),
        h3PerH2: band(0, 1, 3),
        introWords: band(80, 125, 210),
        closingWords: band(50, 105, 190),
        wordsPerParagraphMean: band(25, 32, 49),
        oneSentenceParagraphRate: band(0.1, 0.3, 0.57),
        wordsPerSentenceMean: band(11, 15, 18),
        fleschKincaidGrade: band(10, 14, 17),
        boldPer1k: band(3, 9.5, 17),
        linksPer1k: band(2.8, 4.2, 6.3),
        numbersPer1k: band(6, 15, 30),
        secondPersonPer1k: band(0, 4, 14),
        faqQuestionCount: band(4, 5, 5),
      },
      rates: { hasFaq: 1, hasKeyTakeaways: 0.28, hasConclusionHeading: 0.63, closingHasCta: 0.5 },
    },
    signatureTerms: [{ term: "route optimisation", docFrequency: 40, count: 300, score: 1 }],
    aiIsms: [{ phrase: "seamless", articles: 8, total: 12 }],
    sectionOrder: {
      articles: 50,
      keyTakeaways: { articles: 14, firstSection: 10 },
      faq: { articles: 50, lastSection: 48 },
      conclusion: { articles: 31, beforeFaq: 31, afterFaq: 0 },
    },
  },
  guide: {
    summary: "Practical, evidence-first guides for transport heads.",
    audience: "HR and transport heads at Indian enterprises",
    voice: { tone: ["practical", "authoritative"], formality: "professional", pointOfView: "you to the reader", personality: "plain and direct" },
    structure: {
      typicalOutline: ["intro", "key takeaways (optional)", "body", "conclusion", "FAQ"],
      introPatterns: [{ pattern: "pain point → statistic → what this covers", articles: 22, example: "" }],
      conclusionPatterns: [{ pattern: "recap → CTA", articles: 20, example: "" }],
      ctaPatterns: [{ pattern: "demo invitation in the final section", articles: 21, example: "" }],
      headingStyle: "keyword-led statements",
      faqStyle: "4-6 short questions",
    },
    content: { exampleUsage: "client results", dataUsage: "linked statistics", productMentions: "Acme as one option" },
    vocabulary: { preferredTerms: ["employee transport"], spelling: "British spelling; ₹ for currency", avoid: ["industry-leading"] },
    formatting: ["bold lead-ins on list items"],
    rules: { do: ["DO-RULE-MARKER open with a concrete problem"], dont: ["DONT-RULE-MARKER no self-promotional openings"] },
  },
  avoidPhrases: ["delve", "game-changer"],
  models: { extraction: "x", synthesis: "y" },
  builtAt: "",
};

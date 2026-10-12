import { z } from "zod";

/** What one reference article does — extracted per article by the analysis model. */
export const ArticleTraitsSchema = z.object({
  introPattern: z.string().describe("The moves the intro makes, as a short arrow sequence, e.g. 'reader pain point → statistic → what this article covers'"),
  conclusionPattern: z.string().describe("The moves the final section makes, as a short arrow sequence"),
  ctaStyle: z.string().describe("How the article asks the reader to act (what, where, how direct). 'none' if it doesn't"),
  tone: z.array(z.string()).describe("2-5 adjectives for the voice, e.g. 'practical', 'authoritative'"),
  audience: z.string().describe("Who the article is written for, as specifically as the text shows"),
  pointOfView: z.string().describe("How the writer addresses the reader and refers to the company, e.g. 'you to the reader; brand in third person'"),
  exampleUsage: z.string().describe("What kinds of examples appear and how often (case results, scenarios, named cities, none)"),
  dataUsage: z.string().describe("How statistics, numbers and sources are used, and whether they are cited or linked"),
  productMentions: z.string().describe("Where and how the company/product is mentioned and how promotional it is"),
  terminology: z.array(z.string()).describe("Up to 12 domain terms or phrases the article relies on"),
  headingStyle: z.string().describe("How headings are phrased (questions, numbered items, keyword-led, length)"),
  faqStyle: z.string().describe("How the FAQ is written (question style, answer length); 'none' if there is no FAQ"),
  formattingDevices: z.array(z.string()).describe("Up to 8 recurring formatting or rhetorical devices, e.g. 'bold lead-in on list items', 'comparison table'"),
});
export type ArticleTraits = z.infer<typeof ArticleTraitsSchema>;

const Pattern = z.object({
  pattern: z.string(),
  articles: z.number().describe("How many of the analysed articles show this pattern"),
  // Required, not optional: OpenAI strict structured output rejects schemas with optional fields.
  example: z.string().describe("A short paraphrase or quote showing the pattern; empty string if none"),
});

/** The company's style guide — consolidated from all article traits by the writer model. */
export const StyleGuideSchema = z.object({
  summary: z.string().describe("2-3 sentences a new writer should read first"),
  audience: z.string(),
  voice: z.object({
    tone: z.array(z.string()).describe("3-6 adjectives, most characteristic first"),
    formality: z.string(),
    pointOfView: z.string(),
    personality: z.string().describe("What makes the voice recognisable, in one or two sentences"),
  }),
  structure: z.object({
    typicalOutline: z.array(z.string()).describe("The usual section roles in order, e.g. 'intro', 'key takeaways', 'what is X', ..."),
    introPatterns: z.array(Pattern),
    conclusionPatterns: z.array(Pattern),
    ctaPatterns: z.array(Pattern),
    headingStyle: z.string(),
    faqStyle: z.string(),
  }),
  content: z.object({
    exampleUsage: z.string(),
    dataUsage: z.string(),
    productMentions: z.string(),
  }),
  vocabulary: z.object({
    preferredTerms: z.array(z.string()).describe("Up to 25 terms the company uses consistently"),
    spelling: z.string().describe("Spelling and style conventions, e.g. British vs American spelling, number formatting"),
    avoid: z.array(z.string()).describe("Words, phrases or habits the articles avoid"),
  }),
  formatting: z.array(z.string()).describe("Formatting conventions that recur across articles"),
  rules: z.object({
    do: z.array(z.string()).describe("6-12 concrete, checkable rules a writer must follow"),
    dont: z.array(z.string()).describe("6-12 concrete, checkable things a writer must avoid"),
  }),
});
export type StyleGuide = z.infer<typeof StyleGuideSchema>;

export type CompanyStyleProfile = {
  company: string;
  version: number;
  brandTerms: string[];
  corpus: { articleCount: number; articleIds: string[]; extractedArticles: number };
  stats: {
    distributions: import("@/lib/analysis/aggregate").Distributions;
    signatureTerms: import("@/lib/analysis/terms").Term[];
    aiIsms: { phrase: string; articles: number; total: number }[];
    sectionOrder: import("@/lib/analysis/metrics").SectionOrder;
  };
  guide: StyleGuide;
  /** AI-isms the human corpus rarely uses — the writer should avoid them and the evaluator flags them. */
  avoidPhrases: string[];
  models: { extraction: string; synthesis: string };
  builtAt: string;
};

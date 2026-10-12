import type { Band } from "@/lib/analysis/aggregate";
import type { Features } from "@/lib/analysis/metrics";
import type { LintResult } from "@/lib/generation/lint";
import type { ResolvedBrief } from "@/lib/schemas/generation";
import type { Dimension, FeatureScore, Weakness } from "@/lib/schemas/evaluation";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";
import { bandScore, fmtBand, lengthScore } from "./bands";

type NumericFeature = { [K in keyof Features]: Features[K] extends number | null ? K : never }[keyof Features];
type Spec = { feature: NumericFeature; label: string; side?: "both" | "lower" | "upper"; tooHigh: string; tooLow: string };

const SPECS: Partial<Record<Dimension, Spec[]>> = {
  structure: [
    { feature: "h2Count", label: "H2 sections", tooHigh: "Merge or cut sections.", tooLow: "Split the content into more H2 sections." },
    { feature: "h3PerH2", label: "H3 subheadings per H2", tooHigh: "Use fewer subheadings.", tooLow: "Break long sections up with H3 subheadings." },
    { feature: "introWords", label: "intro words", tooHigh: "Tighten the intro.", tooLow: "Expand the intro: problem, evidence, then what the article covers." },
    { feature: "closingWords", label: "closing-section words", tooHigh: "Shorten the closing section.", tooLow: "Give the closing section more substance." },
    { feature: "faqQuestionCount", label: "FAQ questions", tooHigh: "Trim the FAQ.", tooLow: "Add FAQ questions." },
  ],
  style: [
    { feature: "wordsPerSentenceMean", label: "words per sentence", tooHigh: "Split long sentences.", tooLow: "Combine choppy sentences." },
    { feature: "wordsPerSentenceStd", label: "sentence-length variation", tooHigh: "Even out sentence lengths.", tooLow: "Vary sentence length more." },
    { feature: "wordsPerParagraphMean", label: "words per paragraph", tooHigh: "Break up long paragraphs.", tooLow: "Merge very short paragraphs." },
    { feature: "oneSentenceParagraphRate", label: "share of one-sentence paragraphs", tooHigh: "Develop more paragraphs beyond one sentence.", tooLow: "Use some single-sentence paragraphs for emphasis." },
    { feature: "sentenceStartDiversity", label: "variety of sentence openings", side: "lower", tooHigh: "", tooLow: "Vary how sentences start." },
    { feature: "secondPersonPer1k", label: "uses of 'you' per 1,000 words", tooHigh: "Address the reader less often.", tooLow: "Address the reader directly ('you') more often." },
    { feature: "firstPersonPluralPer1k", label: "uses of 'we' per 1,000 words", tooHigh: "Use 'we' less; refer to the company in the third person.", tooLow: "" },
    { feature: "boldPer1k", label: "bold phrases per 1,000 words", tooHigh: "Bold less.", tooLow: "Bold the primary keyword and key phrases as the house style does." },
    { feature: "linksPer1k", label: "links per 1,000 words", tooHigh: "Use fewer links.", tooLow: "Link to related articles and sources (only real URLs)." },
    { feature: "aiIsmsPer1k", label: "generic AI-style phrases per 1,000 words", side: "upper", tooHigh: "Remove generic AI-style phrases.", tooLow: "" },
  ],
  readability: [
    { feature: "fleschKincaidGrade", label: "reading grade", tooHigh: "Simplify wording and shorten sentences.", tooLow: "The text is simpler than the house style; use the audience's terminology." },
    { feature: "fleschReadingEase", label: "reading ease", tooHigh: "Use the audience's terminology; the text is simpler than usual.", tooLow: "Simplify wording and shorten sentences." },
  ],
  specificity: [
    { feature: "numbersPer1k", label: "numbers per 1,000 words", side: "lower", tooHigh: "", tooLow: "Add concrete figures and examples from the sources." },
  ],
};

const fmt = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(0) : n < 1 && n > 0 ? n.toFixed(2) : n.toFixed(1));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const severityOf = (score: number): Weakness["severity"] => (score < 30 ? "high" : "medium");

export type SemanticSignals = {
  /** Cosine of the article to the company's centroid, and the same for every reference article. */
  styleSimilarity: number | null;
  styleBand: Band | null;
  /** Cosine of the article to the brief, and how reference articles compare with the same brief. */
  relevanceSimilarity: number | null;
  relevanceRef: { p50: number; p90: number } | null;
};

export type MeasuredResult = {
  dimensions: Record<Dimension, { deterministic: number | null; features: FeatureScore[] }>;
  weaknesses: Weakness[];
};

/** The code-measured half of every dimension, plus weaknesses for features well outside the house range. */
export function measuredScores(input: {
  features: Features;
  profile: CompanyStyleProfile;
  brief: ResolvedBrief;
  lint: LintResult;
  semantic: SemanticSignals;
}): MeasuredResult {
  const { features, profile, brief, lint, semantic } = input;
  const bands = profile.stats.distributions.numeric;
  const company = profile.company;
  const weaknesses: Weakness[] = [];
  const out = {} as MeasuredResult["dimensions"];
  for (const d of ["structure", "style", "relevance", "completeness", "tone", "readability", "specificity"] as const) {
    out[d] = { deterministic: null, features: [] };
  }

  for (const [dimension, specs] of Object.entries(SPECS) as [Dimension, Spec[]][]) {
    for (const spec of specs) {
      const value = features[spec.feature];
      const band = bands[spec.feature];
      if (value === null || !band) continue;
      const score = bandScore(value, band, spec.side);
      out[dimension].features.push({ feature: spec.feature, value, band: fmtBand(band), score });
      if (score < 60) {
        const high = value > band.p90;
        weaknesses.push({
          issue: `Measured ${spec.label}: ${fmt(value)} (${company} range ${fmtBand(band)})`,
          severity: severityOf(score),
          dimension,
          evidence: "",
          recommendation: high ? spec.tooHigh : spec.tooLow,
          target: "global",
          source: "measured",
        });
      }
    }
  }

  // Structure: sections every house article has.
  const rates = profile.stats.distributions.rates;
  if ((rates.hasFaq ?? 0) >= 0.8) {
    out.structure.features.push({ feature: "hasFaq", value: features.hasFaq ? 1 : 0, band: `in ${Math.round(rates.hasFaq * 100)}% of articles`, score: features.hasFaq ? 100 : 0 });
    if (!features.hasFaq) {
      weaknesses.push({ issue: "No FAQ section", severity: "high", dimension: "structure", evidence: "", recommendation: "Add an FAQ as the final section.", target: "global", source: "measured" });
    }
    const order = profile.stats.sectionOrder.faq;
    if (features.hasFaq && order.articles && order.lastSection / order.articles >= 0.8) {
      const last = !lint.issues.some((i) => i.code === "faq-position");
      out.structure.features.push({ feature: "faqLast", value: last ? 1 : 0, band: `last in ${order.lastSection}/${order.articles} articles`, score: last ? 100 : 0 });
    }
  }

  // Style: holistic closeness to the company's articles in embedding space.
  if (semantic.styleSimilarity !== null && semantic.styleBand) {
    const score = bandScore(semantic.styleSimilarity, semantic.styleBand, "lower");
    out.style.features.push({ feature: "styleSimilarity", value: semantic.styleSimilarity, band: fmtBand(semantic.styleBand), score });
    if (score < 60) {
      weaknesses.push({ issue: `Overall similarity to ${company}'s articles is low (${semantic.styleSimilarity.toFixed(3)}; references ${fmtBand(semantic.styleBand)})`, severity: severityOf(score), dimension: "style", evidence: "", recommendation: "Follow the house voice and formatting more closely.", target: "global", source: "measured" });
    }
  }

  // Relevance: the article should sit closer to the brief than most reference articles do.
  if (semantic.relevanceSimilarity !== null && semantic.relevanceRef) {
    const { p50, p90 } = semantic.relevanceRef;
    const score = 100 * Math.min(1, Math.max(0, (semantic.relevanceSimilarity - p50) / Math.max(1e-6, p90 - p50)));
    out.relevance.features.push({ feature: "briefSimilarity", value: semantic.relevanceSimilarity, band: `references p50 ${p50.toFixed(3)} · p90 ${p90.toFixed(3)}`, score });
  }

  // Completeness: length against the brief and required sections.
  const lengthPart = lengthScore(features.wordCount, brief.targetWords);
  out.completeness.features.push({ feature: "length", value: features.wordCount, band: `target ${brief.targetWords}`, score: lengthPart });
  if (lengthPart < 60) {
    weaknesses.push({ issue: `Length is ${features.wordCount} words; the brief asks for about ${brief.targetWords}`, severity: severityOf(lengthPart), dimension: "completeness", evidence: "", recommendation: features.wordCount > brief.targetWords ? "Cut repetition and secondary detail." : "Develop the key points further.", target: "global", source: "measured" });
  }
  if (brief.requiredSections.length) {
    const missing = lint.issues.filter((i) => i.code === "required-section-missing").length;
    const score = 100 * (1 - missing / brief.requiredSections.length);
    out.completeness.features.push({ feature: "requiredSections", value: brief.requiredSections.length - missing, band: `${brief.requiredSections.length} required`, score });
  }

  // Specificity: unsupported figures cost 10 points each.
  const unsupported = lint.metrics.unsupportedFigures.length;
  if (unsupported) {
    out.specificity.features.push({ feature: "unsupportedFigures", value: unsupported, band: "0", score: -10 * unsupported, note: lint.metrics.unsupportedFigures.join(", ") });
  }

  for (const d of Object.keys(out) as Dimension[]) {
    const bandScores = out[d].features.filter((f) => f.feature !== "unsupportedFigures").map((f) => f.score);
    const base = mean(bandScores);
    if (base === null) continue;
    const penalty = out[d].features.find((f) => f.feature === "unsupportedFigures")?.score ?? 0;
    out[d].deterministic = Math.max(0, base + penalty);
  }
  return { dimensions: out, weaknesses };
}

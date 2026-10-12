import { findAiIsms } from "@/lib/analysis/ai-isms";
import { extractFeatures, FAQ } from "@/lib/analysis/metrics";
import { splitWords } from "@/lib/analysis/text";
import { inlineToPlain, markdownToBlocks } from "@/lib/ingest/markdown";
import type { Issue, ResolvedBrief } from "@/lib/schemas/generation";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";
import { hasSection } from "./planner";

/** Word n-grams and URLs of the reference corpus, for copy and fabricated-link checks. */
export type CorpusFingerprint = { ngrams12: Set<string>; ngrams8: Set<string>; urls: Set<string>; figures: Set<string> };

const FIGURE = /(₹\s?)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(%|percent\b|million\b|billion\b|lakh\b|crore\b|km\b|kwh\b)?/gi;

/**
 * Figures worth checking against sources: amounts with a unit (%, ₹, million, km…) and bare numbers
 * of 100 or more. Small counts ("5 steps") and years are skipped. Normalised so "18 percent" = "18%".
 */
export function extractFigures(text: string): string[] {
  const out = new Set<string>();
  for (const m of inlineToPlain(text).matchAll(FIGURE)) {
    const rupee = Boolean(m[1]);
    const digits = m[2].replace(/,/g, "");
    const unit = (m[3] ?? "").toLowerCase().replace("percent", "%");
    const value = Number(digits);
    const isYear = Number.isInteger(value) && value >= 1990 && value <= 2035 && !m[2].includes(",");
    if (!rupee && !unit && (value < 100 || isYear)) continue;
    out.add(`${rupee ? "₹" : ""}${digits}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`);
  }
  return [...out];
}

const URL_IN_MARKDOWN = /\]\((https?:\/\/[^)\s]+)\)/g;
const normUrl = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

const plainWords = (markdown: string) =>
  splitWords(inlineToPlain(markdown.replace(/^#+\s+/gm, "").replace(/^\s*[-*+]\s+|^\s*\d+[.)]\s+/gm, "").replace(/\|/g, " ")).toLowerCase());

function ngrams(words: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(" "));
  return out;
}

export function buildCorpusFingerprint(markdownDocs: string[]): CorpusFingerprint {
  const fp: CorpusFingerprint = { ngrams12: new Set(), ngrams8: new Set(), urls: new Set(), figures: new Set() };
  for (const md of markdownDocs) {
    const words = plainWords(md);
    for (const g of ngrams(words, 12)) fp.ngrams12.add(g);
    for (const g of ngrams(words, 8)) fp.ngrams8.add(g);
    for (const m of md.matchAll(URL_IN_MARKDOWN)) fp.urls.add(normUrl(m[1]));
    for (const f of extractFigures(md)) fp.figures.add(f);
  }
  return fp;
}

export type LintResult = {
  issues: Issue[];
  metrics: {
    words: number;
    h2Count: number;
    faqQuestions: number;
    copiedPassages: string[];
    unverifiedUrls: string[];
    unsupportedFigures: string[];
    avoidPhrases: string[];
  };
};

/** Deterministic checks on a generated article. Hard issues trigger one repair attempt. */
export function lintArticle(
  markdown: string,
  ctx: { brief: ResolvedBrief; profile: CompanyStyleProfile; fingerprint: CorpusFingerprint },
): LintResult {
  const { brief, profile, fingerprint } = ctx;
  const blocks = markdownToBlocks(markdown);
  const features = extractFeatures(blocks, { brandTerms: profile.brandTerms });
  const n = profile.stats.distributions.numeric;
  const issues: Issue[] = [];
  const add = (severity: Issue["severity"], code: string, message: string) => issues.push({ code, severity, message });

  const h1s = blocks.filter((b) => b.type === "heading" && b.level === 1).length;
  if (h1s !== 1) add("hard", "h1", `The article must have exactly one H1 title; it has ${h1s}.`);

  const drift = (features.wordCount - brief.targetWords) / brief.targetWords;
  if (Math.abs(drift) > 0.25) {
    add("hard", "length", `The article has ${features.wordCount} words; the target is ${brief.targetWords} (±25%). ${drift > 0 ? "Cut" : "Expand"} it.`);
  }

  if ((profile.stats.distributions.rates.hasFaq ?? 0) >= 0.5 && !features.hasFaq) {
    add("hard", "faq-missing", "Add an FAQ section as the final H2, as every house article has one.");
  }

  const headings = blocks.filter((b) => b.type === "heading" && b.level >= 2).map((b) => (b.type === "heading" ? b.text : ""));
  const parts = { faq: features.hasFaq, keyTakeaways: features.hasKeyTakeaways, conclusion: features.hasConclusionHeading };
  for (const required of brief.requiredSections) {
    if (!hasSection(required, headings, parts)) add("hard", "required-section-missing", `Required section "${required}" is missing.`);
  }

  const unverifiedUrls = [...markdown.matchAll(URL_IN_MARKDOWN)].map((m) => m[1]).filter((u) => !fingerprint.urls.has(normUrl(u)));
  if (unverifiedUrls.length) {
    add("hard", "unverified-url", `These links do not appear in any reference article and may be invented; remove them or keep the text without a link: ${unverifiedUrls.join(", ")}`);
  }

  const words = plainWords(markdown);
  const copiedPassages = [...new Set(ngrams(words, 12).filter((g) => fingerprint.ngrams12.has(g)))];
  if (copiedPassages.length) {
    add("hard", "copied-text", `Rewrite passages copied from reference articles in your own words: "${copiedPassages.slice(0, 3).join('", "')}"`);
  }
  const shared8 = new Set(ngrams(words, 8).filter((g) => fingerprint.ngrams8.has(g))).size;
  if (!copiedPassages.length && shared8 >= 3) add("soft", "close-paraphrase", `${shared8} 8-word phrases match reference articles.`);

  const briefFigures = new Set(extractFigures([brief.topic, ...brief.keyPoints, ...brief.requiredSections, brief.notes ?? ""].join(" ")));
  const unsupportedFigures = extractFigures(markdown).filter((f) => !fingerprint.figures.has(f) && !briefFigures.has(f));
  if (unsupportedFigures.length) {
    add("soft", "unsupported-figure", `These figures appear in no reference article and not in the brief; make sure each is supported or rephrase without it: ${unsupportedFigures.join(", ")}`);
  }

  const avoid = new Set(profile.avoidPhrases);
  const avoidHits = findAiIsms(inlineToPlain(markdown)).filter((h) => avoid.has(h.phrase));
  for (const hit of avoidHits) add("soft", "avoid-phrase", `"${hit.phrase}" (×${hit.count}) is a phrase the house style avoids.`);

  const band = n.h2Count;
  if (band && (features.h2Count < Math.floor(band.p10) || features.h2Count > Math.ceil(band.p90))) {
    add("soft", "h2-count", `${features.h2Count} H2 sections; the house range is ${Math.round(band.p10)}–${Math.round(band.p90)}.`);
  }
  const lastH2 = blocks.findLast((b) => b.type === "heading" && b.level === 2);
  if (features.hasFaq && lastH2?.type === "heading" && !FAQ.test(lastH2.text)) add("soft", "faq-position", "The FAQ should be the final section.");

  return {
    issues,
    metrics: {
      words: features.wordCount,
      h2Count: features.h2Count,
      faqQuestions: features.faqQuestionCount,
      copiedPassages,
      unverifiedUrls,
      unsupportedFigures,
      avoidPhrases: avoidHits.map((h) => h.phrase),
    },
  };
}

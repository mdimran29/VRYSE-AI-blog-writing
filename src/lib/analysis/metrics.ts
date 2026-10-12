import { inlineToPlain } from "@/lib/ingest/markdown";
import type { Block } from "@/lib/schemas/article";
import { findAiIsms } from "./ai-isms";
import { percentile } from "./aggregate";
import { readability } from "./readability";
import { splitSentences, splitWords } from "./text";

export type Features = {
  // Length
  wordCount: number;
  paragraphCount: number;
  h2Count: number;
  h3Count: number;
  wordsPerH2SectionMean: number | null;
  // Structure
  h3PerH2: number | null;
  headingWordsMean: number | null;
  questionHeadingRate: number | null;
  howToHeadingRate: number | null;
  numberedHeadingRate: number | null;
  listCount: number;
  listItemCount: number;
  tableCount: number;
  hasFaq: boolean;
  faqQuestionCount: number;
  hasKeyTakeaways: boolean;
  hasConclusionHeading: boolean;
  // Intro / closing
  introWords: number;
  closingWords: number;
  closingHasCta: boolean;
  // Paragraphs
  wordsPerParagraphMean: number | null;
  wordsPerParagraphP90: number | null;
  sentencesPerParagraphMean: number | null;
  oneSentenceParagraphRate: number | null;
  // Sentences
  wordsPerSentenceMean: number | null;
  wordsPerSentenceStd: number | null;
  questionSentenceRate: number | null;
  sentenceStartDiversity: number | null;
  // Readability
  fleschReadingEase: number | null;
  fleschKincaidGrade: number | null;
  // Lexical (per 1,000 words)
  secondPersonPer1k: number;
  firstPersonPluralPer1k: number;
  brandMentionsPer1k: number;
  numbersPer1k: number;
  linksPer1k: number;
  boldPer1k: number;
  aiIsmsPer1k: number;
};

const FAQ = /\b(faqs?|frequently asked)\b/i;
const KEY_TAKEAWAYS = /\b(key takeaways?|tl;?dr|at a glance|quick summary|in brief)\b/i;
const CONCLUSION = /\b(conclusion|final thoughts|wrapping up|the bottom line|summing up|in summary)\b/i;
const CTA = /\b(contact|book a demo|request a demo|get in touch|talk to|reach out|schedule|sign up|get started|try|learn more|explore)\b/i;
const SECOND_PERSON = new Set(["you", "your", "yours", "yourself", "yourselves"]);
const FIRST_PLURAL = new Set(["we", "our", "ours", "us", "ourselves"]);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const std = (xs: number[]) => {
  const m = mean(xs);
  return m === null ? null : Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};
const rate = (n: number, d: number) => (d ? n / d : null);

/** The plain text of a block, including table cells. */
function blockText(block: Block): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "quote":
      return inlineToPlain(block.text);
    case "list":
      return block.items.map(inlineToPlain).join(" ");
    case "table":
      return block.rows.flat().map(inlineToPlain).join(" ");
  }
}

function rawInline(block: Block): string {
  switch (block.type) {
    case "paragraph":
    case "quote":
      return block.text;
    case "list":
      return block.items.join(" ");
    case "table":
      return block.rows.flat().join(" ");
    case "heading":
      return "";
  }
}

type Section = { heading: string; blocks: Block[] };

/** Splits the body (after the H1) into the intro and one section per H2. */
function sections(blocks: Block[]): { intro: Block[]; sections: Section[] } {
  const intro: Block[] = [];
  const out: Section[] = [];
  for (const b of blocks) {
    if (b.type === "heading" && b.level === 1) continue;
    if (b.type === "heading" && b.level === 2) out.push({ heading: b.text, blocks: [] });
    else if (out.length) out[out.length - 1].blocks.push(b);
    else intro.push(b);
  }
  return { intro, sections: out };
}

const wordsIn = (blocks: Block[]) => blocks.reduce((n, b) => n + splitWords(blockText(b)).length, 0);

/** The FAQ: from an FAQ heading at any level to the next heading at the same or a higher level. */
function faqRange(body: Block[]): { start: number; end: number } | null {
  const start = body.findIndex((b) => b.type === "heading" && b.level >= 2 && FAQ.test(b.text));
  if (start < 0) return null;
  const level = (body[start] as Extract<Block, { type: "heading" }>).level;
  const after = body.findIndex((b, i) => i > start && b.type === "heading" && b.level <= level);
  return { start, end: after < 0 ? body.length : after };
}

export function extractFeatures(blocks: Block[], opts: { brandTerms: string[] }): Features {
  const body = blocks.filter((b) => !(b.type === "heading" && b.level === 1));

  const words = body.flatMap((b) => splitWords(blockText(b)));
  const wordCount = words.length;
  const per1k = (n: number) => (wordCount ? (n / wordCount) * 1000 : 0);
  const lower = words.map((w) => w.toLowerCase());

  // The FAQ is measured on its own and left out of everything else: its headings are questions by
  // design, and it would otherwise be mistaken for the closing section.
  const faq = faqRange(body);
  const faqBlocks = faq ? body.slice(faq.start + 1, faq.end) : [];
  const faqHeadingCount = faqBlocks.filter((b) => b.type === "heading").length;
  const faqQuestionCount =
    faqHeadingCount || faqBlocks.filter((b) => b.type === "paragraph" && inlineToPlain(b.text).endsWith("?")).length;
  const content = faq ? [...body.slice(0, faq.start), ...body.slice(faq.end)] : body;

  const { intro, sections: contentSections } = sections(content);
  const bodyHeadings = content.filter(
    (b): b is Extract<Block, { type: "heading" }> => b.type === "heading" && b.level >= 2,
  );
  const closing = contentSections[contentSections.length - 1];
  const closingText = closing ? closing.blocks.map(blockText).join(" ") : "";

  const paragraphs = body.filter((b) => b.type === "paragraph").map((b) => blockText(b));
  const paragraphWords = paragraphs.map((p) => splitWords(p).length);
  const paragraphSentences = paragraphs.map((p) => splitSentences(p).length);

  const prose = body
    .filter((b) => b.type === "paragraph" || b.type === "list" || b.type === "quote")
    .flatMap((b) => (b.type === "list" ? b.items.map(inlineToPlain) : [blockText(b)]));
  const sentences = prose.flatMap(splitSentences);
  const sentenceWords = sentences.map((s) => splitWords(s).length).filter((n) => n > 0);
  const firstWords = sentences.map((s) => splitWords(s)[0]?.toLowerCase()).filter(Boolean);

  const raw = body.map(rawInline).join(" ");
  const brand = opts.brandTerms.length
    ? new RegExp(`\\b(${opts.brandTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi")
    : null;
  const plainBody = body.map(blockText).join(" ");

  return {
    wordCount,
    paragraphCount: paragraphs.length,
    h2Count: body.filter((b) => b.type === "heading" && b.level === 2).length,
    h3Count: body.filter((b) => b.type === "heading" && b.level === 3).length,
    wordsPerH2SectionMean: mean(contentSections.map((s) => wordsIn(s.blocks))),

    h3PerH2: rate(
      bodyHeadings.filter((h) => h.level === 3).length,
      bodyHeadings.filter((h) => h.level === 2).length,
    ),
    headingWordsMean: mean(bodyHeadings.map((h) => splitWords(h.text).length)),
    questionHeadingRate: rate(bodyHeadings.filter((h) => h.text.trim().endsWith("?")).length, bodyHeadings.length),
    howToHeadingRate: rate(bodyHeadings.filter((h) => /^how (to|do|does|can)\b/i.test(h.text)).length, bodyHeadings.length),
    numberedHeadingRate: rate(bodyHeadings.filter((h) => /^\d+[.)]?\s/.test(h.text)).length, bodyHeadings.length),
    listCount: body.filter((b) => b.type === "list").length,
    listItemCount: body.reduce((n, b) => n + (b.type === "list" ? b.items.length : 0), 0),
    tableCount: body.filter((b) => b.type === "table").length,
    hasFaq: Boolean(faq),
    faqQuestionCount,
    hasKeyTakeaways: contentSections.some((s) => KEY_TAKEAWAYS.test(s.heading)),
    hasConclusionHeading: contentSections.some((s) => CONCLUSION.test(s.heading)),

    introWords: wordsIn(intro),
    closingWords: closing ? wordsIn(closing.blocks) : 0,
    closingHasCta: CTA.test(closingText) || (brand ? new RegExp(brand.source, "i").test(closingText) : false),

    wordsPerParagraphMean: mean(paragraphWords),
    wordsPerParagraphP90: paragraphWords.length ? percentile(paragraphWords, 0.9) : null,
    sentencesPerParagraphMean: mean(paragraphSentences),
    oneSentenceParagraphRate: rate(paragraphSentences.filter((n) => n === 1).length, paragraphs.length),

    wordsPerSentenceMean: mean(sentenceWords),
    wordsPerSentenceStd: std(sentenceWords),
    questionSentenceRate: rate(sentences.filter((s) => s.endsWith("?")).length, sentences.length),
    sentenceStartDiversity: rate(new Set(firstWords).size, firstWords.length),

    ...readability(paragraphs.join(" ")),

    secondPersonPer1k: per1k(lower.filter((w) => SECOND_PERSON.has(w)).length),
    firstPersonPluralPer1k: per1k(lower.filter((w) => FIRST_PLURAL.has(w)).length),
    brandMentionsPer1k: per1k(brand ? (plainBody.match(brand)?.length ?? 0) : 0),
    numbersPer1k: per1k(words.filter((w) => /\d/.test(w)).length),
    linksPer1k: per1k(raw.match(/\]\(https?:\/\//g)?.length ?? 0),
    boldPer1k: per1k(raw.match(/\*\*[^*]+\*\*/g)?.length ?? 0),
    aiIsmsPer1k: per1k(findAiIsms(plainBody).reduce((n, h) => n + h.count, 0)),
  };
}

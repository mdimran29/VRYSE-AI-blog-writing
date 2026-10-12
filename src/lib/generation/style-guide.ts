import { BriefSchema, type BriefInput, type ResolvedBrief } from "@/lib/schemas/generation";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";

const round = (n: number, step = 1) => Math.round(n / step) * step;

/** Fills unset brief fields from the profile: the house audience and the median article length. */
export function resolveBrief(input: BriefInput, profile: CompanyStyleProfile): ResolvedBrief {
  const brief = BriefSchema.parse(input);
  const median = profile.stats.distributions.numeric.wordCount?.median ?? 1500;
  return {
    ...brief,
    audience: brief.audience ?? profile.guide.audience,
    targetWords: brief.targetWords ?? round(median, 50),
  };
}

/**
 * The company's house style as prompt text: the synthesised guide plus measured numeric targets.
 * It is identical for every brief of a company, so it sits in the cached part of the prompt.
 */
export function renderStyleGuide(profile: CompanyStyleProfile): string {
  const g = profile.guide;
  const n = profile.stats.distributions.numeric;
  const r = profile.stats.distributions.rates;
  const o = profile.stats.sectionOrder;
  const med = (k: string, step = 1) => (n[k] ? round(n[k].median, step) : null);
  const range = (k: string) => (n[k] ? `${round(n[k].p10)}–${round(n[k].p90)}` : null);
  const pct = (k: string) => (r[k] !== undefined ? `${Math.round(r[k] * 100)}%` : "n/a");
  const patterns = (ps: { pattern: string; articles: number }[]) =>
    ps.map((p) => `  - ${p.pattern} (${p.articles}/${profile.corpus.articleCount} articles)`).join("\n");
  const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");

  return `# House style: ${profile.company}

${g.summary}

## Audience and voice
- Audience: ${g.audience}
- Tone: ${g.voice.tone.join(", ")}
- Formality: ${g.voice.formality}
- Point of view: ${g.voice.pointOfView}
- What makes the voice recognisable: ${g.voice.personality}

## Structure
- Typical outline: ${g.structure.typicalOutline.join(" → ")}
- Measured section order: Key Takeaways in ${o.keyTakeaways.articles}/${o.articles} articles (first section after the intro in ${o.keyTakeaways.firstSection}); FAQ in ${o.faq.articles}/${o.articles} (last section in ${o.faq.lastSection}/${o.articles}); a Conclusion heading in ${o.conclusion.articles}/${o.articles}, always before the FAQ.
- Length: about ${med("wordCount", 50)} words (most articles ${range("wordCount")}), with ${range("h2Count")} H2 sections and about ${med("h3PerH2")} H3 per H2.
- An intro of about ${med("introWords", 5)} words; a closing section of about ${med("closingWords", 5)} words.
- Intro patterns:
${patterns(g.structure.introPatterns)}
- Conclusion patterns:
${patterns(g.structure.conclusionPatterns)}
- Calls to action (only ${pct("closingHasCta")} of articles have one):
${patterns(g.structure.ctaPatterns)}
- Headings: ${g.structure.headingStyle}
- FAQ: ${g.structure.faqStyle} (usually ${med("faqQuestionCount")} questions)

## Sentences and paragraphs (measured)
- about ${med("wordsPerSentenceMean")} words per sentence on average; vary the length.
- about ${med("wordsPerParagraphMean")} words per paragraph; ${n.oneSentenceParagraphRate ? Math.round(n.oneSentenceParagraphRate.median * 100) : "some"}% of paragraphs are a single sentence.
- Reading level around Flesch-Kincaid grade ${med("fleschKincaidGrade")}.
- About ${med("boldPer1k")} bold phrases, ${med("linksPer1k")} links and ${med("numbersPer1k")} numbers per 1,000 words; "you" about ${med("secondPersonPer1k")} times per 1,000 words.

## Content
- Examples: ${g.content.exampleUsage}
- Data and sources: ${g.content.dataUsage}
- Product mentions: ${g.content.productMentions}

## Vocabulary
- Preferred terms: ${g.vocabulary.preferredTerms.join(", ")}
- Spelling and conventions: ${g.vocabulary.spelling}
- Avoid: ${[...g.vocabulary.avoid, ...profile.avoidPhrases].join(", ")}

## Formatting
${bullets(g.formatting)}

## Rules
Do:
${bullets(g.rules.do)}

Don't:
${bullets(g.rules.dont)}
`;
}

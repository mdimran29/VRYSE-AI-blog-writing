import type { LanguageModel } from "ai";
import { callObject } from "@/lib/llm/call";
import { ArticleTraitsSchema, StyleGuideSchema, type ArticleTraits, type StyleGuide } from "@/lib/schemas/profile";

type ModelOverride = { model?: string | LanguageModel };

const EXTRACT_INSTRUCTIONS = `You are an editor analysing one company blog article so a writer can imitate the company's house style.
Describe only what this article actually does — no advice, no praise, no guesses about other articles.
Be specific and concrete: name the moves, the devices and the vocabulary you can see. Short quoted phrases are welcome.
Keep every field brief: one or two sentences, or a short list.`;

/** Reads one reference article and records what it does (intro moves, tone, data use, devices…). */
export async function extractTraits(
  article: { id: string; title: string; markdown: string },
  opts: ModelOverride = {},
): Promise<ArticleTraits> {
  const { output } = await callObject({
    stage: "extract",
    role: "analysis",
    model: opts.model,
    // Traits depend only on the article and this prompt, so they are always worth caching.
    cache: true,
    temperature: 0,
    maxOutputTokens: 2000,
    instructions: EXTRACT_INSTRUCTIONS,
    prompt: `Article title: ${article.title}\n\n<article>\n${article.markdown}\n</article>`,
    schema: ArticleTraitsSchema,
  });
  return output;
}

const SYNTHESIS_INSTRUCTIONS = `You are a managing editor writing the house style guide for a company blog.
You receive per-article analysis notes for every reference article, plus measured statistics for the whole corpus.
Consolidate them into one style guide that a new writer could follow to produce an article indistinguishable from the company's own.

Rules:
- Base every claim on the notes and statistics. Prefer what most articles do; mention minority patterns only with their counts.
- For pattern lists, count how many articles show each pattern ("articles" field) by reading the notes. Do not invent counts.
- Be specific to THIS company: name its audience, its recurring moves, its vocabulary and its formatting. Avoid advice that would fit any B2B blog.
- Make "do" and "dont" rules concrete and checkable (e.g. "Open with a specific operational problem in the first sentence", not "Be engaging").
- "typicalOutline" must follow the MEASURED section order in the statistics (where key takeaways, the conclusion and the FAQ sit). The notes describe single articles; the measured order is authoritative.
- Use the statistics for anything numeric (lengths, counts, rates); do not restate them all, the numbers are stored separately.`;

/** Consolidates all per-article traits and the corpus statistics into the company's style guide. */
export async function synthesizeGuide(
  input: { company: string; traits: ArticleTraits[]; statsDigest: string },
  opts: ModelOverride = {},
): Promise<StyleGuide> {
  const notes = input.traits.map((t, i) => `Article ${i + 1}: ${JSON.stringify(t)}`).join("\n");
  const { output } = await callObject({
    stage: "profile-synthesis",
    role: "writer",
    model: opts.model,
    maxOutputTokens: 20000,
    instructions: SYNTHESIS_INSTRUCTIONS,
    prompt: `Company: ${input.company}\n\nMeasured statistics (all reference articles):\n${input.statsDigest}\n\nPer-article analysis notes (${input.traits.length} articles):\n${notes}`,
    schema: StyleGuideSchema,
  });
  return output;
}

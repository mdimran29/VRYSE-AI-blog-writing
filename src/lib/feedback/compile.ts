import type { LanguageModel } from "ai";
import { STOPWORDS, tokenize } from "@/lib/analysis/terms";
import { splitSentences } from "@/lib/analysis/text";
import { callObject } from "@/lib/llm/call";
import { loadPrompt } from "@/lib/prompts";
import type { Weakness } from "@/lib/schemas/evaluation";
import { CompiledFeedbackSchema, type CompiledFeedback, type FeedbackInput } from "@/lib/schemas/feedback";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";

const RULE_CUE =
  /\b(always|never|from now on|going forward|as a (general )?rule|in general|(in )?(all|every) (of )?(our )?articles?|we prefer|our (house )?style)\b/i;

const contentWords = (s: string) =>
  new Set(tokenize(s).filter((t) => t.length > 2 && !STOPWORDS.has(t)).map((t) => t.replace(/s$/, "")));

/**
 * True only if the editor's own feedback states this as a general rule: a sentence with a rule cue
 * ("always", "never", "all our articles"…) that shares at least two content words with the instruction.
 * The model's `persist` flag alone proved too loose (it marked article-specific fixes as rules).
 */
export function isStandingRule(instruction: string, feedbackText: string): boolean {
  const words = contentWords(instruction);
  return splitSentences(feedbackText)
    .filter((sentence) => RULE_CUE.test(sentence))
    .some((sentence) => {
      const sw = contentWords(sentence);
      return [...words].filter((w) => sw.has(w)).length >= 2;
    });
}

/** The weaknesses a reviewer ticked, by their 1-based numbers in the list they were shown. */
export function selectWeaknesses(shown: Weakness[], numbers: number[]): Weakness[] {
  return [...new Set(numbers)].filter((n) => Number.isInteger(n) && n >= 1 && n <= shown.length).map((n) => shown[n - 1]);
}

/** Turns free-text feedback and the weaknesses the reviewer agreed with into typed, checkable instructions. */
export async function compileFeedback(
  input: { feedback: FeedbackInput; weaknesses: Weakness[]; headings: string[]; profile: CompanyStyleProfile; runId?: string },
  opts: { model?: string | LanguageModel } = {},
): Promise<CompiledFeedback> {
  const { feedback, weaknesses, headings } = input;
  const parts = [
    feedback.rating !== undefined && `Editor rating: ${feedback.rating}/5`,
    feedback.text.trim() && `Editor feedback:\n${feedback.text.trim()}`,
    feedback.sectionNotes?.length && `Notes on specific sections:\n${feedback.sectionNotes.map((n) => `- ${n.section}: ${n.note}`).join("\n")}`,
    weaknesses.length &&
      `Evaluator weaknesses the editor agreed with:\n${weaknesses.map((w) => `- ${w.issue}${w.recommendation ? ` (suggested fix: ${w.recommendation})` : ""}${w.target && w.target !== "global" ? ` [section: ${w.target}]` : ""}`).join("\n")}`,
    `The draft's sections, in order: intro, ${headings.join(", ")}`,
  ];
  const { output } = await callObject({
    stage: "compile-feedback",
    // GPT-5 mini, not Flash-Lite: in testing Flash-Lite invented requests and split one weakness into 9 instructions.
    role: "writer",
    model: opts.model,
    runId: input.runId,
    maxOutputTokens: 8000,
    instructions: loadPrompt("compile-feedback", { company: input.profile.company }),
    prompt: parts.filter(Boolean).join("\n\n"),
    schema: CompiledFeedbackSchema,
  });
  // Only the editor can set a standing preference, and only in words that say it's a general rule.
  const persist = (i: (typeof output.instructions)[number]) => i.persist && i.source === "human" && isStandingRule(i.instruction, feedback.text);
  return { ...output, instructions: output.instructions.map((i, n) => ({ ...i, id: `I${n + 1}`, persist: persist(i) })) };
}

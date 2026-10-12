import type { LanguageModel } from "ai";
import { callObject } from "@/lib/llm/call";
import { loadPrompt } from "@/lib/prompts";
import type { Weakness } from "@/lib/schemas/evaluation";
import { CompiledFeedbackSchema, type CompiledFeedback, type FeedbackInput } from "@/lib/schemas/feedback";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";

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
    role: "analysis",
    model: opts.model,
    runId: input.runId,
    temperature: 0,
    maxOutputTokens: 4000,
    instructions: loadPrompt("compile-feedback", { company: input.profile.company }),
    prompt: parts.filter(Boolean).join("\n\n"),
    schema: CompiledFeedbackSchema,
  });
  // Only the editor can set a standing preference; evaluator findings are always article-specific.
  return { ...output, instructions: output.instructions.map((i, n) => ({ ...i, id: `I${n + 1}`, persist: i.persist && i.source === "human" })) };
}

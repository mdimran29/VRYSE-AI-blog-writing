import type { LanguageModel } from "ai";
import { renderStyleGuide } from "@/lib/generation/style-guide";
import { briefText } from "@/lib/generation/planner";
import { callObject } from "@/lib/llm/call";
import { loadPrompt } from "@/lib/prompts";
import type { Chunk } from "@/lib/retrieval/chunks";
import { JudgeSchema, PairwiseSchema, type JudgeResult } from "@/lib/schemas/evaluation";
import type { ResolvedBrief } from "@/lib/schemas/generation";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";

type ModelOverride = { model?: string | LanguageModel };

const sourcesBlock = (sources: Chunk[]) =>
  sources.length
    ? sources.map((c) => `<source title="${c.articleTitle} › ${c.heading ?? "intro"}">\n${c.markdown.trim()}\n</source>`).join("\n\n")
    : "(none — treat any specific figure or statistic as unsupported unless it is in the brief)";

/** Absolute evaluation of one draft by the judge model (temperature 0, version label hidden). */
export async function judgeArticle(
  input: { markdown: string; brief: ResolvedBrief; profile: CompanyStyleProfile; sources: Chunk[]; runId?: string; iterationId?: string },
  opts: ModelOverride = {},
): Promise<JudgeResult> {
  const { output } = await callObject({
    stage: "judge",
    role: "judge",
    model: opts.model,
    runId: input.runId,
    iterationId: input.iterationId,
    temperature: 0,
    // Never cached: re-judging must be a real, independent call (Step 8 measures judge noise this way).
    cache: false,
    maxOutputTokens: 12000,
    instructions: loadPrompt("judge", { company: input.profile.company, styleGuide: renderStyleGuide(input.profile) }),
    prompt: `Brief:\n${briefText(input.brief)}\n\nSource passages the writer was given (the only acceptable support for figures, besides the brief):\n${sourcesBlock(input.sources)}\n\nDraft article to evaluate:\n<article>\n${input.markdown.trim()}\n</article>`,
    schema: JudgeSchema,
  });
  return output;
}

export type PairwiseOutcome = { winner: "first" | "second" | "tie"; confidence: number; reasons: string[]; order: "first-as-A" | "second-as-A" };

/**
 * Compares two drafts with their A/B order randomised, so position bias can't systematically favour
 * the newer version. The result is mapped back to "first"/"second" in the caller's order.
 */
export async function comparePair(
  input: { first: string; second: string; brief: ResolvedBrief; profile: CompanyStyleProfile; runId?: string },
  opts: ModelOverride & { random?: () => number } = {},
): Promise<PairwiseOutcome> {
  const firstIsA = (opts.random ?? Math.random)() < 0.5;
  const [a, b] = firstIsA ? [input.first, input.second] : [input.second, input.first];
  const { output } = await callObject({
    stage: "pairwise",
    role: "judge",
    model: opts.model,
    runId: input.runId,
    temperature: 0,
    maxOutputTokens: 4000,
    cache: false,
    instructions: loadPrompt("pairwise", { company: input.profile.company, styleGuide: renderStyleGuide(input.profile) }),
    prompt: `Brief:\n${briefText(input.brief)}\n\n<draft id="A">\n${a.trim()}\n</draft>\n\n<draft id="B">\n${b.trim()}\n</draft>`,
    schema: PairwiseSchema,
  });
  const winner = output.winner === "tie" ? "tie" : (output.winner === "A") === firstIsA ? "first" : "second";
  return { winner, confidence: output.confidence, reasons: output.reasons, order: firstIsA ? "first-as-A" : "second-as-A" };
}

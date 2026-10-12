import type { LanguageModel } from "ai";
import { callText } from "@/lib/llm/call";
import type { Excerpts } from "@/lib/retrieval/search";
import type { Issue, Outline, ResolvedBrief } from "@/lib/schemas/generation";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";
import { briefText } from "./planner";
import { loadPrompt } from "@/lib/prompts";
import { renderStyleGuide } from "./style-guide";

type ModelOverride = { model?: string | LanguageModel };

/**
 * GPT-5 mini overshoots word budgets by a steady 29–38% (4 of 4 runs at a 1,450-word target, even
 * with an explicit "never more than" instruction). The writer is therefore given budgets scaled by
 * this factor; the lint still checks the real target. Re-measure if the writer model changes.
 */
export const WRITER_LENGTH_CALIBRATION = 0.78;

function calibrated(outline: Outline): Outline {
  const scale = (n: number) => Math.round((n * WRITER_LENGTH_CALIBRATION) / 10) * 10;
  return {
    ...outline,
    intro: { ...outline.intro, targetWords: scale(outline.intro.targetWords) },
    sections: outline.sections.map((s) => ({ ...s, targetWords: scale(s.targetWords) })),
  };
}

/** URLs the writer may link to: only those present in the excerpts it is shown. */
export function allowedUrls(excerpts: Excerpts): string[] {
  const chunks = [excerpts.intro, excerpts.conclusion, ...excerpts.body].filter((c) => c !== null);
  return [...new Set(chunks.flatMap((c) => [...c.markdown.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1])))];
}

/** Removes wrappers models sometimes add around an article. */
export function cleanMarkdown(text: string): string {
  return text
    .trim()
    .replace(/^```(?:markdown|md)?\s*\n/i, "")
    .replace(/\n```\s*$/, "")
    .trim()
    .concat("\n");
}

function excerptBlock(excerpts: Excerpts): string {
  const parts = [
    excerpts.intro && { role: "intro", c: excerpts.intro },
    ...excerpts.body.map((c) => ({ role: "body section", c })),
    excerpts.conclusion && { role: "closing section", c: excerpts.conclusion },
  ].filter((p) => p !== null && p !== undefined);
  return parts
    .map(({ role, c }) => `<excerpt role="${role}" source="${c.articleTitle} › ${c.heading ?? "intro"}">\n${c.markdown.trim()}\n</excerpt>`)
    .join("\n\n");
}

export async function writeArticle(
  input: { brief: ResolvedBrief; profile: CompanyStyleProfile; outline: Outline; excerpts: Excerpts; memory?: string[]; runId?: string },
  opts: ModelOverride = {},
): Promise<string> {
  const { brief, profile, outline, excerpts } = input;
  const urls = allowedUrls(excerpts);
  const memory = input.memory?.length ? `\n\nStanding editor preferences for ${profile.company} (always apply):\n${input.memory.map((m) => `- ${m}`).join("\n")}` : "";
  // Stable, company-level text goes in the instructions (cacheable); per-article material goes in the prompt.
  const { text } = await callText({
    stage: "write",
    role: "writer",
    model: opts.model,
    runId: input.runId,
    maxOutputTokens: 16000,
    instructions: loadPrompt("writer", { company: profile.company, styleGuide: renderStyleGuide(profile) }),
    prompt: `Reference excerpts from ${profile.company}'s own articles (voice examples):\n\n${excerptBlock(excerpts)}

Allowed URLs (the only links you may use):
${urls.length ? urls.map((u) => `- ${u}`).join("\n") : "- none"}

Brief:
${briefText(brief)}${memory}

Approved outline (follow it exactly):
${JSON.stringify(calibrated(outline), null, 2)}

Length: about ${Math.round(brief.targetWords * WRITER_LENGTH_CALIBRATION)} words in total, and never more than ${brief.targetWords}. The outline's section word targets are budgets to stay within, not minimums; the FAQ answers count towards the total.

Write the full article now.`,
  });
  return cleanMarkdown(text);
}

export async function repairArticle(
  input: { markdown: string; issues: Issue[]; profile: CompanyStyleProfile; runId?: string },
  opts: ModelOverride = {},
): Promise<string> {
  const { text } = await callText({
    stage: "repair",
    role: "writer",
    model: opts.model,
    runId: input.runId,
    maxOutputTokens: 16000,
    instructions: loadPrompt("repair", { company: input.profile.company, styleGuide: renderStyleGuide(input.profile) }),
    prompt: `Problems to fix:\n${input.issues.map((i) => `- ${i.message}`).join("\n")}\n\nDraft:\n\n${input.markdown}`,
  });
  return cleanMarkdown(text);
}

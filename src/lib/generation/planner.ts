import type { LanguageModel } from "ai";
import { callObject } from "@/lib/llm/call";
import { OutlineSchema, type Issue, type Outline, type ResolvedBrief } from "@/lib/schemas/generation";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";
import { loadPrompt } from "@/lib/prompts";
import { renderStyleGuide } from "./style-guide";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const overlaps = (a: string, b: string) => norm(a).includes(norm(b)) || norm(b).includes(norm(a));

/** True when a required section (by name) is satisfied by the given headings or special parts. */
export function hasSection(required: string, headings: string[], parts: { faq: boolean; keyTakeaways: boolean; conclusion: boolean }): boolean {
  if (/\b(faqs?|frequently asked)\b/i.test(required)) return parts.faq;
  if (/key takeaways?/i.test(required)) return parts.keyTakeaways;
  if (/^conclusion$/i.test(required.trim())) return parts.conclusion;
  return headings.some((h) => overlaps(h, required));
}

/** Deterministic checks that an outline covers the brief and fits the house structure. */
export function checkOutline(outline: Outline, brief: ResolvedBrief, profile: CompanyStyleProfile): Issue[] {
  const issues: Issue[] = [];
  const n = profile.stats.distributions.numeric;
  const hard = (code: string, message: string) => issues.push({ code, severity: "hard", message });

  const covered = outline.sections.flatMap((s) => s.keyPoints);
  for (const point of brief.keyPoints) {
    if (!covered.some((c) => overlaps(c, point))) hard("key-point-missing", `Key point "${point}" is not assigned to any section.`);
  }

  const headings = outline.sections.map((s) => s.heading);
  const parts = { faq: outline.faq.length > 0, keyTakeaways: outline.keyTakeaways, conclusion: outline.sections.some((s) => s.role === "conclusion") };
  for (const required of brief.requiredSections) {
    if (!hasSection(required, headings, parts)) hard("required-section-missing", `Required section "${required}" is missing.`);
  }

  if ((profile.stats.distributions.rates.hasFaq ?? 0) >= 0.5) {
    const min = Math.max(1, Math.round(n.faqQuestionCount?.p10 ?? 3));
    if (outline.faq.length < min) hard("faq-too-short", `The FAQ needs at least ${min} questions (house style); it has ${outline.faq.length}.`);
  }

  const h2 = outline.sections.length + (outline.keyTakeaways ? 1 : 0) + (outline.faq.length ? 1 : 0);
  const band = n.h2Count;
  if (band && (h2 < Math.floor(band.p10) || h2 > Math.ceil(band.p90))) {
    hard("h2-count", `The outline has ${h2} H2 sections; the house range is ${Math.round(band.p10)}–${Math.round(band.p90)}.`);
  }

  const conclusions = outline.sections.filter((s) => s.role === "conclusion");
  if (conclusions.length !== 1 || outline.sections.at(-1)?.role !== "conclusion") {
    hard("conclusion-position", "There must be exactly one section with role 'conclusion', and it must be the last item in 'sections'.");
  }

  const planned = outline.intro.targetWords + outline.sections.reduce((sum, s) => sum + s.targetWords, 0);
  if (Math.abs(planned - brief.targetWords) / brief.targetWords > 0.2) {
    hard("word-budget", `Section targets add up to ${planned} words; the brief asks for about ${brief.targetWords} (±20%).`);
  }
  return issues;
}

export type Exemplar = { title: string; headings: string[] };

export function briefText(brief: ResolvedBrief): string {
  const lines = [
    `Topic: ${brief.topic}`,
    `Audience: ${brief.audience}`,
    `Target length: about ${brief.targetWords} words`,
    brief.primaryKeyword && `Primary keyword: ${brief.primaryKeyword}`,
    brief.keyPoints.length && `Key points that must be covered:\n${brief.keyPoints.map((k) => `- ${k}`).join("\n")}`,
    brief.requiredSections.length && `Required sections:\n${brief.requiredSections.map((s) => `- ${s}`).join("\n")}`,
    brief.toneOverride && `Tone adjustment for this article: ${brief.toneOverride}`,
    brief.notes && `Notes: ${brief.notes}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Plans an outline, checks it, and re-plans once with the problems if any hard check fails. */
export async function planOutline(
  input: { brief: ResolvedBrief; profile: CompanyStyleProfile; exemplars: Exemplar[]; memory?: string[]; runId?: string },
  opts: { model?: string | LanguageModel } = {},
): Promise<{ outline: Outline; issues: Issue[]; attempts: number }> {
  const instructions = loadPrompt("planner", { company: input.profile.company, styleGuide: renderStyleGuide(input.profile) });
  const exemplars = input.exemplars
    .map((e) => `"${e.title}"\n${e.headings.map((h) => `  - ${h}`).join("\n")}`)
    .join("\n");
  const memory = input.memory?.length ? `\n\nStanding editor preferences for this company:\n${input.memory.map((m) => `- ${m}`).join("\n")}` : "";
  const base = `Brief:\n${briefText(input.brief)}${memory}\n\nH2 outlines of the most similar ${input.profile.company} articles (structure examples, not topics to copy):\n${exemplars}`;

  let prompt = base;
  let result: { outline: Outline; issues: Issue[]; attempts: number } | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { output } = await callObject({
      stage: "plan",
      role: "writer",
      model: opts.model,
      runId: input.runId,
      maxOutputTokens: 12000,
      instructions,
      prompt,
      schema: OutlineSchema,
    });
    const issues = checkOutline(output, input.brief, input.profile);
    result = { outline: output, issues, attempts: attempt };
    if (!issues.length) break;
    prompt = `${base}\n\nYour previous outline had these problems. Fix all of them and return the complete corrected outline:\n${issues.map((i) => `- ${i.message}`).join("\n")}\n\nPrevious outline:\n${JSON.stringify(output)}`;
  }
  return result!;
}

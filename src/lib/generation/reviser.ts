import type { LanguageModel } from "ai";
import { blocksToMarkdown, markdownToBlocks } from "@/lib/ingest/markdown";
import { callText } from "@/lib/llm/call";
import { loadPrompt } from "@/lib/prompts";
import type { Chunk } from "@/lib/retrieval/chunks";
import type { Block } from "@/lib/schemas/article";
import type { RevisionInstruction } from "@/lib/schemas/feedback";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";
import { overlaps } from "./planner";
import { renderStyleGuide } from "./style-guide";
import { cleanMarkdown } from "./writer";

/** The intro plus one entry per H2, each rendered back to normalised markdown for comparison. */
function sectionsOf(markdown: string): Map<string, string> {
  const out = new Map<string, Block[]>([["intro", []]]);
  let current = "intro";
  for (const b of markdownToBlocks(markdown)) {
    if (b.type === "heading" && b.level === 1) continue;
    if (b.type === "heading" && b.level === 2) {
      current = b.text;
      out.set(current, []);
    } else {
      out.get(current)!.push(b);
    }
  }
  return new Map([...out].map(([k, blocks]) => [k, blocksToMarkdown(blocks).replace(/\s+/g, " ").trim()]));
}

export type SectionChange = { section: string; status: "unchanged" | "changed" | "added" | "removed" };

export function sectionChanges(before: string, after: string): SectionChange[] {
  const a = sectionsOf(before);
  const b = sectionsOf(after);
  const changes: SectionChange[] = [...a].map(([section, text]) => ({
    section,
    status: !b.has(section) ? "removed" : b.get(section) === text ? "unchanged" : "changed",
  }));
  for (const section of b.keys()) if (!a.has(section)) changes.push({ section, status: "added" });
  return changes;
}

/** Sections that changed although no instruction targeted them (empty when any instruction is global). */
export function untargetedChanges(changes: SectionChange[], instructions: RevisionInstruction[]): string[] {
  if (instructions.some((i) => i.scope === "global" || i.target.toLowerCase() === "global")) return [];
  return changes
    .filter((c) => c.status !== "unchanged" && !instructions.some((i) => overlaps(i.target, c.section)))
    .map((c) => c.section);
}

export const formatInstructions = (instructions: RevisionInstruction[]) =>
  instructions.map((i) => `${i.id} [${i.scope === "global" ? "global" : `section: ${i.target}`}] ${i.action}: ${i.instruction}\n   Acceptance check: ${i.acceptanceCheck}`).join("\n");

/** A targeted edit of the previous draft: only the sections an instruction targets may change. */
export async function reviseArticle(
  input: {
    markdown: string;
    instructions: RevisionInstruction[];
    profile: CompanyStyleProfile;
    sources?: Chunk[];
    allowedUrls?: string[];
    memory?: string[];
    runId?: string;
  },
  opts: { model?: string | LanguageModel } = {},
): Promise<string> {
  const sources = input.sources?.length
    ? input.sources.map((c) => `<source title="${c.articleTitle} › ${c.heading ?? "intro"}">\n${c.markdown.trim()}\n</source>`).join("\n\n")
    : "(none)";
  const memory = input.memory?.length ? `\n\nStanding editor preferences for ${input.profile.company} (always apply):\n${input.memory.map((m) => `- ${m}`).join("\n")}` : "";
  const { text } = await callText({
    stage: "revise",
    role: "writer",
    model: opts.model,
    runId: input.runId,
    maxOutputTokens: 16000,
    instructions: loadPrompt("revise", { company: input.profile.company, styleGuide: renderStyleGuide(input.profile) }),
    prompt: `Source passages (the only acceptable support for new figures):\n${sources}

Allowed URLs:
${input.allowedUrls?.length ? input.allowedUrls.map((u) => `- ${u}`).join("\n") : "- none"}${memory}

Revision instructions:
${formatInstructions(input.instructions)}

Current draft:

${input.markdown.trim()}`,
  });
  return cleanMarkdown(text);
}


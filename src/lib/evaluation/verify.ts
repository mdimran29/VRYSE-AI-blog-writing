import type { LanguageModel } from "ai";
import { formatInstructions } from "@/lib/generation/reviser";
import { callObject } from "@/lib/llm/call";
import { loadPrompt } from "@/lib/prompts";
import { VerificationSchema, type RevisionInstruction, type Verification } from "@/lib/schemas/feedback";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";
import { judgeProviderOptions } from "./judge";

/** Checks each instruction's acceptance check against the revised draft. Skipped instructions count as not addressed. */
export async function verifyInstructions(
  input: { before: string; after: string; instructions: RevisionInstruction[]; profile: CompanyStyleProfile; runId?: string },
  opts: { model?: string | LanguageModel } = {},
): Promise<Verification & { addressedRate: number }> {
  const { output } = await callObject({
    stage: "verify",
    role: "judge",
    model: opts.model,
    runId: input.runId,
    temperature: 0,
    cache: false,
    providerOptions: judgeProviderOptions(),
    maxOutputTokens: 4000,
    instructions: loadPrompt("verify", { company: input.profile.company }),
    prompt: `Revision instructions:\n${formatInstructions(input.instructions)}\n\n<previous_draft>\n${input.before.trim()}\n</previous_draft>\n\n<revised_draft>\n${input.after.trim()}\n</revised_draft>`,
    schema: VerificationSchema,
  });
  const results = input.instructions.map(
    (i) => output.results.find((r) => r.id === i.id) ?? { id: i.id, addressed: false, evidence: "Not checked by the judge." },
  );
  return { results, addressedRate: results.length ? results.filter((r) => r.addressed).length / results.length : 0 };
}

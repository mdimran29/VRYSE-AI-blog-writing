import { z } from "zod";

/** What the user asks for. Unset fields are filled from the company profile. */
export const BriefSchema = z.object({
  company: z.string().min(1),
  topic: z.string().min(3),
  audience: z.string().optional(),
  targetWords: z.number().int().min(300).max(5000).optional(),
  primaryKeyword: z.string().optional(),
  keyPoints: z.array(z.string().min(1)).default([]),
  requiredSections: z.array(z.string().min(1)).default([]),
  toneOverride: z.string().optional(),
  notes: z.string().optional(),
});
export type BriefInput = z.input<typeof BriefSchema>;
export type Brief = z.infer<typeof BriefSchema>;
export type ResolvedBrief = Brief & { audience: string; targetWords: number };

// LLM output schemas: every field is required (OpenAI strict structured output).
export const OutlineSectionSchema = z.object({
  heading: z.string().describe("The H2 heading exactly as it will appear"),
  role: z.enum(["body", "conclusion"]),
  intent: z.string().describe("What this section must achieve for the reader, in one sentence"),
  keyPoints: z.array(z.string()).describe("Brief key points this section covers, copied verbatim from the brief"),
  devices: z.array(z.string()).describe("Devices to use, e.g. 'numbered list', 'comparison table', 'statistic from the excerpts', 'worked example'"),
  subheadings: z.array(z.string()).describe("H3 subheadings, in order; empty if none"),
  targetWords: z.number().describe("Planned words for this section, including subsections"),
});

export const OutlineSchema = z.object({
  title: z.string().describe("The H1 title"),
  primaryKeyword: z.string().describe("The main search phrase the article targets"),
  metaDescription: z.string().describe("At most 160 characters"),
  intro: z.object({
    hook: z.string().describe("How the first sentence opens, following the house intro pattern"),
    promise: z.string().describe("The closing sentence of the intro that says what the article covers"),
    targetWords: z.number(),
  }),
  keyTakeaways: z.boolean().describe("Whether to put a Key Takeaways list right after the intro"),
  sections: z.array(OutlineSectionSchema).describe("H2 sections in order, excluding Key Takeaways and the FAQ; the last one has role 'conclusion'"),
  faq: z.array(z.string()).describe("FAQ questions, in order"),
  cta: z.string().describe("The closing call to action, or 'none'"),
});
export type Outline = z.infer<typeof OutlineSchema>;

export type Issue = { code: string; severity: "hard" | "soft"; message: string };

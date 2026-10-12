import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { loadProfile } from "@/lib/analysis/profile";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { iterations, llmCalls, memory, runs } from "@/lib/db/schema";
import { buildCorpusFingerprint, lintArticle, type CorpusFingerprint, type LintResult } from "@/lib/generation/lint";
import { planOutline, type Exemplar } from "@/lib/generation/planner";
import { resolveBrief } from "@/lib/generation/style-guide";
import { repairArticle, writeArticle } from "@/lib/generation/writer";
import { selectExcerpts, type Excerpts } from "@/lib/retrieval/search";
import { loadIndex, type RetrievalIndex } from "@/lib/retrieval/store";
import type { BriefInput, Outline, ResolvedBrief } from "@/lib/schemas/generation";

export type Stage = "retrieve" | "plan" | "write" | "lint" | "repair" | "save";
export type GenerationEvent = { stage: Stage; status: "start" | "done"; detail?: string };

export type GenerationResult = {
  runId: string;
  iterationId: string;
  brief: ResolvedBrief;
  outline: Outline;
  markdown: string;
  lint: LintResult;
  repaired: boolean;
  excerpts: Excerpts;
  costUsd: number;
  files: { markdown: string; outline: string; lint: string };
};

const fingerprints = new Map<string, CorpusFingerprint>();
function fingerprintFor(index: RetrievalIndex): CorpusFingerprint {
  let fp = fingerprints.get(index.company);
  if (!fp) {
    fp = buildCorpusFingerprint(index.chunks.map((c) => c.markdown));
    fingerprints.set(index.company, fp);
  }
  return fp;
}

/** H2 outlines of the closest reference articles, as structure examples for the planner. */
function exemplarsFor(index: RetrievalIndex, articles: Excerpts["articles"]): Exemplar[] {
  return articles.map((a) => ({
    title: a.title,
    headings: index.chunks.filter((c) => c.articleId === a.id && c.heading).map((c) => c.heading!),
  }));
}

/** Standing editor preferences saved from earlier feedback (filled in by the feedback loop). */
export function companyMemory(company: string): string[] {
  return getDb().select({ instruction: memory.instruction }).from(memory).where(eq(memory.company, company)).all().map((m) => m.instruction);
}

const hardCount = (l: LintResult) => l.issues.filter((i) => i.severity === "hard").length;

/** Brief → retrieve → plan → retrieve per section → write → lint → (repair once) → save as iteration 1. */
export async function runGeneration(input: BriefInput, onEvent: (e: GenerationEvent) => void = () => {}): Promise<GenerationResult> {
  const profile = loadProfile(input.company);
  const index = loadIndex(input.company);
  const brief = resolveBrief(input, profile);
  const mem = companyMemory(brief.company);
  const db = getDb();
  const runId = randomUUID();
  db.insert(runs).values({ id: runId, company: brief.company, brief, profileVersion: profile.version, status: "running" }).run();

  try {
    onEvent({ stage: "retrieve", status: "start" });
    const initial = await selectExcerpts(index, { topic: brief.topic, keyPoints: brief.keyPoints });
    onEvent({ stage: "retrieve", status: "done", detail: initial.articles.map((a) => a.title).join(" | ") });

    onEvent({ stage: "plan", status: "start" });
    const plan = await planOutline({ brief, profile, exemplars: exemplarsFor(index, initial.articles), memory: mem, runId });
    onEvent({ stage: "plan", status: "done", detail: `${plan.outline.sections.length} sections, ${plan.outline.faq.length} FAQs, ${plan.attempts} attempt(s)${plan.issues.length ? `, ${plan.issues.length} unresolved issue(s)` : ""}` });

    onEvent({ stage: "retrieve", status: "start", detail: "per section" });
    const sectionHeadings = plan.outline.sections.filter((s) => s.role === "body").map((s) => s.heading);
    const excerpts = await selectExcerpts(index, { topic: brief.topic, keyPoints: brief.keyPoints, sectionHeadings });
    onEvent({ stage: "retrieve", status: "done", detail: `~${excerpts.tokens} tokens of excerpts` });

    onEvent({ stage: "write", status: "start" });
    let markdown = await writeArticle({ brief, profile, outline: plan.outline, excerpts, memory: mem, runId });
    onEvent({ stage: "write", status: "done" });

    onEvent({ stage: "lint", status: "start" });
    const fingerprint = fingerprintFor(index);
    let lint = lintArticle(markdown, { brief, profile, fingerprint });
    onEvent({ stage: "lint", status: "done", detail: `${lint.metrics.words} words, ${hardCount(lint)} hard / ${lint.issues.length - hardCount(lint)} soft issue(s)` });

    let repaired = false;
    if (hardCount(lint) > 0) {
      onEvent({ stage: "repair", status: "start", detail: lint.issues.filter((i) => i.severity === "hard").map((i) => i.code).join(", ") });
      const candidate = await repairArticle({ markdown, issues: lint.issues.filter((i) => i.severity === "hard"), profile, runId });
      const candidateLint = lintArticle(candidate, { brief, profile, fingerprint });
      // Keep the repair only if it actually reduced the hard problems.
      if (hardCount(candidateLint) < hardCount(lint)) {
        markdown = candidate;
        lint = candidateLint;
        repaired = true;
      }
      onEvent({ stage: "repair", status: "done", detail: repaired ? `${hardCount(lint)} hard issue(s) left` : "kept the original draft" });
    }

    onEvent({ stage: "save", status: "start" });
    const iterationId = randomUUID();
    db.insert(iterations).values({ id: iterationId, runId, version: 1, mode: "generate", outline: plan.outline, markdown }).run();
    db.update(runs).set({ status: "drafted" }).where(eq(runs.id, runId)).run();

    const dir = path.resolve(getConfig().VRYSE_DATA_DIR, "runs", runId);
    fs.mkdirSync(dir, { recursive: true });
    const files = { markdown: path.join(dir, "v1.md"), outline: path.join(dir, "v1.outline.json"), lint: path.join(dir, "v1.lint.json") };
    fs.writeFileSync(files.markdown, markdown);
    fs.writeFileSync(files.outline, JSON.stringify({ brief, outline: plan.outline, planIssues: plan.issues, excerpts: { articles: excerpts.articles, tokens: excerpts.tokens } }, null, 2));
    fs.writeFileSync(files.lint, JSON.stringify({ repaired, ...lint }, null, 2));
    onEvent({ stage: "save", status: "done", detail: path.relative(process.cwd(), files.markdown) });

    const [{ cost }] = db
      .select({ cost: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` })
      .from(llmCalls)
      .where(eq(llmCalls.runId, runId))
      .all();

    return { runId, iterationId, brief, outline: plan.outline, markdown, lint, repaired, excerpts, costUsd: cost, files };
  } catch (error) {
    db.update(runs).set({ status: "failed" }).where(eq(runs.id, runId)).run();
    throw error;
  }
}

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { loadProfile } from "@/lib/analysis/profile";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { evaluations, feedback as feedbackTable, iterations, llmCalls, runs } from "@/lib/db/schema";
import { comparePair } from "@/lib/evaluation/judge";
import { improvementVerdict } from "@/lib/evaluation/verdict";
import { verifyInstructions } from "@/lib/evaluation/verify";
import { compileFeedback, selectWeaknesses } from "@/lib/feedback/compile";
import { listMemory, rememberInstructions } from "@/lib/feedback/memory";
import { reviseArticle, sectionChanges, untargetedChanges, type SectionChange } from "@/lib/generation/reviser";
import { markdownToBlocks } from "@/lib/ingest/markdown";
import type { Weakness } from "@/lib/schemas/evaluation";
import type { FeedbackInput, RevisionInstruction, Verdict } from "@/lib/schemas/feedback";
import { evaluateArticle, type EvaluationResult } from "@/lib/evaluation/evaluate";
import { buildCorpusFingerprint, lintArticle, type CorpusFingerprint, type LintResult } from "@/lib/generation/lint";
import { planOutline, type Exemplar } from "@/lib/generation/planner";
import { resolveBrief } from "@/lib/generation/style-guide";
import { allowedUrls, repairArticle, writeArticle } from "@/lib/generation/writer";
import { selectExcerpts, type Excerpts } from "@/lib/retrieval/search";
import { loadIndex, type RetrievalIndex } from "@/lib/retrieval/store";
import type { BriefInput, Outline, ResolvedBrief } from "@/lib/schemas/generation";

export type Stage = "retrieve" | "plan" | "write" | "lint" | "repair" | "evaluate" | "save";
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
  evaluation: EvaluationResult;
  costUsd: number;
  files: { markdown: string; outline: string; lint: string; evaluation: string };
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

/** Standing editor preferences saved from earlier feedback. */
export function companyMemory(company: string): string[] {
  return listMemory(company).map((m) => m.instruction);
}

const hardCount = (l: LintResult) => l.issues.filter((i) => i.severity === "hard").length;

/** The passages the writer was shown: the only acceptable support for figures, for the judge. */
export const excerptChunks = (e: Excerpts) => [e.intro, ...e.body, e.conclusion].filter((c) => c !== null);

export function saveEvaluation(iterationId: string, evaluation: EvaluationResult) {
  const { dimensions, lint: _lint, ...report } = evaluation; // eslint-disable-line @typescript-eslint/no-unused-vars
  getDb()
    .insert(evaluations)
    .values({ id: randomUUID(), iterationId, overall: evaluation.overall, dimensions, report, judgeModel: evaluation.judge.model })
    .run();
}

/** A saved draft with everything needed to score it again: brief, profile, index and the writer's sources. */
export function loadIterationContext(runId: string, version?: number) {
  const db = getDb();
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) throw new Error(`No run ${runId}`);
  const all = db.select().from(iterations).where(eq(iterations.runId, runId)).all();
  const wanted = version ?? Math.max(...all.map((i) => i.version));
  const iteration = all.find((i) => i.version === wanted);
  if (!iteration) throw new Error(`Run ${runId} has no version ${wanted}`);
  const profile = loadProfile(run.company);
  const index = loadIndex(run.company);
  const meta = path.resolve(getConfig().VRYSE_DATA_DIR, "runs", runId, "v1.outline.json");
  const chunkIds: string[] = fs.existsSync(meta) ? (JSON.parse(fs.readFileSync(meta, "utf8")).excerpts?.chunkIds ?? []) : [];
  const sources = index.chunks.filter((c) => chunkIds.includes(c.id)).map(({ vector: _v, embedText: _t, ...c }) => c); // eslint-disable-line @typescript-eslint/no-unused-vars
  return { run, iteration, brief: run.brief as ResolvedBrief, profile, index, sources, fingerprint: fingerprintFor(index) };
}

/** Re-scores a saved iteration, using the same source passages the writer was given. */
export async function evaluateIteration(runId: string, version = 1, opts: { judgeRuns?: number } = {}): Promise<EvaluationResult> {
  const ctx = loadIterationContext(runId, version);
  const evaluation = await evaluateArticle(
    { markdown: ctx.iteration.markdown, brief: ctx.brief, profile: ctx.profile, index: ctx.index, sources: ctx.sources, fingerprint: ctx.fingerprint, runId, iterationId: ctx.iteration.id },
    { judgeRuns: opts.judgeRuns },
  );
  saveEvaluation(ctx.iteration.id, evaluation);
  fs.writeFileSync(path.resolve(getConfig().VRYSE_DATA_DIR, "runs", runId, `v${version}.eval.json`), JSON.stringify(evaluation, null, 2));
  return evaluation;
}

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

    const iterationId = randomUUID();
    db.insert(iterations).values({ id: iterationId, runId, version: 1, mode: "generate", outline: plan.outline, markdown }).run();

    onEvent({ stage: "evaluate", status: "start" });
    const evaluation = await evaluateArticle({ markdown, brief, profile, index, sources: excerptChunks(excerpts), fingerprint, runId, iterationId });
    onEvent({ stage: "evaluate", status: "done", detail: `overall ${evaluation.overall.toFixed(1)}${evaluation.judge.available ? "" : " (judge unavailable)"}` });

    onEvent({ stage: "save", status: "start" });
    saveEvaluation(iterationId, evaluation);
    db.update(runs).set({ status: "evaluated" }).where(eq(runs.id, runId)).run();

    const dir = path.resolve(getConfig().VRYSE_DATA_DIR, "runs", runId);
    fs.mkdirSync(dir, { recursive: true });
    const files = {
      markdown: path.join(dir, "v1.md"),
      outline: path.join(dir, "v1.outline.json"),
      lint: path.join(dir, "v1.lint.json"),
      evaluation: path.join(dir, "v1.eval.json"),
    };
    fs.writeFileSync(files.markdown, markdown);
    fs.writeFileSync(
      files.outline,
      JSON.stringify({ brief, outline: plan.outline, planIssues: plan.issues, excerpts: { articles: excerpts.articles, tokens: excerpts.tokens, chunkIds: excerptChunks(excerpts).map((c) => c.id) } }, null, 2),
    );
    fs.writeFileSync(files.lint, JSON.stringify({ repaired, ...lint }, null, 2));
    fs.writeFileSync(files.evaluation, JSON.stringify(evaluation, null, 2));
    onEvent({ stage: "save", status: "done", detail: path.relative(process.cwd(), files.markdown) });

    const [{ cost }] = db
      .select({ cost: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` })
      .from(llmCalls)
      .where(eq(llmCalls.runId, runId))
      .all();

    return { runId, iterationId, brief, outline: plan.outline, markdown, lint, repaired, excerpts, evaluation, costUsd: cost, files };
  } catch (error) {
    db.update(runs).set({ status: "failed" }).where(eq(runs.id, runId)).run();
    throw error;
  }
}

export type RevisionStage = "compile" | "revise" | "lint" | "repair" | "evaluate" | "verify" | "compare" | "save";
export type RevisionEvent = { stage: RevisionStage; status: "start" | "done"; detail?: string };

export type RevisionResult = {
  runId: string;
  version: number;
  iterationId: string;
  instructions: RevisionInstruction[];
  remembered: string[];
  markdown: string;
  previous: { version: number; overall: number };
  evaluation: EvaluationResult;
  verification: { id: string; addressed: boolean; evidence: string }[];
  verdict: Verdict;
  changes: SectionChange[];
  untargeted: string[];
  costUsd: number;
  files: { markdown: string; evaluation: string; revision: string };
};

/** The latest saved evaluation of an iteration, in the shape the verdict and the feedback step need. */
export function latestEvaluation(iterationId: string) {
  const row = getDb().select().from(evaluations).where(eq(evaluations.iterationId, iterationId)).orderBy(desc(evaluations.createdAt)).limit(1).get();
  if (!row) return null;
  const report = row.report as Omit<EvaluationResult, "dimensions" | "lint" | "overall">;
  return { ...report, overall: row.overall, dimensions: row.dimensions as EvaluationResult["dimensions"] };
}

const latestVersion = (runId: string) =>
  Math.max(...getDb().select({ v: iterations.version }).from(iterations).where(eq(iterations.runId, runId)).all().map((r) => r.v));

/**
 * One feedback cycle: compile the feedback into instructions, revise the draft (or re-plan for
 * "regenerate"), lint, then evaluate, verify each instruction and compare old vs new in parallel.
 */
export async function runRevision(
  input: { runId: string; fromVersion?: number; feedback: FeedbackInput; instructions?: RevisionInstruction[]; mode?: "revise" | "regenerate" },
  onEvent: (e: RevisionEvent) => void = () => {},
): Promise<RevisionResult> {
  const startedAt = new Date();
  const fromVersion = input.fromVersion ?? latestVersion(input.runId);
  const ctx = loadIterationContext(input.runId, fromVersion);
  const { brief, profile, index, sources, fingerprint } = ctx;
  const previousMarkdown = ctx.iteration.markdown;
  // Compare like with like: re-score the previous version if it was judged with different settings.
  const config = getConfig();
  const stored = latestEvaluation(ctx.iteration.id);
  const sameJudge =
    stored?.judge &&
    stored.judge.model === config.VRYSE_JUDGE_MODEL &&
    stored.judge.runs === config.VRYSE_JUDGE_RUNS &&
    (stored.judge.thinkingBudget ?? null) === (config.VRYSE_JUDGE_THINKING_BUDGET ?? null);
  if (!sameJudge) onEvent({ stage: "evaluate", status: "start", detail: `re-scoring v${fromVersion} with the current judge settings` });
  const previousEval = sameJudge && stored ? stored : await evaluateIteration(input.runId, fromVersion);
  const db = getDb();
  const mem = companyMemory(brief.company);

  // 1. Feedback → instructions
  onEvent({ stage: "compile", status: "start" });
  // Ticked numbers refer to the list the reviewer saw (the stored evaluation), not a fresh re-score.
  const selected: Weakness[] = selectWeaknesses((stored ?? previousEval).weaknesses, input.feedback.selectedWeaknesses ?? []);
  const headings = markdownToBlocks(previousMarkdown).filter((b) => b.type === "heading" && b.level === 2).map((b) => (b.type === "heading" ? b.text : ""));
  const instructions = input.instructions ?? (await compileFeedback({ feedback: input.feedback, weaknesses: selected, headings, profile, runId: input.runId })).instructions;
  const feedbackId = randomUUID();
  db.insert(feedbackTable)
    .values({ id: feedbackId, iterationId: ctx.iteration.id, rating: input.feedback.rating, text: input.feedback.text, sectionNotes: input.feedback.sectionNotes, selectedRecommendations: selected, compiledInstructions: instructions })
    .run();
  const remembered = rememberInstructions(brief.company, instructions, feedbackId);
  onEvent({ stage: "compile", status: "done", detail: `${instructions.length} instruction(s)${remembered.length ? `, ${remembered.length} saved to memory` : ""}` });

  // 2. Revise (targeted edit) or regenerate (re-plan with the instructions as notes)
  const mode = input.mode ?? "revise";
  onEvent({ stage: "revise", status: "start", detail: mode });
  let outline = ctx.iteration.outline as Outline;
  let markdown: string;
  if (mode === "regenerate") {
    const notes = [brief.notes, `Editor instructions for this version:\n${instructions.map((i) => `- ${i.instruction}`).join("\n")}`].filter(Boolean).join("\n\n");
    const plan = await planOutline({ brief: { ...brief, notes }, profile, exemplars: exemplarsFor(index, (await selectExcerpts(index, { topic: brief.topic, keyPoints: brief.keyPoints })).articles), memory: mem, runId: input.runId });
    outline = plan.outline;
    const excerpts = await selectExcerpts(index, { topic: brief.topic, keyPoints: brief.keyPoints, sectionHeadings: outline.sections.filter((s) => s.role === "body").map((s) => s.heading) });
    markdown = await writeArticle({ brief: { ...brief, notes }, profile, outline, excerpts, memory: mem, runId: input.runId });
  } else {
    const urls = allowedUrls({ articles: [], intro: null, conclusion: null, body: sources, tokens: 0 });
    markdown = await reviseArticle({ markdown: previousMarkdown, instructions, profile, sources, allowedUrls: urls, memory: mem, runId: input.runId });
  }
  onEvent({ stage: "revise", status: "done" });

  // 3. Lint, with one repair if the revision introduced hard problems
  onEvent({ stage: "lint", status: "start" });
  let lint = lintArticle(markdown, { brief, profile, fingerprint });
  onEvent({ stage: "lint", status: "done", detail: `${lint.metrics.words} words, ${hardCount(lint)} hard issue(s)` });
  if (hardCount(lint) > 0) {
    onEvent({ stage: "repair", status: "start" });
    const candidate = await repairArticle({ markdown, issues: lint.issues.filter((i) => i.severity === "hard"), profile, runId: input.runId });
    const candidateLint = lintArticle(candidate, { brief, profile, fingerprint });
    if (hardCount(candidateLint) < hardCount(lint)) {
      markdown = candidate;
      lint = candidateLint;
    }
    onEvent({ stage: "repair", status: "done", detail: `${hardCount(lint)} hard issue(s) left` });
  }

  const changes = sectionChanges(previousMarkdown, markdown);
  const untargeted = mode === "revise" ? untargetedChanges(changes, instructions) : [];
  const version = latestVersion(input.runId) + 1;
  const iterationId = randomUUID();
  db.insert(iterations).values({ id: iterationId, runId: input.runId, version, parentIterationId: ctx.iteration.id, mode, outline, markdown, instructions }).run();

  // 4. Evaluate, verify and compare in parallel
  onEvent({ stage: "evaluate", status: "start", detail: "with verification and side-by-side comparison" });
  const [evaluation, verification, pairwise] = await Promise.all([
    evaluateArticle({ markdown, brief, profile, index, sources, fingerprint, runId: input.runId, iterationId }),
    verifyInstructions({ before: previousMarkdown, after: markdown, instructions, profile, runId: input.runId }),
    comparePair({ first: previousMarkdown, second: markdown, brief, profile, runId: input.runId }).catch(() => null),
  ]);
  onEvent({ stage: "evaluate", status: "done", detail: `overall ${previousEval.overall.toFixed(1)} → ${evaluation.overall.toFixed(1)}` });

  const verdict = improvementVerdict(
    previousEval,
    evaluation,
    verification.results,
    getConfig().VRYSE_JUDGE_SIGMA,
    pairwise && { winner: pairwise.winner === "first" ? "previous" : pairwise.winner === "second" ? "revised" : "tie", confidence: pairwise.confidence, reasons: pairwise.reasons },
  );

  onEvent({ stage: "save", status: "start" });
  saveEvaluation(iterationId, evaluation);
  db.update(runs).set({ status: "revised" }).where(eq(runs.id, input.runId)).run();
  const dir = path.resolve(getConfig().VRYSE_DATA_DIR, "runs", input.runId);
  const files = { markdown: path.join(dir, `v${version}.md`), evaluation: path.join(dir, `v${version}.eval.json`), revision: path.join(dir, `v${version}.revision.json`) };
  fs.writeFileSync(files.markdown, markdown);
  fs.writeFileSync(files.evaluation, JSON.stringify(evaluation, null, 2));
  fs.writeFileSync(
    files.revision,
    JSON.stringify({ fromVersion, mode, feedback: input.feedback, selectedWeaknesses: selected, instructions, remembered, verification: verification.results, pairwise, verdict, changes, untargeted, lint }, null, 2),
  );
  onEvent({ stage: "save", status: "done", detail: path.relative(process.cwd(), files.markdown) });

  const [{ cost }] = db
    .select({ cost: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` })
    .from(llmCalls)
    .where(and(eq(llmCalls.runId, input.runId), gte(llmCalls.createdAt, startedAt)))
    .all();
  return {
    runId: input.runId,
    version,
    iterationId,
    instructions,
    remembered,
    markdown,
    previous: { version: fromVersion, overall: previousEval.overall },
    evaluation,
    verification: verification.results,
    verdict,
    changes,
    untargeted,
    costUsd: cost,
    files,
  };
}

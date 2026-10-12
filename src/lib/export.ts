import fs from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { iterations, llmCalls, runs } from "@/lib/db/schema";
import { markdownToBlocks } from "@/lib/ingest/markdown";
import { extractFeatures } from "@/lib/analysis/metrics";
import { latestEvaluation } from "@/lib/pipeline";
import { DIMENSIONS, type Dimension } from "@/lib/schemas/evaluation";
import type { ResolvedBrief } from "@/lib/schemas/generation";
import { readRevision } from "@/lib/ui/data";

type SummaryInput = {
  brief: Pick<ResolvedBrief, "topic" | "targetWords" | "keyPoints">;
  versions: { version: number; overall: number; dimensions: Record<Dimension, number>; words: number; judgeRuns: number }[];
  revisions: {
    version: number;
    fromVersion: number;
    feedback: string;
    instructions: { id: string; target: string; instruction: string; persist: boolean }[];
    verification: { id: string; addressed: boolean; evidence: string }[];
    verdict: { verdict: string; delta: number; threshold: number; reasons: string[]; pairwise: { winner: string; confidence: number; reasons: string[] } | null };
  }[];
  cost: number;
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

/** A readable Markdown summary of a run: scores per version, each feedback cycle and its verdict. */
export function renderSummary(data: SummaryInput): string {
  const first = data.versions[0];
  const last = data.versions[data.versions.length - 1];
  const header = `| Score | ${data.versions.map((v) => `v${v.version}`).join(" | ")} | Δ (v${first.version}→v${last.version}) |`;
  const sep = `|---|${data.versions.map(() => "---").join("|")}|---|`;
  const row = (label: string, pick: (v: SummaryInput["versions"][number]) => number) =>
    `| ${label} | ${data.versions.map((v) => pick(v).toFixed(1)).join(" | ")} | ${signed(pick(last) - pick(first))} |`;

  const lines = [
    `# Before & after: ${data.brief.topic}`,
    "",
    `Target ${data.brief.targetWords} words · key points: ${data.brief.keyPoints.join("; ")}`,
    "",
    "## Scores",
    "",
    header,
    sep,
    row("Overall", (v) => v.overall),
    ...DIMENSIONS.map((d) => row(cap(d), (v) => v.dimensions[d])),
    "",
    `Words: ${data.versions.map((v) => `v${v.version} ${v.words}`).join(" · ")} · judge runs per score: ${data.versions.map((v) => v.judgeRuns).join("/")}`,
  ];

  for (const r of data.revisions) {
    lines.push("", `## Feedback cycle: v${r.fromVersion} → v${r.version}`, "", "**Human feedback:**", "", `> ${r.feedback.replace(/\n/g, "\n> ")}`, "", "**Compiled instructions (✓ = verified in the new draft):**", "");
    for (const i of r.instructions) {
      const v = r.verification.find((x) => x.id === i.id);
      lines.push(`- ${v?.addressed ? "✓" : "✗"} **${i.id}** [${i.target}] ${i.instruction}${i.persist ? " _(saved to company memory)_" : ""}`);
      if (v?.evidence) lines.push(`  - _${v.evidence.replace(/\n/g, " ").slice(0, 240)}_`);
    }
    lines.push("", `**Verdict:** **${r.verdict.verdict.toUpperCase()}** (overall ${signed(r.verdict.delta)}, threshold ±${r.verdict.threshold})`, "");
    for (const reason of r.verdict.reasons) lines.push(`- ${reason}`);
    if (r.verdict.pairwise) {
      lines.push("", `Side-by-side judge (order randomised) preferred the ${r.verdict.pairwise.winner} version (${r.verdict.pairwise.confidence}/5):`, "");
      for (const reason of r.verdict.pairwise.reasons) lines.push(`- ${reason}`);
    }
  }
  lines.push("", `Total AI cost of this run: $${data.cost.toFixed(3)}`, "");
  return lines.join("\n");
}

/** Writes a run's brief, versions, evaluations, revisions, diffs and summary into `outDir`. */
export function exportRun(runId: string, outDir: string): { files: string[] } {
  const db = getDb();
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) throw new Error(`No run ${runId}`);
  const brief = run.brief as ResolvedBrief;
  const its = db.select().from(iterations).where(eq(iterations.runId, runId)).all().sort((a, b) => a.version - b.version);
  fs.mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  const write = (name: string, content: string) => {
    fs.writeFileSync(path.join(outDir, name), content);
    files.push(name);
  };

  write("brief.json", JSON.stringify(brief, null, 2));
  const versions: SummaryInput["versions"] = [];
  const revisions: SummaryInput["revisions"] = [];
  for (const it of its) {
    write(`v${it.version}.md`, it.markdown);
    const e = latestEvaluation(it.id);
    if (e) {
      write(`v${it.version}.evaluation.json`, JSON.stringify(e, null, 2));
      const words = extractFeatures(markdownToBlocks(it.markdown), { brandTerms: [] }).wordCount;
      versions.push({ version: it.version, overall: e.overall, dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, e.dimensions[d].score])) as Record<Dimension, number>, words, judgeRuns: e.judge.runs });
    }
    const r = readRevision(runId, it.version);
    if (r) {
      write(`v${it.version}.revision.json`, JSON.stringify(r, null, 2));
      const before = its.find((x) => x.version === r.fromVersion)!;
      write(`diff-v${r.fromVersion}-v${it.version}.diff`, createTwoFilesPatch(`v${r.fromVersion}.md`, `v${it.version}.md`, before.markdown, it.markdown));
      revisions.push({ version: it.version, fromVersion: r.fromVersion, feedback: r.feedback.text, instructions: r.instructions, verification: r.verification, verdict: r.verdict });
    }
  }
  const [{ cost }] = db.select({ cost: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` }).from(llmCalls).where(eq(llmCalls.runId, runId)).all();
  write("README.md", renderSummary({ brief, versions, revisions, cost }));
  return { files };
}

import fs from "node:fs";
import path from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { evaluations, iterations, llmCalls, runs } from "@/lib/db/schema";
import { latestEvaluation } from "@/lib/pipeline";
import type { ResolvedBrief } from "@/lib/schemas/generation";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";

const dataDir = () => path.resolve(getConfig().VRYSE_DATA_DIR);

export function listCompanies(): string[] {
  const dir = path.join(dataDir(), "profiles");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".stats.json")).map((f) => f.replace(/\.json$/, ""));
}

export function readProfile(company: string): CompanyStyleProfile | null {
  const file = path.join(dataDir(), "profiles", `${company}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as CompanyStyleProfile) : null;
}

export function listRuns() {
  const db = getDb();
  return db
    .select()
    .from(runs)
    .orderBy(desc(runs.createdAt))
    .all()
    .map((run) => {
      const its = db.select().from(iterations).where(eq(iterations.runId, run.id)).all().sort((a, b) => a.version - b.version);
      const scores = its.map((i) => latestEvaluation(i.id)?.overall ?? null);
      return { id: run.id, company: run.company, topic: (run.brief as ResolvedBrief).topic, status: run.status, createdAt: run.createdAt, versions: its.length, scores };
    })
    .filter((r) => r.versions > 0);
}

export type RevisionFile = {
  fromVersion: number;
  mode: string;
  feedback: { text: string; rating?: number };
  instructions: { id: string; target: string; action: string; instruction: string; acceptanceCheck: string; persist: boolean }[];
  verification: { id: string; addressed: boolean; evidence: string }[];
  verdict: { verdict: string; delta: number; threshold: number; reasons: string[]; pairwise: { winner: string; confidence: number; reasons: string[] } | null };
  changes: { section: string; status: string }[];
  untargeted: string[];
};

export function readRevision(runId: string, version: number): RevisionFile | null {
  const file = path.join(dataDir(), "runs", runId, `v${version}.revision.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as RevisionFile) : null;
}

export function getRunView(runId: string, version?: number) {
  const db = getDb();
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) return null;
  const its = db.select().from(iterations).where(eq(iterations.runId, runId)).all().sort((a, b) => a.version - b.version);
  if (!its.length) return null;
  const current = its.find((i) => i.version === version) ?? its[its.length - 1];
  return {
    run,
    brief: run.brief as ResolvedBrief,
    versions: its.map((i) => ({ version: i.version, mode: i.mode, overall: latestEvaluation(i.id)?.overall ?? null })),
    current,
    evaluation: latestEvaluation(current.id),
    revision: readRevision(runId, current.version),
  };
}

export function costSummary() {
  const db = getDb();
  const byStage = db
    .select({ stage: llmCalls.stage, model: llmCalls.model, calls: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`, avgMs: sql<number>`avg(${llmCalls.latencyMs})`, errors: sql<number>`sum(case when ${llmCalls.status} = 'error' then 1 else 0 end)` })
    .from(llmCalls)
    .groupBy(llmCalls.stage, llmCalls.model)
    .orderBy(desc(sql`sum(${llmCalls.costUsd})`))
    .all();
  const [{ total }] = db.select({ total: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` }).from(llmCalls).all();
  const evaluated = db.select({ n: sql<number>`count(*)` }).from(evaluations).all()[0].n;
  return { byStage, total, budget: getConfig().VRYSE_BUDGET_USD, evaluated };
}

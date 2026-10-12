import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { loadProfile } from "@/lib/analysis/profile";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { articles } from "@/lib/db/schema";
import { buildCorpusFingerprint } from "@/lib/generation/lint";
import { briefText } from "@/lib/generation/planner";
import { resolveBrief } from "@/lib/generation/style-guide";
import { cleanMarkdown } from "@/lib/generation/writer";
import { callText } from "@/lib/llm/call";
import { runGeneration } from "@/lib/pipeline";
import { chunkArticle, countWords } from "@/lib/retrieval/chunks";
import { loadIndex } from "@/lib/retrieval/store";
import { BlockSchema, type Block } from "@/lib/schemas/article";
import { DIMENSIONS, type Dimension } from "@/lib/schemas/evaluation";
import type { ResolvedBrief } from "@/lib/schemas/generation";
import type { CompanyStyleProfile } from "@/lib/schemas/profile";
import { evaluateArticle } from "./evaluate";

export type CalibrationSet = "human" | "generic" | "system";
export type CalibrationRow = {
  set: CalibrationSet;
  articleId: string;
  title: string;
  overall: number;
  dimensions: Record<Dimension, number>;
  runId?: string;
};

/** A brief that a held-out article answers: its title, up to four body headings, and its own length. */
export function briefFromArticle(article: { title: string; blocks: Block[] }, profile: CompanyStyleProfile): ResolvedBrief {
  const body = chunkArticle({ id: "ref", title: article.title, blocks: article.blocks })
    .filter((c) => c.role === "body" && c.heading)
    .map((c) => c.heading!)
    .slice(0, 4);
  const words = countWords(article.blocks.filter((b) => !(b.type === "heading" && b.level === 1)));
  const targetWords = Math.min(5000, Math.max(300, Math.round(words / 50) * 50));
  return resolveBrief({ company: profile.company, topic: article.title, keyPoints: body, targetWords }, profile);
}

/** What a plain prompt produces: the same brief and model, with no profile, examples or rules. */
export async function writeGenericBaseline(brief: ResolvedBrief, runId?: string): Promise<string> {
  const { text } = await callText({
    stage: "baseline",
    role: "writer",
    runId,
    maxOutputTokens: 16000,
    instructions: "You are a professional B2B content writer.",
    prompt: `Write a blog article for this brief. Return only the article in Markdown, starting with an H1 title.\n\n${briefText(brief)}`,
  });
  return cleanMarkdown(text);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summarize(rows: CalibrationRow[]) {
  const sets = Object.fromEntries(
    (["human", "generic", "system"] as const).map((set) => {
      const r = rows.filter((x) => x.set === set);
      return [set, { n: r.length, overall: mean(r.map((x) => x.overall)), dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, mean(r.map((x) => x.dimensions[d]))])) as Record<Dimension, number> }];
    }),
  ) as Record<CalibrationSet, { n: number; overall: number; dimensions: Record<Dimension, number> }>;
  return {
    sets,
    ordering: {
      humanAboveGeneric: sets.human.overall > sets.generic.overall,
      systemAboveGeneric: sets.system.overall > sets.generic.overall,
      humanAtLeastSystem: sets.human.overall >= sets.system.overall,
    },
  };
}

const scores = (e: { overall: number; dimensions: Record<Dimension, { score: number }> }) => ({
  overall: e.overall,
  dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, e.dimensions[d].score])) as Record<Dimension, number>,
});

/**
 * Scores three sets on the same briefs: the held-out human articles, a generic baseline and the full
 * system. Held-out articles were never in the profile or the index, so the system cannot have seen them.
 */
export async function runCalibration(company: string, opts: { limit?: number; onProgress?: (msg: string) => void } = {}) {
  const profile = loadProfile(company);
  const index = loadIndex(company);
  const fingerprint = buildCorpusFingerprint(index.chunks.map((c) => c.markdown));
  const held = getDb()
    .select()
    .from(articles)
    .where(and(eq(articles.company, company), eq(articles.split, "test")))
    .all()
    .slice(0, opts.limit ?? Infinity);
  const outDir = path.resolve(getConfig().VRYSE_DATA_DIR, "calibration");
  fs.mkdirSync(path.join(outDir, "generic"), { recursive: true });

  const perArticle = await Promise.all(
    held.map(async (a): Promise<CalibrationRow[]> => {
      const blocks = z.array(BlockSchema).parse(a.ast);
      const brief = briefFromArticle({ title: a.title, blocks }, profile);
      const base = { profile, index, fingerprint, brief };

      const humanEval = evaluateArticle({ ...base, markdown: a.markdown, sources: [], trustFigures: true });
      const genericEval = writeGenericBaseline(brief).then((md) => {
        fs.writeFileSync(path.join(outDir, "generic", `${a.id}.md`), md);
        return evaluateArticle({ ...base, markdown: md, sources: [] });
      });
      const system = runGeneration(brief);

      const [h, g, s] = await Promise.all([humanEval, genericEval, system]);
      opts.onProgress?.(`${a.title.slice(0, 60)} — human ${h.overall.toFixed(1)} · generic ${g.overall.toFixed(1)} · system ${s.evaluation.overall.toFixed(1)}`);
      const row = (set: CalibrationSet, e: Parameters<typeof scores>[0], runId?: string): CalibrationRow => ({ set, articleId: a.id, title: a.title, ...scores(e), runId });
      return [row("human", h), row("generic", g), row("system", s.evaluation, s.runId)];
    }),
  );

  const rows = perArticle.flat();
  const summary = summarize(rows);
  const file = path.join(outDir, "calibration.json");
  fs.writeFileSync(file, JSON.stringify({ company, judgeModel: getConfig().VRYSE_JUDGE_MODEL, writerModel: getConfig().VRYSE_WRITER_MODEL, builtAt: new Date().toISOString(), summary, rows }, null, 2));
  return { rows, summary, file };
}

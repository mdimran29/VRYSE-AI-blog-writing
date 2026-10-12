import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { articles } from "@/lib/db/schema";
import { inlineToPlain } from "@/lib/ingest/markdown";
import { BlockSchema, type Block } from "@/lib/schemas/article";
import { z } from "zod";
import { findAiIsms } from "./ai-isms";
import { aggregate, type Distributions } from "./aggregate";
import { extractFeatures, type Features } from "./metrics";
import { signatureTerms, type Term } from "./terms";

export type CorpusStats = {
  company: string;
  brandTerms: string[];
  articleCount: number;
  articleIds: string[];
  distributions: Distributions;
  signatureTerms: Term[];
  /** How many reference articles use each AI-ism; a phrase common in the corpus is part of the house style. */
  aiIsms: { phrase: string; articles: number; total: number }[];
  builtAt: string;
};

const plainOf = (blocks: Block[]) =>
  blocks
    .map((b) =>
      b.type === "list" ? b.items.join(" ") : b.type === "table" ? b.rows.flat().join(" ") : b.text,
    )
    .map(inlineToPlain)
    .join("\n");

/** Deterministic, LLM-free statistics over a company's training articles. */
export function buildCorpusStats(company: string, brandTerms: string[]): CorpusStats & { perArticle: { id: string; features: Features }[] } {
  const rows = getDb()
    .select({ id: articles.id, ast: articles.ast })
    .from(articles)
    .where(and(eq(articles.company, company), eq(articles.split, "train")))
    .all();
  if (!rows.length) throw new Error(`No training articles for "${company}". Run: pnpm vryse ingest --company ${company} --from-dir <dir>`);

  const docs = rows.map((r) => ({ id: r.id, blocks: z.array(BlockSchema).parse(r.ast) }));
  const perArticle = docs.map((d) => ({ id: d.id, features: extractFeatures(d.blocks, { brandTerms }) }));
  const texts = docs.map((d) => plainOf(d.blocks));

  const aiIsmTotals = new Map<string, { articles: number; total: number }>();
  for (const text of texts) {
    for (const hit of findAiIsms(text)) {
      const entry = aiIsmTotals.get(hit.phrase) ?? { articles: 0, total: 0 };
      entry.articles++;
      entry.total += hit.count;
      aiIsmTotals.set(hit.phrase, entry);
    }
  }

  return {
    company,
    brandTerms,
    articleCount: docs.length,
    articleIds: docs.map((d) => d.id),
    distributions: aggregate(perArticle.map((p) => p.features)),
    signatureTerms: signatureTerms(texts, 40),
    aiIsms: [...aiIsmTotals.entries()].map(([phrase, v]) => ({ phrase, ...v })).sort((a, b) => b.articles - a.articles),
    builtAt: new Date().toISOString(),
    perArticle,
  };
}

export function saveCorpusStats(stats: CorpusStats): string {
  const file = path.resolve(getConfig().VRYSE_DATA_DIR, "profiles", `${stats.company}.stats.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(stats, null, 2));
  return file;
}

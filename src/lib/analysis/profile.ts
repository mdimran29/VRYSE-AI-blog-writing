import fs from "node:fs";
import path from "node:path";
import { and, eq, gte, inArray, max, sql } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { articles, llmCalls, profiles } from "@/lib/db/schema";
import type { ArticleTraits, CompanyStyleProfile } from "@/lib/schemas/profile";
import { AI_ISM_PHRASES } from "./ai-isms";
import { extractTraits, synthesizeGuide } from "./extract";
import { buildCorpusStats, saveCorpusStats, type CorpusStats } from "./stats";

/** AI-isms the human corpus uses in fewer than `threshold` of its articles. */
export function avoidPhrases(stats: CorpusStats, threshold = 0.1): string[] {
  const used = new Map(stats.aiIsms.map((a) => [a.phrase, a.articles]));
  return AI_ISM_PHRASES.filter((p) => (used.get(p) ?? 0) / stats.articleCount < threshold);
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));

/** The corpus statistics as compact text, for the synthesis prompt. */
export function statsDigest(stats: CorpusStats): string {
  const bands = Object.entries(stats.distributions.numeric).map(
    ([k, b]) => `${k}: p10 ${fmt(b.p10)} · median ${fmt(b.median)} · p90 ${fmt(b.p90)}`,
  );
  const rates = Object.entries(stats.distributions.rates).map(([k, v]) => `${k}: ${Math.round(v * 100)}% of articles`);
  const terms = stats.signatureTerms.map((t) => `${t.term} (${t.docFrequency}/${stats.articleCount})`).join(", ");
  const aiIsms = stats.aiIsms.map((a) => `${a.phrase} (${a.articles}/${stats.articleCount})`).join(", ") || "none";
  const o = stats.sectionOrder;
  const order = [
    `Key takeaways section in ${o.keyTakeaways.articles}/${o.articles} articles (the first section after the intro in ${o.keyTakeaways.firstSection})`,
    `FAQ in ${o.faq.articles}/${o.articles} articles (the last section in ${o.faq.lastSection})`,
    `Conclusion heading in ${o.conclusion.articles}/${o.articles} articles (before the FAQ in ${o.conclusion.beforeFaq}, after it in ${o.conclusion.afterFaq})`,
  ];
  return [
    ...bands,
    ...rates,
    "Measured section order:",
    ...order,
    `Signature terms (articles using them): ${terms}`,
    `Generic AI-style phrases seen: ${aiIsms}`,
  ].join("\n");
}

export type BuildProgress = { done: number; total: number; failed: number };

/** Statistics + per-article extraction + synthesis → a versioned company style profile. */
export async function buildProfile(opts: {
  company: string;
  brandTerms: string[];
  onProgress?: (p: BuildProgress) => void;
}): Promise<{ profile: CompanyStyleProfile; file: string; costUsd: number; failures: { id: string; error: string }[] }> {
  const { company, brandTerms } = opts;
  const startedAt = new Date();
  const stats: CorpusStats = buildCorpusStats(company, brandTerms);
  saveCorpusStats(stats);

  const db = getDb();
  const rows = db
    .select({ id: articles.id, title: articles.title, markdown: articles.markdown })
    .from(articles)
    .where(and(eq(articles.company, company), inArray(articles.id, stats.articleIds)))
    .all();

  const progress = { done: 0, total: rows.length, failed: 0 };
  const failures: { id: string; error: string }[] = [];
  const results = await Promise.all(
    rows.map(async (row) => {
      try {
        return await extractTraits(row);
      } catch (error) {
        progress.failed++;
        failures.push({ id: row.id, error: error instanceof Error ? error.message : String(error) });
        return null;
      } finally {
        progress.done++;
        opts.onProgress?.({ ...progress });
      }
    }),
  );
  const traits = results.filter((t): t is ArticleTraits => t !== null);
  if (traits.length < rows.length * 0.8) {
    throw new Error(`Only ${traits.length}/${rows.length} articles were analysed. First error: ${failures[0]?.error}`);
  }

  const guide = await synthesizeGuide({ company, traits, statsDigest: statsDigest(stats) });

  const [{ latest }] = db.select({ latest: max(profiles.version) }).from(profiles).where(eq(profiles.company, company)).all();
  const config = getConfig();
  const profile: CompanyStyleProfile = {
    company,
    version: (latest ?? 0) + 1,
    brandTerms,
    corpus: { articleCount: stats.articleCount, articleIds: stats.articleIds, extractedArticles: traits.length },
    stats: {
      distributions: stats.distributions,
      signatureTerms: stats.signatureTerms,
      aiIsms: stats.aiIsms,
      sectionOrder: stats.sectionOrder,
    },
    guide,
    avoidPhrases: avoidPhrases(stats),
    models: { extraction: config.VRYSE_ANALYSIS_MODEL, synthesis: config.VRYSE_WRITER_MODEL },
    builtAt: new Date().toISOString(),
  };

  const dataDir = path.resolve(config.VRYSE_DATA_DIR);
  const file = path.join(dataDir, "profiles", `${company}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(profile, null, 2));
  // Per-article traits paraphrase client content, so they stay with the git-ignored processed data.
  fs.writeFileSync(path.join(dataDir, "processed", company, "traits.json"), JSON.stringify(traits, null, 2));
  db.insert(profiles).values({ company, version: profile.version, profile }).run();

  const [{ cost }] = db
    .select({ cost: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` })
    .from(llmCalls)
    .where(and(gte(llmCalls.createdAt, startedAt), inArray(llmCalls.stage, ["extract", "profile-synthesis"])))
    .all();

  return { profile, file, costUsd: cost, failures };
}

/** The latest saved profile for a company. */
export function loadProfile(company: string): CompanyStyleProfile {
  const file = path.resolve(getConfig().VRYSE_DATA_DIR, "profiles", `${company}.json`);
  if (!fs.existsSync(file)) throw new Error(`No profile for "${company}". Run: pnpm vryse profile build --company ${company}`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as CompanyStyleProfile;
}

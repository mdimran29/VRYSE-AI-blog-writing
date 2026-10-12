import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { articles } from "@/lib/db/schema";
import type { Article } from "@/lib/schemas/article";
import { assignSplits, findNearDuplicates } from "./corpus";
import { parseDocx } from "./docx";
import { blocksToMarkdown, inlineToPlain } from "./markdown";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export type IngestReport = {
  files: number;
  parsed: number;
  failed: { file: string; error: string }[];
  duplicates: { file: string; keptFile: string }[];
  train: number;
  test: number;
  editorialRemoved: number;
  promotedHeadings: number;
  withoutH2: string[];
  warnings: string[];
};

/** Parses every .docx in `dir`, drops near-duplicates, assigns a train/test split and stores the result. */
export async function ingestDirectory(opts: { company: string; dir: string; testFraction?: number; seed?: string }): Promise<IngestReport> {
  const { company, dir, testFraction = 0.1, seed = "vryse" } = opts;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".docx") && !f.startsWith("~$"))
    .sort();

  const report: IngestReport = {
    files: files.length,
    parsed: 0,
    failed: [],
    duplicates: [],
    train: 0,
    test: 0,
    editorialRemoved: 0,
    promotedHeadings: 0,
    withoutH2: [],
    warnings: [],
  };

  const parsed: Omit<Article, "split">[] = [];
  for (const file of files) {
    const sourcePath = path.join(dir, file);
    try {
      const doc = await parseDocx(sourcePath);
      const markdown = blocksToMarkdown(doc.blocks);
      parsed.push({
        id: `${slugify(doc.title)}-${sha256(file).slice(0, 6)}`,
        company,
        title: doc.title,
        sourcePath,
        meta: { fileName: file, ...doc.meta },
        blocks: doc.blocks,
        markdown,
        contentHash: sha256(markdown),
      });
      report.editorialRemoved += doc.editorialRemoved;
      report.promotedHeadings += doc.promotedHeadings;
      report.warnings.push(...doc.warnings.map((w) => `${file}: ${w}`));
      if (!doc.blocks.some((b) => b.type === "heading" && b.level === 2)) report.withoutH2.push(file);
    } catch (error) {
      report.failed.push({ file, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const plainText = (a: (typeof parsed)[number]) => inlineToPlain(a.markdown.replace(/^#+ /gm, ""));
  const dupes = findNearDuplicates(parsed.map((a) => ({ id: a.id, fileName: a.meta.fileName, text: plainText(a) })));
  const byId = new Map(parsed.map((a) => [a.id, a]));
  report.duplicates = dupes.map((d) => ({ file: byId.get(d.id)!.meta.fileName, keptFile: byId.get(d.keptId)!.meta.fileName }));
  const droppedIds = new Set(dupes.map((d) => d.id));
  const kept = parsed.filter((a) => !droppedIds.has(a.id));

  const splits = assignSplits(kept.map((a) => a.id), testFraction, seed);
  const final: Article[] = kept.map((a) => ({ ...a, split: splits.get(a.id)! }));
  report.parsed = final.length;
  report.test = final.filter((a) => a.split === "test").length;
  report.train = final.length - report.test;

  // Processed files are generated output, so rewrite the company's folder from scratch.
  const outDir = path.resolve(getConfig().VRYSE_DATA_DIR, "processed", company);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const a of final) {
    fs.writeFileSync(path.join(outDir, `${a.id}.json`), JSON.stringify(a, null, 2));
    fs.writeFileSync(path.join(outDir, `${a.id}.md`), a.markdown);
  }

  const db = getDb();
  db.transaction((tx) => {
    tx.delete(articles).where(eq(articles.company, company)).run();
    for (const a of final) {
      tx.insert(articles)
        .values({
          id: a.id,
          company,
          title: a.title,
          sourcePath: a.sourcePath,
          meta: a.meta,
          ast: a.blocks,
          markdown: a.markdown,
          contentHash: a.contentHash,
          split: a.split,
        })
        .run();
    }
  });

  return report;
}

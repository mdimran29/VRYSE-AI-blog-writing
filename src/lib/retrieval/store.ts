import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { articles } from "@/lib/db/schema";
import { BlockSchema } from "@/lib/schemas/article";
import { chunkArticle, embedTextOf, type Chunk } from "./chunks";
import { embed } from "./embed";

export type IndexedChunk = Chunk & { embedText: string; vector: Float32Array };
export type RetrievalIndex = { company: string; model: string; dims: number; builtAt: string; chunks: IndexedChunk[] };

const indexFile = (company: string) => path.resolve(getConfig().VRYSE_DATA_DIR, "index", `${company}.json`);

const toBase64 = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
const fromBase64 = (s: string) => {
  const buf = Buffer.from(s, "base64");
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

/** Chunks and embeds a company's training articles. Held-out test articles are never indexed. */
export async function buildIndex(company: string): Promise<RetrievalIndex> {
  const rows = getDb()
    .select({ id: articles.id, title: articles.title, ast: articles.ast })
    .from(articles)
    .where(and(eq(articles.company, company), eq(articles.split, "train")))
    .all();
  if (!rows.length) throw new Error(`No training articles for "${company}". Run ingest first.`);

  const chunks = rows.flatMap((r) => chunkArticle({ id: r.id, title: r.title, blocks: z.array(BlockSchema).parse(r.ast) }));
  const texts = chunks.map((c) => embedTextOf(c.articleTitle, c.heading, c.blocks));
  const vectors = await embed(texts, "passage");

  const index: RetrievalIndex = {
    company,
    model: getConfig().VRYSE_EMBED_MODEL,
    dims: vectors[0]?.length ?? 0,
    builtAt: new Date().toISOString(),
    chunks: chunks.map(({ blocks: _blocks, ...c }, i) => ({ ...c, embedText: texts[i], vector: vectors[i] })), // eslint-disable-line @typescript-eslint/no-unused-vars
  };

  const file = indexFile(company);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...index, chunks: index.chunks.map((c) => ({ ...c, vector: toBase64(c.vector) })) }));
  return index;
}

const cache = new Map<string, RetrievalIndex>();

export function loadIndex(company: string): RetrievalIndex {
  const cached = cache.get(company);
  if (cached) return cached;
  const file = indexFile(company);
  if (!fs.existsSync(file)) throw new Error(`No retrieval index for "${company}". Run: pnpm vryse index build --company ${company}`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Omit<RetrievalIndex, "chunks"> & { chunks: (Omit<IndexedChunk, "vector"> & { vector: string })[] };
  const index = { ...raw, chunks: raw.chunks.map((c) => ({ ...c, vector: fromBase64(c.vector) })) };
  cache.set(company, index);
  return index;
}

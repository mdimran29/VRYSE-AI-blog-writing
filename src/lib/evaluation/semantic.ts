import { aggregate, percentile, type Band } from "@/lib/analysis/aggregate";
import { markdownToBlocks } from "@/lib/ingest/markdown";
import { chunkArticle, embedTextOf } from "@/lib/retrieval/chunks";
import { embed, embedQuery } from "@/lib/retrieval/embed";
import type { RetrievalIndex } from "@/lib/retrieval/store";
import type { SemanticSignals } from "./measured";

const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);

function normalisedMean(vectors: Float32Array[]): Float32Array {
  const out = new Float32Array(vectors[0].length);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i];
  const norm = Math.hypot(...out) || 1;
  return out.map((x) => x / norm);
}

type Geometry = { articles: Map<string, Float32Array>; centroid: Float32Array; styleBand: Band };
const cache = new WeakMap<RetrievalIndex, Geometry>();

/**
 * Article vectors (mean of each article's non-FAQ chunks), the company centroid, and how close the
 * reference articles themselves sit to that centroid. The references are part of the centroid,
 * which slightly flatters them; with ~50 articles the effect is small.
 */
export function referenceGeometry(index: RetrievalIndex): Geometry {
  const cached = cache.get(index);
  if (cached) return cached;
  const byArticle = new Map<string, Float32Array[]>();
  for (const c of index.chunks) {
    if (c.role === "faq") continue;
    byArticle.set(c.articleId, [...(byArticle.get(c.articleId) ?? []), c.vector]);
  }
  const articles = new Map([...byArticle].map(([id, vs]) => [id, normalisedMean(vs)]));
  const centroid = normalisedMean([...articles.values()]);
  const styleBand = aggregate([...articles.values()].map((v) => ({ similarity: dot(v, centroid) }))).numeric.similarity;
  const geometry = { articles, centroid, styleBand };
  cache.set(index, geometry);
  return geometry;
}

export type Embedders = {
  embedPassages: (texts: string[]) => Promise<Float32Array[]>;
  embedQuery: (text: string) => Promise<Float32Array>;
};

const defaultEmbedders: Embedders = { embedPassages: (texts) => embed(texts, "passage"), embedQuery };

/** Embedding-based style and relevance signals for a draft, measured the same way as the references. */
export async function semanticSignals(
  draft: { markdown: string; topic: string; keyPoints?: string[] },
  index: RetrievalIndex,
  embedders: Embedders = defaultEmbedders,
): Promise<SemanticSignals> {
  const empty: SemanticSignals = { styleSimilarity: null, styleBand: null, relevanceSimilarity: null, relevanceRef: null };
  if (!index.chunks.length) return empty;
  const blocks = markdownToBlocks(draft.markdown);
  const title = blocks.find((b) => b.type === "heading" && b.level === 1);
  const chunks = chunkArticle({ id: "draft", title: title?.type === "heading" ? title.text : "", blocks }).filter((c) => c.role !== "faq");
  if (!chunks.length) return empty;

  const vectors = await embedders.embedPassages(chunks.map((c) => embedTextOf(c.articleTitle, c.heading, c.blocks)));
  const draftVector = normalisedMean(vectors);
  const geo = referenceGeometry(index);
  const briefVector = await embedders.embedQuery([draft.topic, ...(draft.keyPoints ?? [])].join(". "));
  const refSims = [...geo.articles.values()].map((v) => dot(v, briefVector));

  return {
    styleSimilarity: dot(draftVector, geo.centroid),
    styleBand: geo.styleBand,
    relevanceSimilarity: dot(draftVector, briefVector),
    relevanceRef: { p50: percentile(refSims, 0.5), p90: percentile(refSims, 0.9) },
  };
}

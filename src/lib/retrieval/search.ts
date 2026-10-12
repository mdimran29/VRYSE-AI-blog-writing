import { splitWords } from "@/lib/analysis/text";
import { Bm25 } from "./bm25";
import type { Chunk, ChunkRole } from "./chunks";
import { embedQuery as defaultEmbedQuery } from "./embed";
import type { IndexedChunk, RetrievalIndex } from "./store";

const minMax = (xs: number[]) => {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return xs.map((x) => (hi > lo ? (x - lo) / (hi - lo) : 0));
};

/** Combines cosine and BM25 after min-max normalising each, so neither scale dominates. */
export function hybridScores(cosines: number[], bm25: number[], cosineWeight = DEFAULT_COSINE_WEIGHT): number[] {
  const c = minMax(cosines);
  const b = minMax(bm25);
  return c.map((x, i) => cosineWeight * x + (1 - cosineWeight) * b[i]);
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Share of the hybrid score from embeddings; the rest comes from BM25 keyword matching. */
// 0.7 chosen on a small probe (4 queries): keyword-heavy queries need BM25 (0.8 put the only
// monsoon sections at #9), while semantic briefs stay precise; 0.6 and below started to hurt them.
export const DEFAULT_COSINE_WEIGHT = 0.7;

const bm25Cache = new WeakMap<IndexedChunk[], Bm25>();

type Ranked = { chunk: IndexedChunk; score: number };

function rank(candidates: IndexedChunk[], query: string, queryVector: Float32Array, cosineWeight = DEFAULT_COSINE_WEIGHT): Ranked[] {
  if (!candidates.length) return [];
  let bm25 = bm25Cache.get(candidates);
  if (!bm25) {
    bm25 = new Bm25(candidates.map((c) => c.embedText));
    bm25Cache.set(candidates, bm25);
  }
  const scores = hybridScores(candidates.map((c) => dot(c.vector, queryVector)), bm25.scores(query), cosineWeight);
  return candidates.map((chunk, i) => ({ chunk, score: scores[i] })).sort((a, b) => b.score - a.score);
}

/** Ranks chunks of the given roles for a free-text query. */
export async function search(
  index: RetrievalIndex,
  query: string,
  opts: { roles?: ChunkRole[]; k?: number; cosineWeight?: number; embedQuery?: (text: string) => Promise<Float32Array> } = {},
): Promise<{ chunk: Chunk; score: number }[]> {
  const candidates = opts.roles ? index.chunks.filter((c) => opts.roles!.includes(c.role)) : index.chunks;
  const vector = await (opts.embedQuery ?? defaultEmbedQuery)(query);
  return rank(candidates, query, vector, opts.cosineWeight)
    .slice(0, opts.k ?? 10)
    .map(({ chunk, score }) => ({ chunk: strip(chunk), score }));
}

const strip = ({ vector: _v, embedText: _t, ...chunk }: IndexedChunk): Chunk => chunk; // eslint-disable-line @typescript-eslint/no-unused-vars

const tokensFor = (words: number) => Math.ceil(words * 1.35);

/** Keeps whole blocks while they fit in `maxWords`; cuts inside the first block if it alone is too long. */
export function truncateMarkdown(markdown: string, maxWords: number): string {
  const blocks = markdown.trim().split(/\n\n+/);
  const kept: string[] = [];
  let used = 0;
  for (const block of blocks) {
    const n = splitWords(block).length;
    if (used + n > maxWords) break;
    kept.push(block);
    used += n;
  }
  if (kept.length) return `${kept.join("\n\n")}\n`;
  return `${blocks[0].split(/\s+/).slice(0, maxWords).join(" ")} …\n`;
}

export type Excerpts = {
  articles: { id: string; title: string; score: number }[];
  intro: Chunk | null;
  conclusion: Chunk | null;
  body: Chunk[];
  tokens: number;
};

/**
 * Voice exemplars for one brief: the intro of the closest article, the best available conclusion,
 * and body sections from different articles, all within a token budget.
 */
export async function selectExcerpts(
  index: RetrievalIndex,
  req: { topic: string; keyPoints?: string[]; sectionHeadings?: string[] },
  opts: { maxTokens?: number; bodySections?: number; embedQuery?: (text: string) => Promise<Float32Array> } = {},
): Promise<Excerpts> {
  const maxTokens = opts.maxTokens ?? 2500;
  const bodySections = opts.bodySections ?? 2;
  const embedQuery = opts.embedQuery ?? defaultEmbedQuery;
  const query = [req.topic, ...(req.keyPoints ?? [])].join(". ");
  const empty: Excerpts = { articles: [], intro: null, conclusion: null, body: [], tokens: 0 };
  if (!index.chunks.length) return empty;

  const queryVector = await embedQuery(query);
  const byRole = (role: ChunkRole) => index.chunks.filter((c) => c.role === role);

  const topArticles = rank(byRole("intro"), query, queryVector).slice(0, 3);
  const articleOrder = topArticles.map((r) => r.chunk.articleId);
  const intro = topArticles[0]?.chunk ?? null;
  const conclusions = byRole("conclusion");
  const conclusionId = articleOrder.find((id) => conclusions.some((c) => c.articleId === id));
  const conclusion = conclusions.find((c) => c.articleId === conclusionId) ?? null;

  // Body sections: by outline heading when available, otherwise by the brief; one per article.
  const bodyCandidates = byRole("body");
  const body: IndexedChunk[] = [];
  const usedArticles = new Set<string>();
  const take = (chunk: IndexedChunk) => {
    body.push(chunk);
    usedArticles.add(chunk.articleId);
  };
  if (req.sectionHeadings?.length) {
    // One excerpt per planned section, in outline order, until the quota is filled.
    for (const heading of req.sectionHeadings) {
      if (body.length >= bodySections) break;
      const q = `${req.topic}: ${heading}`;
      const best = rank(bodyCandidates, q, await embedQuery(q)).find((r) => !usedArticles.has(r.chunk.articleId));
      if (best) take(best.chunk);
    }
  } else {
    for (const { chunk } of rank(bodyCandidates, query, queryVector)) {
      if (body.length >= bodySections) break;
      if (!usedArticles.has(chunk.articleId)) take(chunk);
    }
  }

  // Fit the budget in priority order, truncating the excerpt that crosses it.
  let remaining = maxTokens;
  const fit = (c: IndexedChunk | null): Chunk | null => {
    if (!c) return null;
    const cost = tokensFor(c.words);
    if (cost <= remaining) {
      remaining -= cost;
      return strip(c);
    }
    const words = Math.floor(remaining / 1.35);
    if (words < 30) return null;
    const markdown = truncateMarkdown(c.markdown, words);
    const kept = splitWords(markdown).length;
    remaining -= tokensFor(kept);
    return { ...strip(c), markdown, words: kept };
  };
  const fittedIntro = fit(intro);
  const fittedConclusion = fit(conclusion);
  const fittedBody = body.map(fit).filter((c): c is Chunk => c !== null);

  return {
    articles: topArticles.map((r) => ({ id: r.chunk.articleId, title: r.chunk.articleTitle, score: r.score })),
    intro: fittedIntro,
    conclusion: fittedConclusion,
    body: fittedBody,
    tokens: maxTokens - remaining,
  };
}

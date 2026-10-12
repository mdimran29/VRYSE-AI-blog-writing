import { CONCLUSION, FAQ, KEY_TAKEAWAYS } from "@/lib/analysis/metrics";
import { splitWords } from "@/lib/analysis/text";
import { blocksToMarkdown, inlineToPlain } from "@/lib/ingest/markdown";
import type { Block } from "@/lib/schemas/article";

export type ChunkRole = "intro" | "takeaways" | "body" | "conclusion" | "faq";

export type Chunk = {
  id: string;
  articleId: string;
  articleTitle: string;
  role: ChunkRole;
  heading: string | null;
  markdown: string;
  words: number;
};

const plain = (b: Block) =>
  b.type === "list" ? b.items.map(inlineToPlain).join(" ") : b.type === "table" ? b.rows.flat().map(inlineToPlain).join(" ") : inlineToPlain(b.text);

export const countWords = (blocks: Block[]) => blocks.reduce((n, b) => n + splitWords(plain(b)).length, 0);

/** The text that represents a chunk for embedding and keyword search: title, heading and content. */
export function embedTextOf(articleTitle: string, heading: string | null, blocks: Block[], maxWords = 300): string {
  const body = blocks.filter((b) => b.type !== "heading" || b.text !== heading).map(plain).join(" ");
  const words = body.split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
  return [articleTitle, heading, words].filter(Boolean).join("\n");
}

/**
 * Splits an article into an intro chunk and one chunk per H2 section. An FAQ heading at any level
 * starts its own chunk. The last content section is the conclusion unless one is named.
 */
export function chunkArticle(article: { id: string; title: string; blocks: Block[] }): (Chunk & { blocks: Block[] })[] {
  type Draft = { role: ChunkRole; heading: string | null; blocks: Block[] };
  const drafts: Draft[] = [{ role: "intro", heading: null, blocks: [] }];

  for (const b of article.blocks) {
    if (b.type === "heading" && b.level === 1) continue;
    const current = drafts[drafts.length - 1];
    if (b.type === "heading" && b.level === 2) {
      const role: ChunkRole = FAQ.test(b.text) ? "faq" : KEY_TAKEAWAYS.test(b.text) ? "takeaways" : CONCLUSION.test(b.text) ? "conclusion" : "body";
      drafts.push({ role, heading: b.text, blocks: [b] });
    } else if (b.type === "heading" && FAQ.test(b.text) && current.role !== "faq") {
      drafts.push({ role: "faq", heading: b.text, blocks: [b] });
    } else {
      current.blocks.push(b);
    }
  }

  const content = drafts.filter((d) => d.blocks.length);
  if (!content.some((d) => d.role === "conclusion")) {
    const last = content.findLast((d) => d.role === "body");
    if (last) last.role = "conclusion";
  }

  return content.map((d, i) => ({
    id: `${article.id}#${i}`,
    articleId: article.id,
    articleTitle: article.title,
    role: d.role,
    heading: d.heading,
    markdown: blocksToMarkdown(d.blocks),
    words: countWords(d.blocks),
    blocks: d.blocks,
  }));
}

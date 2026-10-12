import { describe, expect, it } from "vitest";
import type { Chunk } from "@/lib/retrieval/chunks";
import type { RetrievalIndex } from "@/lib/retrieval/store";
import { hybridScores, selectExcerpts, truncateMarkdown } from "@/lib/retrieval/search";

describe("hybridScores", () => {
  it("min-max normalises both signals before weighting them", () => {
    const scores = hybridScores([0.5, 0.7, 0.9], [0, 10, 5], 0.8);
    expect(scores[0]).toBeCloseTo(0);
    expect(scores[1]).toBeCloseTo(0.8 * 0.5 + 0.2 * 1);
    expect(scores[2]).toBeCloseTo(0.8 * 1 + 0.2 * 0.5);
  });

  it("handles a signal with no spread", () => {
    expect(hybridScores([0.5, 0.5], [0, 0], 0.8)).toEqual([0, 0]);
  });
});

describe("truncateMarkdown", () => {
  it("cuts at block boundaries to fit the word budget", () => {
    expect(truncateMarkdown("## H\n\none two three\n\nfour five six\n", 5)).toBe("## H\n\none two three\n");
  });

  it("cuts inside the first block when even that is too long", () => {
    expect(truncateMarkdown("one two three four five six", 3)).toBe("one two three …\n");
  });
});

// Vectors along fixed axes make similarity easy to reason about: the query points at axis 0.
const axis = (i: number, weight = 1) => {
  const v = new Float32Array(4);
  v[i] = weight;
  return v;
};
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

function chunk(id: string, articleId: string, role: Chunk["role"], vector: Float32Array, text = "text", heading: string | null = role) {
  return {
    id,
    articleId,
    articleTitle: `Title ${articleId}`,
    role,
    heading,
    markdown: `${text}\n`,
    words: text.split(" ").length,
    embedText: text,
    vector,
  };
}

const index: RetrievalIndex = {
  company: "acme",
  model: "test",
  dims: 4,
  builtAt: "",
  chunks: [
    chunk("A#0", "A", "intro", axis(0, 0.9)), // best article
    chunk("A#1", "A", "body", axis(0, 0.95)),
    chunk("A#2", "A", "body", axis(0, 0.94)), // same article as A#1, should be skipped for diversity
    chunk("A#3", "A", "faq", axis(0, 1)), // FAQ is never an excerpt
    chunk("B#0", "B", "intro", axis(0, 0.5)),
    chunk("B#1", "B", "body", axis(0, 0.6)),
    chunk("B#2", "B", "conclusion", axis(0, 0.4)), // A has no conclusion, so B's is used
    chunk("C#0", "C", "intro", axis(1)),
    chunk("C#1", "C", "takeaways", axis(0, 1)), // takeaways are never body excerpts
  ],
};
const embedQuery = async () => axis(0);

describe("selectExcerpts", () => {
  it("picks the top article's intro, the best available conclusion and body sections from different articles", async () => {
    const result = await selectExcerpts(index, { topic: "q" }, { embedQuery });
    expect(result.articles.map((a) => a.id)).toEqual(["A", "B", "C"]);
    expect(result.intro?.id).toBe("A#0");
    expect(result.conclusion?.id).toBe("B#2");
    expect(result.body.map((c) => c.id)).toEqual(["A#1", "B#1"]);
  });

  it("stays inside the token budget, truncating the last excerpt if needed", async () => {
    const big: RetrievalIndex = {
      ...index,
      chunks: index.chunks.map((c) => (c.id === "B#1" ? { ...c, markdown: `${words(400)}\n`, words: 400 } : c)),
    };
    const result = await selectExcerpts(big, { topic: "q" }, { embedQuery, maxTokens: 300 });
    expect(result.tokens).toBeLessThanOrEqual(300);
    expect(result.body.at(-1)?.markdown.endsWith("…\n")).toBe(true);
  });

  it("returns nothing when the index is empty", async () => {
    const result = await selectExcerpts({ ...index, chunks: [] }, { topic: "q" }, { embedQuery });
    expect(result).toMatchObject({ articles: [], intro: null, conclusion: null, body: [] });
  });
});

import { describe, expect, it } from "vitest";
import { referenceGeometry, semanticSignals } from "@/lib/evaluation/semantic";
import type { RetrievalIndex } from "@/lib/retrieval/store";

const unit = (...xs: number[]) => {
  const n = Math.hypot(...xs);
  return new Float32Array(xs.map((x) => x / n));
};

const chunk = (articleId: string, role: "intro" | "body" | "faq", vector: Float32Array) => ({
  id: `${articleId}-${role}`,
  articleId,
  articleTitle: articleId,
  role,
  heading: role === "intro" ? null : role,
  markdown: "x\n",
  words: 1,
  embedText: "x",
  vector,
});

const index: RetrievalIndex = {
  company: "acme",
  model: "test",
  dims: 2,
  builtAt: "",
  chunks: [
    chunk("A", "intro", unit(1, 0)),
    chunk("A", "body", unit(1, 0)),
    chunk("A", "faq", unit(0, 1)), // FAQ chunks are left out of article vectors
    chunk("B", "intro", unit(1, 1)),
    chunk("B", "body", unit(1, 1)),
  ],
};

describe("referenceGeometry", () => {
  it("averages each article's non-FAQ chunks and builds a normalised centroid", () => {
    const geo = referenceGeometry(index);
    expect([...geo.articles.get("A")!]).toEqual([1, 0]);
    const c = geo.centroid;
    expect(Math.hypot(c[0], c[1])).toBeCloseTo(1);
    expect(c[0]).toBeGreaterThan(c[1]);
    expect(geo.styleBand.n).toBe(2);
  });
});

describe("semanticSignals", () => {
  it("compares the draft with the centroid and the brief with references", async () => {
    const signals = await semanticSignals(
      { markdown: "# Draft\n\nIntro.\n\n## Body\n\nText.\n\n## FAQs\n\n### Q?\n\nA.", topic: "q" },
      index,
      {
        embedPassages: async (texts) => texts.map(() => unit(1, 0)),
        embedQuery: async () => unit(0, 1),
      },
    );
    expect(signals.styleSimilarity).toBeCloseTo(geoCos(unit(1, 0), referenceGeometry(index).centroid));
    expect(signals.relevanceSimilarity).toBeCloseTo(0);
    expect(signals.relevanceRef?.p90).toBeGreaterThan(signals.relevanceRef!.p50 - 1e-9);
  });
});

function geoCos(a: Float32Array, b: Float32Array) {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

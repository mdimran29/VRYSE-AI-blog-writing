import { STOPWORDS, tokenize } from "@/lib/analysis/terms";

const terms = (text: string) => tokenize(text).filter((t) => !STOPWORDS.has(t));

/** Okapi BM25 over a fixed set of documents. */
export class Bm25 {
  private readonly docs: Map<string, number>[];
  private readonly lengths: number[];
  private readonly avgLength: number;
  private readonly docFreq = new Map<string, number>();

  constructor(
    texts: string[],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    this.docs = texts.map((text) => {
      const tf = new Map<string, number>();
      for (const t of terms(text)) tf.set(t, (tf.get(t) ?? 0) + 1);
      return tf;
    });
    this.lengths = this.docs.map((tf) => [...tf.values()].reduce((a, b) => a + b, 0));
    this.avgLength = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, texts.length) || 1;
    for (const tf of this.docs) for (const t of tf.keys()) this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
  }

  private idf(term: string): number {
    const n = this.docFreq.get(term) ?? 0;
    return Math.log(1 + (this.docs.length - n + 0.5) / (n + 0.5));
  }

  scores(query: string): number[] {
    const q = [...new Set(terms(query))];
    return this.docs.map((tf, i) => {
      const norm = this.k1 * (1 - this.b + (this.b * this.lengths[i]) / this.avgLength);
      return q.reduce((sum, t) => {
        const f = tf.get(t) ?? 0;
        return f ? sum + this.idf(t) * ((f * (this.k1 + 1)) / (f + norm)) : sum;
      }, 0);
    });
  }
}

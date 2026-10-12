import { createHash } from "node:crypto";

type DocText = { id: string; fileName: string; text: string };

function shingles(text: string, size = 5): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Pick which of two near-identical docs to keep: a "Revised" copy wins, then the longer one. */
function keeperOf(a: DocText, b: DocText): DocText {
  const revised = (d: DocText) => /revised/i.test(d.fileName);
  if (revised(a) !== revised(b)) return revised(a) ? a : b;
  if (a.text.length !== b.text.length) return a.text.length > b.text.length ? a : b;
  return a.id < b.id ? a : b;
}

/** Finds near-duplicate articles (5-word shingle Jaccard ≥ threshold) and says which to drop. */
export function findNearDuplicates(docs: DocText[], threshold = 0.5): { id: string; keptId: string }[] {
  const sets = docs.map((d) => shingles(d.text));
  const dropped = new Map<string, string>();
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      if (dropped.has(docs[i].id) || dropped.has(docs[j].id)) continue;
      if (jaccard(sets[i], sets[j]) < threshold) continue;
      const keep = keeperOf(docs[i], docs[j]);
      const drop = keep === docs[i] ? docs[j] : docs[i];
      dropped.set(drop.id, keep.id);
    }
  }
  return docs.filter((d) => dropped.has(d.id)).map((d) => ({ id: d.id, keptId: dropped.get(d.id)! }));
}

/** Deterministic train/test split: order by a seeded hash, hold out the first `fraction`. */
export function assignSplits(ids: string[], fraction: number, seed: string): Map<string, "train" | "test"> {
  const rank = (id: string) => createHash("sha256").update(`${seed}:${id}`).digest("hex");
  const ordered = [...ids].sort((a, b) => (rank(a) < rank(b) ? -1 : 1));
  const testCount = Math.round(ids.length * fraction);
  return new Map(ordered.map((id, i) => [id, i < testCount ? "test" : "train"]));
}

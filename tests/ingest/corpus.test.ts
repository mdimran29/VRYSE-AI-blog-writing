import { describe, expect, it } from "vitest";
import { assignSplits, findNearDuplicates } from "@/lib/ingest/corpus";

const words = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

describe("findNearDuplicates", () => {
  it("keeps the 'Revised' version of a near-duplicate pair", () => {
    const base = words(200, "w");
    const dropped = findNearDuplicates([
      { id: "a", fileName: "5 Common Issues.docx", text: base },
      { id: "b", fileName: "Revised_5 Common Issues.docx", text: `${base} extra words here` },
      { id: "c", fileName: "Other.docx", text: words(200, "z") },
    ]);
    expect(dropped).toEqual([{ id: "a", keptId: "b" }]);
  });

  it("keeps the longer version when neither is marked revised", () => {
    const base = words(200, "w");
    const dropped = findNearDuplicates([
      { id: "long", fileName: "Top 10 2026.docx", text: `${base} ${words(20, "x")}` },
      { id: "short", fileName: "Top 10.docx", text: base },
    ]);
    expect(dropped).toEqual([{ id: "short", keptId: "long" }]);
  });

  it("does not flag articles that only share boilerplate", () => {
    const shared = words(30, "s");
    const dropped = findNearDuplicates([
      { id: "a", fileName: "A.docx", text: `${shared} ${words(300, "a")}` },
      { id: "b", fileName: "B.docx", text: `${shared} ${words(300, "b")}` },
    ]);
    expect(dropped).toEqual([]);
  });
});

describe("assignSplits", () => {
  const ids = Array.from({ length: 60 }, (_, i) => `article-${i}`);

  it("holds out about 10% as the test set", () => {
    const splits = assignSplits(ids, 0.1, "seed");
    expect([...splits.values()].filter((s) => s === "test")).toHaveLength(6);
  });

  it("is deterministic for the same seed and input order-independent", () => {
    const a = assignSplits(ids, 0.1, "seed");
    const b = assignSplits([...ids].reverse(), 0.1, "seed");
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it("changes with the seed", () => {
    const a = assignSplits(ids, 0.1, "seed-1");
    const b = assignSplits(ids, 0.1, "seed-2");
    expect([...a.entries()].sort()).not.toEqual([...b.entries()].sort());
  });
});

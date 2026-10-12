import { describe, expect, it } from "vitest";
import { blocksToMarkdown, markdownToBlocks } from "@/lib/ingest/markdown";
import type { Block } from "@/lib/schemas/article";

describe("markdownToBlocks", () => {
  it("parses headings, paragraphs, lists, tables and quotes", () => {
    const md = [
      "# Title",
      "",
      "First line",
      "continues here with **bold**.",
      "",
      "## Section",
      "",
      "- one",
      "* two",
      "",
      "1. first",
      "2) second",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | x \\| y |",
      "",
      "> Quoted text.",
    ].join("\n");
    expect(markdownToBlocks(md)).toEqual([
      { type: "heading", level: 1, text: "Title" },
      { type: "paragraph", text: "First line continues here with **bold**." },
      { type: "heading", level: 2, text: "Section" },
      { type: "list", ordered: false, items: ["one", "two"] },
      { type: "list", ordered: true, items: ["first", "second"] },
      { type: "table", rows: [["A", "B"], ["1", "x | y"]] },
      { type: "quote", text: "Quoted text." },
    ]);
  });

  it("round-trips blocksToMarkdown output", () => {
    const blocks: Block[] = [
      { type: "heading", level: 1, text: "T" },
      { type: "paragraph", text: "P with [a link](https://e.com)." },
      { type: "heading", level: 3, text: "Sub?" },
      { type: "list", ordered: false, items: ["**Lead**: text"] },
      { type: "table", rows: [["h1", "h2"], ["a", "b"]] },
    ];
    expect(markdownToBlocks(blocksToMarkdown(blocks))).toEqual(blocks);
  });

  it("ignores code fences an LLM might wrap the article in", () => {
    expect(markdownToBlocks("```markdown\n# T\n\nBody.\n```")).toEqual([
      { type: "heading", level: 1, text: "T" },
      { type: "paragraph", text: "Body." },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { blocksToMarkdown, inlineToPlain } from "@/lib/ingest/markdown";

describe("blocksToMarkdown", () => {
  it("renders every block type as GitHub-flavoured markdown", () => {
    const md = blocksToMarkdown([
      { type: "heading", level: 1, text: "Title" },
      { type: "paragraph", text: "Intro **bold**." },
      { type: "list", ordered: false, items: ["a", "b"] },
      { type: "list", ordered: true, items: ["one", "two"] },
      { type: "table", rows: [["Tool", "Price"], ["A", "$1 | $2"]] },
      { type: "quote", text: "Said." },
    ]);
    expect(md).toBe(
      [
        "# Title",
        "Intro **bold**.",
        "- a\n- b",
        "1. one\n2. two",
        "| Tool | Price |\n| --- | --- |\n| A | $1 \\| $2 |",
        "> Said.",
      ].join("\n\n") + "\n",
    );
  });

  it("pads ragged table rows to the widest row", () => {
    expect(blocksToMarkdown([{ type: "table", rows: [["a", "b"], ["c"]] }])).toBe("| a | b |\n| --- | --- |\n| c |  |\n");
  });
});

describe("inlineToPlain", () => {
  it("strips bold, italics and link markup", () => {
    expect(inlineToPlain("Use **this** and *that* via [a link](https://e.com).")).toBe("Use this and that via a link.");
  });
});

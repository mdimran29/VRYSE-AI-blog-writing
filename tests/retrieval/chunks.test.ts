import { describe, expect, it } from "vitest";
import { chunkArticle } from "@/lib/retrieval/chunks";
import type { Block } from "@/lib/schemas/article";

const h = (level: number, text: string): Block => ({ type: "heading", level, text });
const p = (text: string): Block => ({ type: "paragraph", text });

describe("chunkArticle", () => {
  const blocks: Block[] = [
    h(1, "Cutting Commute Costs"),
    p("Intro one."),
    p("Intro two."),
    h(2, "Key Takeaways"),
    { type: "list", ordered: false, items: ["a", "b"] },
    h(2, "Why Costs Rise"),
    p("Body A."),
    h(3, "Fuel"),
    p("Body A sub."),
    h(2, "Route Optimisation"),
    p("Body B."),
    h(2, "Final Thoughts"),
    p("Wrap up."),
    h(3, "FAQs"),
    h(4, "Is it cheap?"),
    p("Yes."),
  ];
  const chunks = chunkArticle({ id: "art", title: "Cutting Commute Costs", blocks });

  it("splits into intro, one chunk per H2, and a separate FAQ", () => {
    expect(chunks.map((c) => [c.role, c.heading])).toEqual([
      ["intro", null],
      ["takeaways", "Key Takeaways"],
      ["body", "Why Costs Rise"],
      ["body", "Route Optimisation"],
      ["conclusion", "Final Thoughts"],
      ["faq", "FAQs"],
    ]);
  });

  it("keeps sub-headings inside their section and renders markdown with the heading", () => {
    const body = chunks[2];
    expect(body.markdown).toBe("## Why Costs Rise\n\nBody A.\n\n### Fuel\n\nBody A sub.\n");
    expect(body.words).toBe(9);
  });

  it("gives every chunk a stable id and the article's id and title", () => {
    expect(chunks[0]).toMatchObject({ id: "art#0", articleId: "art", articleTitle: "Cutting Commute Costs" });
    expect(chunks[5].id).toBe("art#5");
  });

  it("treats the last content section as the conclusion even without a conclusion heading", () => {
    const simple = chunkArticle({ id: "x", title: "T", blocks: [h(1, "T"), p("i"), h(2, "One"), p("b"), h(2, "Two"), p("c"), h(2, "FAQ"), p("q")] });
    expect(simple.map((c) => c.role)).toEqual(["intro", "body", "conclusion", "faq"]);
  });
});

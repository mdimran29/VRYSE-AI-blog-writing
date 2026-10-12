import { describe, expect, it } from "vitest";
import { htmlToBlocks } from "@/lib/ingest/docx";

describe("htmlToBlocks", () => {
  it("reads headings, dropping empty bookmark anchors and bold wrappers", () => {
    const { blocks } = htmlToBlocks('<h1><a id="_x"></a><strong>The Title</strong></h1><h2><a id="_y"></a><strong>Why &amp; How?</strong></h2>');
    expect(blocks).toEqual([
      { type: "heading", level: 1, text: "The Title" },
      { type: "heading", level: 2, text: "Why & How?" },
    ]);
  });

  it("keeps bold and links as inline markdown in paragraphs", () => {
    const { blocks } = htmlToBlocks('<p>Use <strong>route optimisation</strong> with a <a href="https://e.com/x">platform</a>.</p>');
    expect(blocks).toEqual([{ type: "paragraph", text: "Use **route optimisation** with a [platform](https://e.com/x)." }]);
  });

  it("keeps spaces outside bold markers and drops empty bold runs", () => {
    const { blocks } = htmlToBlocks("<p>A<strong> bold </strong>word<strong> </strong>end</p>");
    expect(blocks).toEqual([{ type: "paragraph", text: "A **bold** word end" }]);
  });

  it("normalises smart quotes and whitespace", () => {
    const { blocks } = htmlToBlocks("<p>It’s   “quoted”\n text</p>");
    expect(blocks).toEqual([{ type: "paragraph", text: 'It\'s "quoted" text' }]);
  });

  it("reads ordered and unordered lists", () => {
    const { blocks } = htmlToBlocks("<ul><li><strong>Safety</strong>: SOS alerts</li><li>Tracking</li></ul><ol><li>One</li></ol>");
    expect(blocks).toEqual([
      { type: "list", ordered: false, items: ["**Safety**: SOS alerts", "Tracking"] },
      { type: "list", ordered: true, items: ["One"] },
    ]);
  });

  it("reads tables as rows of cell text", () => {
    const { blocks } = htmlToBlocks("<table><tr><td><p><strong>Tool</strong></p></td><td><p>Price</p></td></tr><tr><td><p>A</p></td><td><p>$10</p></td></tr></table>");
    expect(blocks).toEqual([{ type: "table", rows: [["**Tool**", "Price"], ["A", "$10"]] }]);
  });

  it("skips images and image-only paragraphs", () => {
    const { blocks } = htmlToBlocks('<p><img src="data:image/png;base64,AAAA" /></p><p>Text <img src="x.png" />after</p>');
    expect(blocks).toEqual([{ type: "paragraph", text: "Text after" }]);
  });

  it("removes editorial labels like Grammarly reports and counts them", () => {
    const { blocks, editorialRemoved } = htmlToBlocks("<p>Real content.</p><p><strong>Grammarly Plagiarism &amp; AI Report</strong></p><p>Grammarly SS</p>");
    expect(blocks).toEqual([{ type: "paragraph", text: "Real content." }]);
    expect(editorialRemoved).toBe(2);
  });

  it("captures meta title, description and slug lines as metadata", () => {
    const { blocks, meta } = htmlToBlocks("<p><strong>Meta Title:</strong> Cut Costs</p><p>Meta Description: How to save.</p><p>URL Slug: /cut-costs</p><p>Body.</p>");
    expect(meta).toEqual({ metaTitle: "Cut Costs", metaDescription: "How to save.", urlSlug: "/cut-costs" });
    expect(blocks).toEqual([{ type: "paragraph", text: "Body." }]);
  });

  describe("bold-paragraph headings", () => {
    it("promotes short bold lines to H2 when the doc has no real H2s", () => {
      const { blocks } = htmlToBlocks("<h1>T</h1><p>Intro.</p><p><strong>What Is Corporate Mobility</strong></p><p>Body text.</p>");
      expect(blocks[2]).toEqual({ type: "heading", level: 2, text: "What Is Corporate Mobility" });
    });

    it("does not promote lines ending in a colon or period", () => {
      const { blocks } = htmlToBlocks("<h1>T</h1><p><strong>Key strengths:</strong></p><ul><li>a</li></ul><p><strong>A full sentence.</strong></p><p>x</p>");
      expect(blocks.filter((b) => b.type === "heading")).toHaveLength(1);
    });

    it("leaves bold lines alone when the doc already uses heading styles", () => {
      const { blocks } = htmlToBlocks("<h1>T</h1><h2>Real</h2><h2>Also real</h2><p><strong>Bold Line</strong></p><p>Body.</p>");
      expect(blocks.filter((b) => b.type === "heading")).toHaveLength(3);
    });
  });
});

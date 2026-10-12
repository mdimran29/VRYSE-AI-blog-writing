import { describe, expect, it } from "vitest";
import { extractFeatures, sectionOrder } from "@/lib/analysis/metrics";
import type { Block } from "@/lib/schemas/article";

// A small article whose numbers can be checked by hand.
const blocks: Block[] = [
  { type: "heading", level: 1, text: "How to Plan Employee Transport" },
  { type: "paragraph", text: "Your **commute plan** matters. We help you fix it." }, // intro: 9 words, 2 sentences
  { type: "heading", level: 2, text: "Key Takeaways" },
  { type: "list", ordered: false, items: ["Plan routes early.", "Track costs in 2026."] },
  { type: "heading", level: 2, text: "Why Do Routes Fail?" },
  { type: "paragraph", text: "Routes fail when demand changes. See [our guide](https://acme.com/x) for Acme tips." },
  { type: "heading", level: 3, text: "1. Poor Data" },
  { type: "paragraph", text: "Bad data hurts." },
  { type: "table", rows: [["Tool", "Cost"], ["Acme", "$10"]] },
  { type: "heading", level: 2, text: "Conclusion" },
  { type: "paragraph", text: "Contact Acme to book a demo today." },
  { type: "heading", level: 2, text: "FAQs" },
  { type: "heading", level: 3, text: "What is transport planning?" },
  { type: "paragraph", text: "It is planning." },
  { type: "heading", level: 3, text: "Is it costly?" },
  { type: "paragraph", text: "Not always." },
];

describe("extractFeatures with an FAQ nested under another section", () => {
  const nested: Block[] = [
    { type: "heading", level: 1, text: "Policy Guide" },
    { type: "paragraph", text: "Intro text here." },
    { type: "heading", level: 2, text: "Final Thoughts" },
    { type: "paragraph", text: "Wrap up now." },
    { type: "heading", level: 3, text: "FAQs" },
    { type: "heading", level: 4, text: "Is a policy required?" },
    { type: "paragraph", text: "Yes it is." },
    { type: "heading", level: 4, text: "Who owns it?" },
    { type: "paragraph", text: "HR does." },
  ];
  const f = extractFeatures(nested, { brandTerms: [] });

  it("finds the FAQ at any heading level and counts its questions", () => {
    expect(f.hasFaq).toBe(true);
    expect(f.faqQuestionCount).toBe(2);
  });

  it("ends the closing section where the FAQ starts", () => {
    expect(f.closingWords).toBe(3);
  });

  it("leaves FAQ headings out of the heading style rates", () => {
    expect(f.questionHeadingRate).toBe(0);
  });
});

describe("extractFeatures", () => {
  const f = extractFeatures(blocks, { brandTerms: ["Acme"] });

  it("counts structure", () => {
    expect(f.h2Count).toBe(4);
    expect(f.h3Count).toBe(3);
    expect(f.paragraphCount).toBe(6);
    expect(f.listCount).toBe(1);
    expect(f.listItemCount).toBe(2);
    expect(f.tableCount).toBe(1);
  });

  it("detects FAQ, key takeaways and a conclusion heading", () => {
    expect(f.hasFaq).toBe(true);
    expect(f.faqQuestionCount).toBe(2);
    expect(f.hasKeyTakeaways).toBe(true);
    expect(f.hasConclusionHeading).toBe(true);
  });

  it("classifies body headings (FAQ questions excluded)", () => {
    // Body H2/H3 = Key Takeaways, Why Do Routes Fail?, 1. Poor Data, Conclusion
    expect(f.questionHeadingRate).toBeCloseTo(1 / 4);
    expect(f.numberedHeadingRate).toBeCloseTo(1 / 4);
  });

  it("measures intro and closing sections", () => {
    expect(f.introWords).toBe(9);
    expect(f.closingWords).toBe(7);
    expect(f.closingHasCta).toBe(true);
  });

  it("measures paragraphs", () => {
    expect(f.oneSentenceParagraphRate).toBeCloseTo(4 / 6);
  });

  it("measures lexical rates per 1,000 words", () => {
    const per1k = (n: number) => (n / f.wordCount) * 1000;
    expect(f.secondPersonPer1k).toBeCloseTo(per1k(2)); // Your, you
    expect(f.firstPersonPluralPer1k).toBeCloseTo(per1k(2)); // We, our
    expect(f.brandMentionsPer1k).toBeCloseTo(per1k(3)); // Acme in body text, table cell and conclusion; link URLs don't count
    expect(f.linksPer1k).toBeCloseTo(per1k(1));
    expect(f.boldPer1k).toBeCloseTo(per1k(1));
  });
});

describe("sectionOrder", () => {
  const h2 = (text: string): Block => ({ type: "heading", level: 2, text });
  const p: Block = { type: "paragraph", text: "Body." };
  const docs: Block[][] = [
    [p, h2("Key Takeaways"), p, h2("Why It Matters"), p, h2("Conclusion"), p, h2("FAQs"), p],
    [p, h2("What Is X"), p, h2("Key Takeaways"), p, h2("Final Thoughts"), p, h2("FAQs"), p],
    [p, h2("What Is Y"), p, h2("FAQs"), p, h2("Conclusion"), p],
  ];

  it("measures where key takeaways, conclusion and FAQ sit", () => {
    expect(sectionOrder(docs)).toEqual({
      articles: 3,
      keyTakeaways: { articles: 2, firstSection: 1 },
      faq: { articles: 3, lastSection: 2 },
      conclusion: { articles: 3, beforeFaq: 2, afterFaq: 1 },
    });
  });
});

import { describe, expect, it } from "vitest";
import { buildCorpusFingerprint, lintArticle } from "@/lib/generation/lint";
import type { ResolvedBrief } from "@/lib/schemas/generation";
import { testProfile } from "../fixtures/profile";

const words = (n: number, prefix = "word") => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

const brief: ResolvedBrief = {
  company: "acme",
  topic: "EV fleets",
  audience: "transport heads",
  targetWords: 300,
  keyPoints: [],
  requiredSections: ["Cost Comparison"],
};

const corpusSentence = "our drivers complete a twelve point vehicle safety check before every single night shift begins";
const fingerprint = buildCorpusFingerprint([`Some text. ${corpusSentence}. See [guide](https://acme.com/blog/real).`]);

function article(opts: { extra?: string; faq?: boolean; required?: boolean; body?: number } = {}) {
  const { extra = "", faq = true, required = true, body = 120 } = opts;
  return [
    "# EV Fleets",
    "",
    words(40, "intro"),
    "",
    "## Why EVs",
    "",
    words(body, "a"),
    "",
    required ? "## Cost Comparison\n\n" + words(body, "b") : "## Other\n\n" + words(body, "b"),
    "",
    extra,
    "",
    faq ? "## FAQs\n\n### Is it cheap?\n\nYes.\n\n### Is it safe?\n\nYes." : "",
  ].join("\n");
}

const codes = (md: string) => lintArticle(md, { brief, profile: testProfile, fingerprint }).issues.map((i) => `${i.severity}:${i.code}`);

describe("lintArticle", () => {
  it("passes a clean article", () => {
    expect(codes(article()).filter((c) => c.startsWith("hard"))).toEqual([]);
  });

  it("flags length more than 25% off target as hard", () => {
    expect(codes(article({ body: 400 }))).toContain("hard:length");
  });

  it("flags a missing FAQ and a missing required section as hard", () => {
    expect(codes(article({ faq: false }))).toContain("hard:faq-missing");
    expect(codes(article({ required: false }))).toContain("hard:required-section-missing");
  });

  it("flags URLs that do not appear in the reference corpus", () => {
    expect(codes(article({ extra: "Read [this](https://acme.com/blog/made-up)." }))).toContain("hard:unverified-url");
    expect(codes(article({ extra: "Read [this](https://acme.com/blog/real)." }))).not.toContain("hard:unverified-url");
  });

  it("flags a sentence copied from the corpus", () => {
    expect(codes(article({ extra: `As we say, ${corpusSentence}.` }))).toContain("hard:copied-text");
  });

  it("flags phrases the house style avoids as soft", () => {
    expect(codes(article({ extra: "Let us delve into it." }))).toContain("soft:avoid-phrase");
  });

  it("requires exactly one H1", () => {
    expect(codes(`${article()}\n\n# Second Title`)).toContain("hard:h1");
  });
});

describe("unsupported figures", () => {
  const fp = buildCorpusFingerprint(["India recorded 2.3 million EV sales and over 29,000 public chargers; costs fell 18%."]);
  const md = [
    "# T",
    "",
    "India saw 2.3 million EV sales and 29,000 chargers in 2025. Follow these 5 steps.",
    "",
    "Keep a 15–30% range buffer and plan 400 km duties. Costs fell 18 percent.",
  ].join("\n");

  it("lists figures that appear in neither the corpus nor the brief", () => {
    const result = lintArticle(md, { brief: { ...brief, notes: "Budget is 400 km per day" }, profile: testProfile, fingerprint: fp });
    expect(result.metrics.unsupportedFigures).toEqual(["30%"]);
    expect(result.issues.map((i) => `${i.severity}:${i.code}`)).toContain("soft:unsupported-figure");
  });
});

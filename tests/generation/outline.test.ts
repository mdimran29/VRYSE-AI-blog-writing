import { describe, expect, it } from "vitest";
import { checkOutline } from "@/lib/generation/planner";
import type { Outline, ResolvedBrief } from "@/lib/schemas/generation";
import { testProfile } from "../fixtures/profile";

const brief: ResolvedBrief = {
  company: "acme",
  topic: "Moving the employee fleet to EVs",
  audience: "transport heads",
  targetWords: 1500,
  keyPoints: ["Charging infrastructure", "Cost per km"],
  requiredSections: ["Comparison of EV models", "FAQ"],
};

const section = (heading: string, keyPoints: string[] = [], role: "body" | "conclusion" = "body") => ({
  heading,
  role,
  intent: "",
  keyPoints,
  devices: [],
  subheadings: [],
  targetWords: 200,
});

const good: Outline = {
  title: "EV Fleets",
  primaryKeyword: "electric employee fleet",
  metaDescription: "",
  intro: { hook: "", promise: "", targetWords: 125 },
  keyTakeaways: true,
  sections: [
    section("Why Fleets Are Going Electric"),
    section("Planning Charging Infrastructure for Shift Operations", ["charging infrastructure"]),
    section("What EVs Really Cost per Km", ["Cost per km"]),
    section("Comparison of EV Models for Employee Transport"),
    section("Rolling Out in Phases"),
    section("Conclusion", [], "conclusion"),
  ],
  faq: ["Q1?", "Q2?", "Q3?", "Q4?", "Q5?"],
  cta: "none",
};

describe("checkOutline", () => {
  it("accepts an outline that covers the brief and fits the profile", () => {
    expect(checkOutline(good, brief, testProfile)).toEqual([]);
  });

  it("flags a key point that no section covers", () => {
    const outline = { ...good, sections: good.sections.map((s) => ({ ...s, keyPoints: s.keyPoints.filter((k) => k !== "Cost per km") })) };
    expect(checkOutline(outline, brief, testProfile).map((i) => i.code)).toContain("key-point-missing");
  });

  it("flags a required section that is missing", () => {
    const outline = { ...good, sections: good.sections.filter((s) => !s.heading.startsWith("Comparison")) };
    expect(checkOutline(outline, brief, testProfile).map((i) => i.code)).toContain("required-section-missing");
  });

  it("flags too few FAQ questions when the house style always has an FAQ", () => {
    expect(checkOutline({ ...good, faq: ["Only one?"] }, brief, testProfile).map((i) => i.code)).toContain("faq-too-short");
  });

  it("flags an H2 count outside the house range", () => {
    const outline = { ...good, sections: [section("One"), section("End", [], "conclusion")], keyTakeaways: false };
    expect(checkOutline(outline, brief, testProfile).map((i) => i.code)).toContain("h2-count");
  });

  it("flags a missing or misplaced conclusion", () => {
    const outline = { ...good, sections: [good.sections[5], ...good.sections.slice(0, 5)] };
    expect(checkOutline(outline, brief, testProfile).map((i) => i.code)).toContain("conclusion-position");
  });
});

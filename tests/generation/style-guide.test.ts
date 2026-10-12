import { describe, expect, it } from "vitest";
import { renderStyleGuide, resolveBrief } from "@/lib/generation/style-guide";
import { testProfile } from "../fixtures/profile";

describe("renderStyleGuide", () => {
  const text = renderStyleGuide(testProfile);

  it("includes the voice, rules and phrases to avoid", () => {
    expect(text).toContain("practical, authoritative");
    expect(text).toContain("DO-RULE-MARKER");
    expect(text).toContain("DONT-RULE-MARKER");
    expect(text).toContain("delve");
    expect(text).toContain("British spelling");
  });

  it("states numeric targets from the measured corpus", () => {
    expect(text).toContain("about 15 words per sentence");
    expect(text).toContain("5–10 H2 sections");
    expect(text).toContain("intro of about 125 words");
  });

  it("states the measured section order", () => {
    expect(text).toMatch(/FAQ.*last section in 48\/50/);
  });
});

describe("resolveBrief", () => {
  it("fills audience and length from the profile", () => {
    const brief = resolveBrief({ company: "acme", topic: "EV fleets" }, testProfile);
    expect(brief.audience).toBe(testProfile.guide.audience);
    expect(brief.targetWords).toBe(1500);
    expect(brief.keyPoints).toEqual([]);
  });

  it("keeps values the user set", () => {
    const brief = resolveBrief({ company: "acme", topic: "EV fleets", audience: "CFOs", targetWords: 900 }, testProfile);
    expect(brief).toMatchObject({ audience: "CFOs", targetWords: 900 });
  });
});

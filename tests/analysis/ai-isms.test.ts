import { describe, expect, it } from "vitest";
import { findAiIsms } from "@/lib/analysis/ai-isms";

describe("findAiIsms", () => {
  it("counts known phrases case-insensitively, including inflections", () => {
    const hits = findAiIsms("In today's fast-paced world, we delve into data. Delving deeper is a game-changer.");
    expect(hits).toEqual(
      expect.arrayContaining([
        { phrase: "in today's fast-paced", count: 1 },
        { phrase: "delve", count: 2 },
        { phrase: "game-changer", count: 1 },
      ]),
    );
  });

  it("matches whole words only", () => {
    expect(findAiIsms("The shelves were unlocked.")).toEqual([]);
  });

  it("returns nothing for plain text", () => {
    expect(findAiIsms("Route planning cuts cost by 20%.")).toEqual([]);
  });
});

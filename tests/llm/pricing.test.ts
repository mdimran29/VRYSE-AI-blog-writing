import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "@/lib/llm/pricing";

describe("estimateCostUsd", () => {
  it("prices a known model from its per-token rates", () => {
    // GPT-5 mini: $0.25 / 1M input, $2 / 1M output
    const cost = estimateCostUsd("openai/gpt-5-mini", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(2.25, 6);
  });

  it("returns null for models it has no price for", () => {
    expect(estimateCostUsd("ollama/qwen3:14b", { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });

  it("treats missing token counts as zero", () => {
    // Gemini 2.5 Flash-Lite: $0.40 / 1M output
    expect(estimateCostUsd("google/gemini-2.5-flash-lite", { inputTokens: undefined, outputTokens: 2_500_000 })).toBeCloseTo(1, 6);
  });
});

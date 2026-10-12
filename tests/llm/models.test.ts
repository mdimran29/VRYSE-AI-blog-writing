import { describe, expect, it } from "vitest";
import { parseModelString } from "@/lib/llm/models";

describe("parseModelString", () => {
  it("routes plain provider/model strings through the gateway", () => {
    expect(parseModelString("anthropic/claude-haiku-5.5")).toEqual({
      kind: "gateway",
      modelId: "anthropic/claude-haiku-5.5",
    });
  });

  it("routes google-direct/ to the Gemini API", () => {
    expect(parseModelString("google-direct/gemini-3.5-flash")).toEqual({
      kind: "google-direct",
      modelId: "gemini-3.5-flash",
    });
  });

  it("routes ollama/ to a local model and keeps tags", () => {
    expect(parseModelString("ollama/qwen3:14b")).toEqual({
      kind: "ollama",
      modelId: "qwen3:14b",
    });
  });

  it("rejects strings without a provider", () => {
    expect(() => parseModelString("claude-haiku")).toThrow(/provider\/model/);
    expect(() => parseModelString("ollama/")).toThrow(/provider\/model/);
  });
});

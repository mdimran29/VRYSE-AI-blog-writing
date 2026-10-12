import { describe, expect, it } from "vitest";
import { parseConfig } from "@/lib/config";

describe("parseConfig", () => {
  it("applies defaults when nothing is set", () => {
    const config = parseConfig({});
    expect(config.VRYSE_ANALYSIS_MODEL).toBe("google/gemini-2.5-flash-lite");
    expect(config.VRYSE_WRITER_MODEL).toBe("openai/gpt-5-mini");
    expect(config.VRYSE_JUDGE_MODEL).toBe("google/gemini-2.5-flash");
    expect(config.VRYSE_LLM_CONCURRENCY).toBe(6);
    expect(config.VRYSE_DEV_CACHE).toBe(true);
  });

  it("treats empty strings as unset", () => {
    const config = parseConfig({ VRYSE_DEV_CACHE: "", VRYSE_WRITER_MODEL: "" });
    expect(config.VRYSE_DEV_CACHE).toBe(true);
    expect(config.VRYSE_WRITER_MODEL).toBe("openai/gpt-5-mini");
  });

  it("parses booleans and numbers", () => {
    const config = parseConfig({ VRYSE_DEV_CACHE: "false", VRYSE_LLM_CONCURRENCY: "1" });
    expect(config.VRYSE_DEV_CACHE).toBe(false);
    expect(config.VRYSE_LLM_CONCURRENCY).toBe(1);
  });

  it("rejects an invalid concurrency", () => {
    expect(() => parseConfig({ VRYSE_LLM_CONCURRENCY: "0" })).toThrow();
  });
});

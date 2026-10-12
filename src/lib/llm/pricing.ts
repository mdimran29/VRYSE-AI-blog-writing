// USD per token, from the AI Gateway price list (https://ai-gateway.vercel.sh/v1/models) on 2026-10-12.
// Only used when the gateway response doesn't report a cost itself.
// All of these models were reachable on the gateway's free tier on that date.
const PRICES: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-flash-lite": { input: 0.0000001, output: 0.0000004 },
  "google/gemini-2.5-flash": { input: 0.0000003, output: 0.0000025 },
  "openai/gpt-5-mini": { input: 0.00000025, output: 0.000002 },
  "openai/gpt-5": { input: 0.00000125, output: 0.00001 },
  "openai/gpt-4.1": { input: 0.000002, output: 0.000008 },
  "openai/gpt-4.1-mini": { input: 0.0000004, output: 0.0000016 },
};

export function estimateCostUsd(
  model: string,
  usage: { inputTokens: number | undefined; outputTokens: number | undefined },
): number | null {
  const price = PRICES[model];
  if (!price) return null;
  return (usage.inputTokens ?? 0) * price.input + (usage.outputTokens ?? 0) * price.output;
}

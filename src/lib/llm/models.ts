import { gateway, type LanguageModel } from "ai";
import { getConfig } from "@/lib/config";

export type ModelRoute = {
  kind: "gateway" | "google-direct" | "ollama";
  modelId: string;
};

const PREFIXES = { "google-direct/": "google-direct", "ollama/": "ollama" } as const;

/**
 * Model strings are "provider/model". Plain strings go through the Vercel AI Gateway;
 * "google-direct/…" calls the Gemini API free tier and "ollama/…" a local model.
 */
export function parseModelString(value: string): ModelRoute {
  for (const [prefix, kind] of Object.entries(PREFIXES)) {
    if (value.startsWith(prefix)) {
      const modelId = value.slice(prefix.length);
      if (!modelId) break;
      return { kind, modelId };
    }
  }
  const [provider, ...rest] = value.split("/");
  if (!provider || rest.length === 0 || !rest.join("/")) {
    throw new Error(`Invalid model "${value}". Expected a "provider/model" string, e.g. anthropic/claude-haiku-5.5`);
  }
  return { kind: "gateway", modelId: value };
}

// Optional providers are imported by name at runtime so they stay optional dependencies.
async function importOptional(pkg: string): Promise<Record<string, unknown>> {
  try {
    return (await import(/* webpackIgnore: true */ pkg)) as Record<string, unknown>;
  } catch {
    throw new Error(`Model routing needs the "${pkg}" package. Install it with: pnpm add ${pkg}`);
  }
}

export async function resolveModel(value: string): Promise<LanguageModel> {
  const route = parseModelString(value);
  const config = getConfig();

  if (route.kind === "gateway") return gateway(route.modelId);

  if (route.kind === "google-direct") {
    const mod = await importOptional("@ai-sdk/google");
    const create = mod.createGoogleGenerativeAI as (opts: { apiKey?: string }) => (id: string) => LanguageModel;
    return create({ apiKey: config.GOOGLE_GENERATIVE_AI_API_KEY })(route.modelId);
  }

  // Ollama exposes an OpenAI-compatible API under /v1.
  const mod = await importOptional("@ai-sdk/openai-compatible");
  const create = mod.createOpenAICompatible as (opts: { name: string; baseURL: string }) => (id: string) => LanguageModel;
  return create({ name: "ollama", baseURL: `${config.OLLAMA_BASE_URL}/v1` })(route.modelId);
}

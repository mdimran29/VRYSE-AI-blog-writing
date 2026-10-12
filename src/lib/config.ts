import { z } from "zod";

// Empty strings in .env files mean "not set", so the default applies.
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema);

const EnvSchema = z.object({
  AI_GATEWAY_API_KEY: unsetIfEmpty(z.string().optional()),
  VRYSE_ANALYSIS_MODEL: unsetIfEmpty(z.string().default("google/gemini-2.5-flash-lite")),
  VRYSE_WRITER_MODEL: unsetIfEmpty(z.string().default("openai/gpt-5-mini")),
  VRYSE_JUDGE_MODEL: unsetIfEmpty(z.string().default("google/gemini-2.5-flash")),
  VRYSE_LLM_CONCURRENCY: unsetIfEmpty(z.coerce.number().int().min(1).default(6)),
  VRYSE_DEV_CACHE: unsetIfEmpty(
    z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
  ),
  VRYSE_EMBED_MODEL: unsetIfEmpty(z.string().default("Xenova/bge-small-en-v1.5")),
  VRYSE_DATA_DIR: unsetIfEmpty(z.string().default("./data")),
  VRYSE_DB_PATH: unsetIfEmpty(z.string().default("./data/vryse.db")),
  GOOGLE_GENERATIVE_AI_API_KEY: unsetIfEmpty(z.string().optional()),
  OLLAMA_BASE_URL: unsetIfEmpty(z.string().default("http://localhost:11434")),
});

export type Config = z.infer<typeof EnvSchema>;

export function parseConfig(env: Record<string, string | undefined>): Config {
  return EnvSchema.parse(env);
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}

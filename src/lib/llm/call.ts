import path from "node:path";
import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import pLimit from "p-limit";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { llmCalls } from "@/lib/db/schema";
import { cacheKey, readCache, writeCache } from "./cache";
import { resolveModel } from "./models";
import { estimateCostUsd } from "./pricing";

export type LlmRole = "analysis" | "writer" | "judge";

export type CallOptions = {
  /** Pipeline stage, e.g. "extract", "plan", "judge". Used for logging and cost reports. */
  stage: string;
  /** Picks the configured model for this role unless `model` overrides it. */
  role: LlmRole;
  /** A "provider/model" string, or a model instance (used by tests). */
  model?: string | LanguageModel;
  /** Cache identity for a model instance, which has no string name. */
  cacheModelKey?: string;
  /** Stable instructions go first so providers can cache them across calls. */
  instructions: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  runId?: string;
  iterationId?: string;
  /** Use the dev response cache (defaults to VRYSE_DEV_CACHE). */
  cache?: boolean;
};

export type CallMeta = {
  model: string;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  costUsd: number | null;
  latencyMs: number;
  devCacheHit: boolean;
};

const ROLE_MODEL = {
  analysis: "VRYSE_ANALYSIS_MODEL",
  writer: "VRYSE_WRITER_MODEL",
  judge: "VRYSE_JUDGE_MODEL",
} as const;

let limiter: ReturnType<typeof pLimit> | undefined;
const limit = () => (limiter ??= pLimit(getConfig().VRYSE_LLM_CONCURRENCY));

function modelName(model: string | LanguageModel): string {
  if (typeof model === "string") return model;
  return `${model.provider}/${model.modelId}`;
}

type Usage = { inputTokens: number | undefined; outputTokens: number | undefined; cacheReadTokens?: number };

function logCall(opts: CallOptions, model: string, entry: {
  usage?: Usage;
  latencyMs: number;
  costUsd: number | null;
  devCacheHit: boolean;
  error?: string;
  generationId?: string;
}) {
  getDb()
    .insert(llmCalls)
    .values({
      stage: opts.stage,
      role: opts.role,
      model,
      runId: opts.runId,
      iterationId: opts.iterationId,
      inputTokens: entry.usage?.inputTokens,
      outputTokens: entry.usage?.outputTokens,
      cacheReadTokens: entry.usage?.cacheReadTokens,
      latencyMs: entry.latencyMs,
      costUsd: entry.costUsd,
      devCacheHit: entry.devCacheHit,
      status: entry.error ? "error" : "ok",
      error: entry.error,
      generationId: entry.generationId,
    })
    .run();
}

function costFrom(model: string, usage: Usage, providerMetadata: unknown): number | null {
  // Prefer the cost the gateway reports; fall back to list prices.
  const gateway = (providerMetadata as { gateway?: Record<string, unknown> } | undefined)?.gateway;
  const reported = Number(gateway?.cost);
  if (gateway?.cost !== undefined && Number.isFinite(reported)) return reported;
  return estimateCostUsd(model, usage);
}

async function invoke<T>(opts: CallOptions, schema: z.ZodType<T> | undefined): Promise<{ value: T | string; meta: CallMeta }> {
  const config = getConfig();
  const configured = opts.model ?? config[ROLE_MODEL[opts.role]];
  const name = modelName(configured);
  const useCache = opts.cache ?? config.VRYSE_DEV_CACHE;
  const cacheDir = path.resolve(config.VRYSE_DATA_DIR, ".llm-cache");
  const key = cacheKey({
    model: opts.cacheModelKey ?? name,
    instructions: opts.instructions,
    prompt: opts.prompt,
    schema: schema ? z.toJSONSchema(schema) : null,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
  });

  if (useCache) {
    const hit = readCache<{ value: unknown }>(cacheDir, key);
    if (hit) {
      const value = schema ? schema.parse(hit.value) : String(hit.value);
      logCall(opts, name, { latencyMs: 0, costUsd: 0, devCacheHit: true });
      return { value, meta: { model: name, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, devCacheHit: true } };
    }
  }

  const model = typeof configured === "string" ? await resolveModel(configured) : configured;

  const attempt = async (prompt: string) => {
    const started = Date.now();
    try {
      const request = {
        model,
        instructions: {
          role: "system" as const,
          content: opts.instructions,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        prompt,
        temperature: opts.temperature,
        maxOutputTokens: opts.maxOutputTokens,
        maxRetries: 4,
      };
      const result = schema
        ? await generateText({ ...request, output: Output.object({ schema }) })
        : await generateText(request);
      const value: T | string = schema ? (result.output as T) : result.text;
      const usage: Usage = {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.inputTokenDetails?.cacheReadTokens,
      };
      const latencyMs = Date.now() - started;
      const costUsd = costFrom(name, usage, result.providerMetadata);
      const generationId = result.providerMetadata?.gateway?.generationId;
      logCall(opts, name, {
        usage,
        latencyMs,
        costUsd,
        devCacheHit: false,
        generationId: typeof generationId === "string" ? generationId : undefined,
      });
      return { value, meta: { model: name, ...usage, costUsd, latencyMs, devCacheHit: false } };
    } catch (error) {
      const usage = NoObjectGeneratedError.isInstance(error) && error.usage
        ? { inputTokens: error.usage.inputTokens, outputTokens: error.usage.outputTokens }
        : undefined;
      logCall(opts, name, {
        usage,
        latencyMs: Date.now() - started,
        costUsd: usage ? estimateCostUsd(name, usage) : null,
        devCacheHit: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const result = await limit()(async () => {
    try {
      return await attempt(opts.prompt);
    } catch (error) {
      // One retry with the validation error, so the model can correct its JSON.
      if (!schema || !NoObjectGeneratedError.isInstance(error)) throw error;
      const reason = error.cause instanceof Error ? error.cause.message : error.message;
      return attempt(
        `${opts.prompt}\n\nYour previous response did not match the required schema: ${reason}\nRespond again with JSON that matches the schema exactly.`,
      );
    }
  });

  if (useCache) writeCache(cacheDir, key, { value: result.value });
  return result;
}

/** Structured output, validated against a Zod schema. */
export async function callObject<T>(opts: CallOptions & { schema: z.ZodType<T> }): Promise<{ output: T; meta: CallMeta }> {
  const { value, meta } = await invoke(opts, opts.schema);
  return { output: value as T, meta };
}

/** Plain text output, e.g. Markdown articles. */
export async function callText(opts: CallOptions): Promise<{ text: string; meta: CallMeta }> {
  const { value, meta } = await invoke(opts, undefined);
  return { text: value as string, meta };
}

import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const articles = sqliteTable("articles", {
  id: text("id").primaryKey(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  sourcePath: text("source_path").notNull(),
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
  ast: text("ast", { mode: "json" }).notNull(),
  markdown: text("markdown").notNull(),
  contentHash: text("content_hash").notNull(),
  split: text("split", { enum: ["train", "test"] }).notNull().default("train"),
  createdAt: createdAt(),
});

export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  company: text("company").notNull(),
  version: integer("version").notNull(),
  profile: text("profile", { mode: "json" }).notNull(),
  createdAt: createdAt(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  company: text("company").notNull(),
  brief: text("brief", { mode: "json" }).notNull(),
  profileVersion: integer("profile_version"),
  status: text("status").notNull().default("pending"),
  createdAt: createdAt(),
});

export const iterations = sqliteTable("iterations", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  version: integer("version").notNull(),
  parentIterationId: text("parent_iteration_id"),
  mode: text("mode", { enum: ["generate", "revise", "regenerate"] }).notNull(),
  outline: text("outline", { mode: "json" }),
  markdown: text("markdown").notNull(),
  instructions: text("instructions", { mode: "json" }),
  approved: integer("approved", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

export const evaluations = sqliteTable("evaluations", {
  id: text("id").primaryKey(),
  iterationId: text("iteration_id")
    .notNull()
    .references(() => iterations.id),
  overall: real("overall").notNull(),
  dimensions: text("dimensions", { mode: "json" }).notNull(),
  report: text("report", { mode: "json" }).notNull(),
  judgeModel: text("judge_model").notNull(),
  createdAt: createdAt(),
});

export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  iterationId: text("iteration_id")
    .notNull()
    .references(() => iterations.id),
  rating: integer("rating"),
  text: text("text"),
  sectionNotes: text("section_notes", { mode: "json" }),
  selectedRecommendations: text("selected_recommendations", { mode: "json" }),
  compiledInstructions: text("compiled_instructions", { mode: "json" }),
  decision: text("decision", { enum: ["approve", "reject"] }),
  createdAt: createdAt(),
});

export const memory = sqliteTable("memory", {
  id: text("id").primaryKey(),
  company: text("company").notNull(),
  instruction: text("instruction").notNull(),
  sourceFeedbackId: text("source_feedback_id"),
  createdAt: createdAt(),
});

export const llmCalls = sqliteTable("llm_calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stage: text("stage").notNull(),
  role: text("role").notNull(),
  model: text("model").notNull(),
  runId: text("run_id"),
  iterationId: text("iteration_id"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  latencyMs: integer("latency_ms").notNull(),
  costUsd: real("cost_usd"),
  devCacheHit: integer("dev_cache_hit", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["ok", "error"] }).notNull(),
  error: text("error"),
  generationId: text("generation_id"),
  createdAt: createdAt(),
});

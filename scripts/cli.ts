import path from "node:path";
import dotenv from "dotenv";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { gateway } from "ai";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { ingestDirectory } from "@/lib/ingest/ingest";
import { buildCorpusStats, saveCorpusStats } from "@/lib/analysis/stats";
import { llmCalls } from "@/lib/db/schema";
import { callObject, type LlmRole } from "@/lib/llm/call";
import { parseModelString } from "@/lib/llm/models";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const program = new Command().name("vryse").description("VRYSE blog writing pipeline");

const ROLES: LlmRole[] = ["analysis", "writer", "judge"];
const roleModel = (role: LlmRole) =>
  getConfig()[({ analysis: "VRYSE_ANALYSIS_MODEL", writer: "VRYSE_WRITER_MODEL", judge: "VRYSE_JUDGE_MODEL" } as const)[role]];

const usd = (n: number | null | undefined) => (n == null ? "n/a" : `$${n.toFixed(6)}`);

program
  .command("ping")
  .description("Check that each configured model answers with valid structured output")
  .option("--role <role>", "analysis | writer | judge | all", "all")
  .option("--no-cache", "bypass the dev response cache")
  .action(async (opts: { role: string; cache: boolean }) => {
    const roles = opts.role === "all" ? ROLES : [opts.role as LlmRole];
    if (!roles.every((r) => ROLES.includes(r))) program.error(`Unknown role "${opts.role}"`);

    const needsGateway = roles.some((r) => parseModelString(roleModel(r)).kind === "gateway");
    if (needsGateway && !getConfig().AI_GATEWAY_API_KEY) {
      program.error("AI_GATEWAY_API_KEY is not set. Add it to .env.local (see .env.example).");
    }

    const Pong = z.object({ status: z.literal("ok"), model: z.string().describe("your model name") });
    let failed = false;
    for (const role of roles) {
      try {
        const { output, meta } = await callObject({
          stage: "ping",
          role,
          instructions: "You are a health check. Answer only with the requested JSON.",
          prompt: 'Return status "ok" and your model name.',
          schema: Pong,
          maxOutputTokens: 2000,
          cache: opts.cache,
        });
        console.log(
          `✓ ${role.padEnd(8)} ${meta.model.padEnd(30)} → ${JSON.stringify(output)}  ` +
            `[${meta.inputTokens ?? 0} in / ${meta.outputTokens ?? 0} out, ${meta.latencyMs} ms, ${usd(meta.costUsd)}${meta.devCacheHit ? ", dev cache" : ""}]`,
        );
      } catch (error) {
        failed = true;
        console.error(`✗ ${role.padEnd(8)} ${roleModel(role).padEnd(30)} → ${error instanceof Error ? error.message : error}`);
      }
    }
    if (failed) process.exitCode = 1;
  });

program
  .command("ingest")
  .description("Parse a folder of .docx reference articles into the database and data/processed/")
  .requiredOption("--company <slug>", "company slug, e.g. protecto")
  .requiredOption("--from-dir <dir>", "folder containing .docx files")
  .option("--test-fraction <n>", "share of articles held out for calibration", "0.1")
  .action(async (opts: { company: string; fromDir: string; testFraction: string }) => {
    const report = await ingestDirectory({ company: opts.company, dir: opts.fromDir, testFraction: Number(opts.testFraction) });
    console.log(`Files: ${report.files} · parsed: ${report.parsed} (train ${report.train}, test ${report.test})`);
    console.log(`Editorial labels removed: ${report.editorialRemoved} · bold lines promoted to headings: ${report.promotedHeadings}`);
    if (report.duplicates.length) {
      console.log("Near-duplicates dropped:");
      for (const d of report.duplicates) console.log(`  - ${d.file}  (kept: ${d.keptFile})`);
    }
    if (report.withoutH2.length) console.log(`No H2 headings found in: ${report.withoutH2.join(", ")}`);
    if (report.warnings.length) console.log(`Parser warnings: ${report.warnings.length}\n  ${report.warnings.slice(0, 10).join("\n  ")}`);
    if (report.failed.length) {
      console.error("Failed:");
      for (const f of report.failed) console.error(`  - ${f.file}: ${f.error}`);
      process.exitCode = 1;
    }
  });

const profile = program.command("profile").description("Build and inspect company style profiles");

profile
  .command("stats")
  .description("Measure the training articles (no LLM) and save data/profiles/<company>.stats.json")
  .requiredOption("--company <slug>", "company slug, e.g. protecto")
  .option("--brand <names>", "comma-separated brand/product names to count (default: the company slug)")
  .action((opts: { company: string; brand?: string }) => {
    const brandTerms = (opts.brand ?? opts.company).split(",").map((s) => s.trim()).filter(Boolean);
    const { perArticle, ...stats } = buildCorpusStats(opts.company, brandTerms);
    const file = saveCorpusStats(stats);
    const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2));
    console.log(`${stats.articleCount} training articles · brand terms: ${brandTerms.join(", ")}\n`);
    console.table(
      Object.fromEntries(
        Object.entries(stats.distributions.numeric).map(([k, b]) => [k, { p10: fmt(b.p10), median: fmt(b.median), p90: fmt(b.p90) }]),
      ),
    );
    console.log("Share of articles with:", Object.entries(stats.distributions.rates).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(" · "));
    console.log(`\nSignature terms: ${stats.signatureTerms.slice(0, 25).map((t) => t.term).join(", ")}`);
    console.log(`AI-isms in the human corpus: ${stats.aiIsms.map((a) => `${a.phrase} (${a.articles}/${stats.articleCount})`).join(", ") || "none"}`);
    console.log(`\nSaved ${path.relative(process.cwd(), file)} (${perArticle.length} articles measured)`);
  });

program
  .command("cost")
  .description("Show logged LLM usage and cost, plus the remaining AI Gateway credit")
  .action(async () => {
    const rows = getDb()
      .select({
        stage: llmCalls.stage,
        model: llmCalls.model,
        calls: sql<number>`count(*)`,
        errors: sql<number>`sum(case when ${llmCalls.status} = 'error' then 1 else 0 end)`,
        inputTokens: sql<number>`coalesce(sum(${llmCalls.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${llmCalls.outputTokens}), 0)`,
        costUsd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`,
      })
      .from(llmCalls)
      .groupBy(llmCalls.stage, llmCalls.model)
      .all();
    console.table(rows.map((r) => ({ ...r, costUsd: usd(r.costUsd) })));
    console.log(`Total logged cost: ${usd(rows.reduce((sum, r) => sum + r.costUsd, 0))}`);

    if (getConfig().AI_GATEWAY_API_KEY) {
      try {
        const credits = await gateway.getCredits();
        console.log(`AI Gateway credit balance: $${credits.balance} (total used: $${credits.totalUsed})`);
      } catch (error) {
        console.warn(`Could not read gateway credits: ${error instanceof Error ? error.message : error}`);
      }
    }
  });

program.parseAsync().catch((error) => {
  console.error(error);
  process.exit(1);
});

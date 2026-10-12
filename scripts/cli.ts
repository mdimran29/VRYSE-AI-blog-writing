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
import { buildProfile } from "@/lib/analysis/profile";
import { buildIndex, loadIndex } from "@/lib/retrieval/store";
import { search, selectExcerpts } from "@/lib/retrieval/search";
import type { ChunkRole } from "@/lib/retrieval/chunks";
import { runGeneration } from "@/lib/pipeline";
import fs from "node:fs";
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

profile
  .command("build")
  .description("Build the full style profile: statistics + per-article LLM analysis + synthesis → data/profiles/<company>.json")
  .requiredOption("--company <slug>", "company slug, e.g. routematic")
  .option("--brand <names>", "comma-separated brand/product names to count (default: the company slug)")
  .action(async (opts: { company: string; brand?: string }) => {
    const brandTerms = (opts.brand ?? opts.company).split(",").map((s) => s.trim()).filter(Boolean);
    const { profile: p, file, costUsd, failures } = await buildProfile({
      company: opts.company,
      brandTerms,
      onProgress: ({ done, total, failed }) => process.stdout.write(`\rAnalysing articles: ${done}/${total}${failed ? ` (${failed} failed)` : ""}`),
    });
    process.stdout.write("\n");
    for (const f of failures) console.warn(`  ✗ ${f.id}: ${f.error}`);
    const g = p.guide;
    console.log(`\nProfile v${p.version} for ${p.company} — ${p.corpus.extractedArticles}/${p.corpus.articleCount} articles analysed`);
    console.log(`Summary: ${g.summary}`);
    console.log(`Tone: ${g.voice.tone.join(", ")} · POV: ${g.voice.pointOfView}`);
    console.log(`Typical outline: ${g.structure.typicalOutline.join(" → ")}`);
    console.log(`Intro patterns: ${g.structure.introPatterns.map((x) => `${x.pattern} (${x.articles})`).join(" | ")}`);
    console.log(`Rules: ${g.rules.do.length} do, ${g.rules.dont.length} don't · avoid phrases: ${p.avoidPhrases.length}`);
    console.log(`Saved ${path.relative(process.cwd(), file)} · cost $${costUsd.toFixed(4)}`);

    const index = await buildIndex(opts.company);
    console.log(`Retrieval index: ${index.chunks.length} chunks (${index.model}, local, $0)`);
  });

const indexCmd = program.command("index").description("Retrieval index of reference article sections");

indexCmd
  .command("build")
  .description("Chunk and embed the training articles locally → data/index/<company>.json")
  .requiredOption("--company <slug>", "company slug")
  .action(async (opts: { company: string }) => {
    const started = Date.now();
    const index = await buildIndex(opts.company);
    const roles = index.chunks.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.role]: (acc[c.role] ?? 0) + 1 }), {});
    console.log(`${index.chunks.length} chunks · ${index.dims} dims · ${index.model} · ${((Date.now() - started) / 1000).toFixed(1)} s`);
    console.log(`By role: ${Object.entries(roles).map(([r, n]) => `${r} ${n}`).join(" · ")}`);
  });

program
  .command("search")
  .description("Hybrid (embedding + BM25) search over reference sections")
  .requiredOption("--company <slug>", "company slug")
  .requiredOption("--query <text>", "free-text query")
  .option("--roles <roles>", "comma-separated roles: intro,takeaways,body,conclusion,faq")
  .option("-k <n>", "results", "5")
  .action(async (opts: { company: string; query: string; roles?: string; k: string }) => {
    const roles = opts.roles?.split(",").map((r) => r.trim() as ChunkRole);
    const results = await search(loadIndex(opts.company), opts.query, { roles, k: Number(opts.k) });
    for (const { chunk, score } of results) {
      console.log(`${score.toFixed(3)}  [${chunk.role}] ${chunk.articleTitle} › ${chunk.heading ?? "(intro)"}  (${chunk.words} words)`);
    }
  });

program
  .command("excerpts")
  .description("Show the voice exemplars the writer would get for a brief")
  .requiredOption("--company <slug>", "company slug")
  .requiredOption("--topic <text>", "article topic")
  .option("--points <list>", "key points, separated by |")
  .option("--max-tokens <n>", "excerpt budget", "2500")
  .action(async (opts: { company: string; topic: string; points?: string; maxTokens: string }) => {
    const ex = await selectExcerpts(
      loadIndex(opts.company),
      { topic: opts.topic, keyPoints: opts.points?.split("|").map((s) => s.trim()) },
      { maxTokens: Number(opts.maxTokens) },
    );
    console.log("Closest articles:");
    for (const a of ex.articles) console.log(`  ${a.score.toFixed(3)}  ${a.title}`);
    const show = (label: string, c: { articleTitle: string; heading: string | null; words: number } | null) =>
      console.log(`${label.padEnd(11)} ${c ? `${c.articleTitle} › ${c.heading ?? "(intro)"} (${c.words} words)` : "—"}`);
    show("Intro:", ex.intro);
    show("Conclusion:", ex.conclusion);
    ex.body.forEach((c, i) => show(`Body ${i + 1}:`, c));
    console.log(`Excerpt budget used: ~${ex.tokens}/${opts.maxTokens} tokens`);
  });

program
  .command("generate")
  .description("Generate an article from a brief JSON file (retrieve → plan → write → lint → repair)")
  .requiredOption("--brief <file>", "path to a brief .json (see examples/briefs/)")
  .action(async (opts: { brief: string }) => {
    const input = JSON.parse(fs.readFileSync(opts.brief, "utf8"));
    const started = Date.now();
    const result = await runGeneration(input, (e) => {
      const t = ((Date.now() - started) / 1000).toFixed(1).padStart(5);
      console.log(`${t}s  ${e.stage.padEnd(8)} ${e.status}${e.detail ? `  ${e.detail}` : ""}`);
    });
    const { lint, outline } = result;
    console.log(`\n"${outline.title}"`);
    console.log(`${lint.metrics.words} words (target ${result.brief.targetWords}) · ${lint.metrics.h2Count} H2 · ${lint.metrics.faqQuestions} FAQ questions${result.repaired ? " · repaired once" : ""}`);
    for (const issue of lint.issues) console.log(`  ${issue.severity === "hard" ? "✗" : "·"} [${issue.code}] ${issue.message}`);
    console.log(`Run ${result.runId} · cost $${result.costUsd.toFixed(4)}\nSaved ${path.relative(process.cwd(), result.files.markdown)}`);
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

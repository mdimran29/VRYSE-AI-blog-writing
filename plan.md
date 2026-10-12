# Build Plan — VRYSE AI Blog Writing System

**Stack:** Next.js (App Router) · TypeScript · Vercel AI SDK through the AI Gateway (free $5 credit every 30 days) · Zod · SQLite + Drizzle · shadcn/ui · Vitest

This is a step-by-step plan to finish the take-home in **3 days**. Each step lists its tasks, the files it produces, and a **Done when** check. Don't move on until the check passes.

Priority order, taken from the brief: **Functional → Measurable → Iterative → Explainable.** If time runs short, cut the items marked *(stretch)* first.

Reference documents: [ARCHITECTURE.md](ARCHITECTURE.md) · [README.md](README.md)

---

## Overview

**Progress (2026-10-12):** ✅ Step 0 · ✅ Step 1 · ✅ Step 2 · ✅ Step 3 · ✅ Step 4 · ✅ Step 5 · ⏭ next: Step 6. **Client: Routematic.** VRYSE confirmed that any client's articles may be used, and the Protecto docs were access-restricted (see Step 2).

| Day | Focus | Milestone at end of day |
|---|---|---|
| **Day 1** | Scaffold, data, parsing, analysis | `data/profiles/routematic.json` exists and looks right |
| **Day 2** | Retrieval, generation, evaluation, calibration | CLI generates and scores an article; the calibration table is filled in |
| **Day 3** | Feedback loop, UI, demo, docs | Full loop works in the UI; the before/after example and README are complete |

### Budget rules (to stay inside the free $5)

- The defaults (Gemini 2.5 Flash-Lite, GPT-5 mini, Gemini 2.5 Flash) are all on the gateway free tier and put the whole project at roughly $1–2. Claude and Gemini 3.x models are blocked on the free tier. Run `pnpm vryse ping` after changing a model.
- Keep `VRYSE_DEV_CACHE=true`, so that rerunning an unchanged step costs nothing.
- Check total cost per run on the Observability page, or with `pnpm vryse cost`, at the end of each day.

---

## Day 1 — Scaffold, data and analysis

### Step 0 — Inspect the data (30 min) ✅

- [x] Open the `Protecto` tab in the client sheet. Columns: Page (title), Type, Assigned to, Assigned date, Timeline, Completed date, Status, Doc link, URL (published post), Protecto Keywords. 70 rows: 63 "Doc Ready", 3 WIP, 3 Assigned.
- [x] Confirm what the cells contain: **links to Google Docs**. The 63 doc links were extracted from the sheet into `data/raw/sheet/protecto_docs.tsv`. The docs are **private** (export returns 401, and the connected Drive account can't see them), so access was requested from VRYSE.
- [x] Decide how to fetch the articles: **manual download**. `data/raw/sheet/download_links.html` has one-click `.docx` export links for all 63.
- [x] Inspect the articles by hand. Done on the Routematic docs: real heading styles (no bold-only headings), an FAQ section in every doc, 1,000–4,500 words, the brand named in the body and in comparison tables, and Grammarly report screenshots pasted at the end of some docs.
- [x] Filter out unfinished rows: only the 63 "Doc Ready" rows are in the download list.

**Done when** you know the exact column layout and have at least 3 sample `.docx` files on disk. ✅ (61 Routematic docs on disk.)

### Step 1 — Project scaffold (1 h) ✅

- [x] `create-next-app` (Next.js 16.4, TypeScript, Tailwind, App Router, `src/`), on Node 24.18. pnpm 12 enabled through corepack.
- [ ] `pnpm dlx shadcn@latest init` and the components. **Deferred to Step 10**, where the UI is built.
- [x] Dependencies: `ai zod mammoth node-html-parser syllable @huggingface/transformers better-sqlite3 drizzle-orm react-markdown remark-gfm diff commander p-limit dotenv`. Native builds are allowed in `pnpm-workspace.yaml`.
- [x] Dev dependencies: `drizzle-kit tsx vitest @types/better-sqlite3 @types/node@24`. `@types/diff` isn't needed because `diff` v9 ships its own types.
- [x] Optional providers for the fully free modes: loaded lazily in `models.ts` only when a `google-direct/` or `ollama/` model is configured, so nothing needs installing yet.
- [x] `serverExternalPackages: ["better-sqlite3", "@huggingface/transformers"]` in `next.config.ts`.
- [x] Scripts in `package.json`: `vryse`, `test`, `typecheck`, `db:generate`. There's no `db:migrate`, because migrations apply automatically when the DB opens.
- [x] `src/lib/config.ts`: the environment is read through a Zod schema; empty values fall back to the defaults.
- [x] `src/lib/db/schema.ts`: Drizzle tables for articles, profiles, runs, iterations, evaluations, feedback, memory and llm_calls. Initial migration in `drizzle/0000_init.sql`.
- [x] `src/lib/llm/models.ts`: plain `provider/model` goes through the gateway, `google-direct/…` to `@ai-sdk/google`, `ollama/…` to Ollama.
- [x] `src/lib/llm/call.ts`: `callObject` / `callText`, written against the bundled AI SDK 7 docs (`generateText` + `Output.object`, `instructions`).
  - Zod-validated output, with one retry that includes the validation error.
  - The SDK's own backoff (`maxRetries: 4`) and a global `p-limit(VRYSE_LLM_CONCURRENCY)`.
  - A dev cache keyed by a sha256 of (model, instructions, prompt, JSON schema, settings).
  - Logs every call to `llm_calls`. Cost comes from the gateway's reported cost, with list prices as a fallback.
- [x] `.env.example`, `.env.local`, `.gitignore` and `git init` (branch `main`, nothing committed yet).
- [x] Extra: `pnpm vryse cost` shows logged spend and the remaining gateway credit.

**Done when** `pnpm vryse ping` makes a structured-output call through the gateway, and that call shows up in `llm_calls` with its token count and cost. ✅ All three roles answered. The free tier blocks every Claude model and Gemini 3.x, so the defaults were changed to Gemini 2.5 Flash-Lite, GPT-5 mini and Gemini 2.5 Flash.

### Step 2 — Ingestion and parsing (2 h) ✅

> **Data decision (2026-10-12):** the 63 Protecto Google Docs named in the brief are private. VRYSE confirmed that **any client's articles may be used**, so the project uses the 61 **Routematic** docs from the same sheet (employee transport, India). They're real human-written Word docs from the same agency.

- [x] `src/lib/schemas/article.ts`: a Zod `Article` with blocks for heading, paragraph, list, table and quote. Inline text keeps bold and links as markdown.
- [x] `src/lib/ingest/docx.ts`:
  - `mammoth.convertToHtml`, with images dropped before conversion. The docs use real heading styles, so no style map was needed.
  - `htmlToBlocks` walks the HTML with `node-html-parser`.
  - Bold-only heading heuristic, applied **only when a doc has fewer than 2 real H2s**, so docs with proper styles aren't affected.
  - Removes editorial clutter ("Grammarly Report" labels and screenshots) and captures "Meta Title / Meta Description / URL Slug" lines as metadata.
  - Collects mammoth's warnings into the ingest report.
- [x] `src/lib/ingest/markdown.ts` (planned as `normalize.ts`): blocks → GFM markdown. Smart quotes and whitespace are normalised during parsing.
- [ ] `src/lib/ingest/sheet.ts` *(only if using the Google API)*: not needed; the docs are downloaded by hand.
- [x] `pnpm vryse ingest --company <c> --from-dir …` writes the articles to the DB and to `data/processed/<c>/*.{json,md}`. It also **drops near-duplicates** (5-word-shingle Jaccard ≥ 0.5, keeping a "Revised" copy first, then the longer one).
- [x] **Split the data:** a seeded hash holds out 10% as the test set.
- [x] Vitest: HTML-fixture tests for `htmlToBlocks` (mammoth's output is the contract, so no `.docx` fixtures are committed), plus markdown, dedupe and split tests.

**Result on Routematic:** 61 files, 60 kept (one older version of a "Revised" doc dropped), 54 train / 6 test. 21 editorial labels removed. Every real H1–H3 matched the raw docx; the 7 count differences were all empty bookmark-only headings, which are dropped on purpose. Articles run 1,001–4,475 words (median 1,558), all 60 have an FAQ section, and 31 have tables.

**Done when** every article is parsed, and spot-checking 5 Markdown outputs against the originals shows the correct heading hierarchy.

### Step 3 — Deterministic features (1.5 h) ✅

- [x] `src/lib/analysis/text.ts`: sentence and word splitting with `Intl.Segmenter`.
- [x] `src/lib/analysis/readability.ts`: Flesch Reading Ease and Flesch-Kincaid grade, using `syllable`. Tested against hand-computed values for "The cat sat on the mat." (FRE 116.145, grade −1.45).
- [x] `src/lib/analysis/metrics.ts`: `extractFeatures(blocks, {brandTerms})` returns 37 features: length, structure (heading counts and styles, lists, tables, FAQ, key takeaways, conclusion), intro and closing length plus CTA, paragraph and sentence stats, readability, and lexical rates per 1,000 words (you/we, brand mentions, numbers, links, bold, AI-isms). The **FAQ is found at any heading level** and measured separately, so its question headings don't skew the heading-style rates or the closing section.
- [x] `src/lib/analysis/ai-isms.ts`: 23 phrase patterns, whole-word, with inflections.
- [x] `src/lib/analysis/terms.ts`: signature terms. No general-English frequency list was available, so terms are ranked by **document share × log(count)**, with a stopword list, a minimum of 2 articles, and a 1.5× boost for bigrams. The result is the vocabulary the company uses *consistently*.
- [x] `src/lib/analysis/aggregate.ts`: p10/p25/median/p75/p90/mean for numeric features (linear interpolation, the same as numpy) and rates for boolean features.
- [x] `src/lib/analysis/stats.ts` + `pnpm vryse profile stats --company <c> [--brand <names>]`: measures the **train split only** and saves `data/profiles/<c>.stats.json`.
- [x] Vitest: a hand-written article with known answers, the nested-FAQ case, percentiles, rates, signature terms, AI-isms and readability. 65 tests in total.

**Done when** `pnpm vryse profile stats --company routematic` prints a sensible table. ✅ On Routematic (54 training articles): median 1,468 words, 7 H2s, about 33 words per paragraph and 15 per sentence, FK grade 13.9. FAQ in 100%, conclusion heading in 63%, key takeaways in 28%. AI-isms are rare in the human writing ("seamless" appears in 8 of 54 articles), which makes them a useful signal for spotting generic AI output. 

### Step 4 — LLM extraction and profile synthesis (2 h) ✅

- [x] `src/lib/schemas/profile.ts`: Zod schemas for `ArticleTraits` (13 fields), `StyleGuide` (voice, structure with counted intro/conclusion/CTA patterns, content, vocabulary, formatting, do/don't rules) and the `CompanyStyleProfile` type. **Every field is required**, because OpenAI's strict structured output rejects schemas with optional fields (the first synthesis run failed on exactly this).
- [x] `src/lib/analysis/extract.ts`: `extractTraits`, one Gemini 2.5 Flash-Lite call per article at temperature 0, run concurrently through the shared limiter. It's **always cached** (keyed by article and prompt), so rebuilding the profile only pays for synthesis.
- [x] `synthesizeGuide`: one GPT-5 mini call over all 54 trait sets plus a compact stats summary. It counts how many articles show each pattern and outputs concrete do/don't rules.
- [x] `src/lib/analysis/profile.ts` + `pnpm vryse profile build --company <c> --brand <names>`:
  - Numeric bands come straight from Step 3.
  - **Section order is measured in code** (`sectionOrder` in `metrics.ts`): where Key Takeaways, the Conclusion and the FAQ sit. The first synthesis got the outline order wrong, putting Key Takeaways and the FAQ before the Conclusion. With the measured order in the prompt, it now matches the corpus.
  - `avoidPhrases` is deterministic: known AI-isms that appear in fewer than 10% of the human articles. "seamless" (15%) is kept as part of the house style.
  - Writes `data/profiles/<c>.json` (versioned, with corpus provenance and model names) and a row in the `profiles` table. The per-article traits go to the git-ignored `data/processed/<c>/traits.json`, because they paraphrase client content.
- [x] Read the profile. It's specific to Routematic: Indian/British spelling and ₹, intros of about 120–140 words that end with "what this article covers", internal metrics labelled as such, external statistics hyperlinked, FAQ always last, CTAs only at the end (21/54 articles have one, 32 have none).
- [x] Vitest: `avoidPhrases`, `statsDigest`, `sectionOrder`, and mock-model tests that check the article text and every trait set reach the prompts. 70 tests in total.

**Done when** the profile is committed and you would accept it as a style guide for a human writer. ✅ **Day 1 milestone.** Profile v2, 54/54 articles analysed, about $0.03 per build (the second build reused the cached traits).

---

## Day 2 — Generation and evaluation

### Step 5 — Retrieval (1 h) ✅

- [x] `src/lib/retrieval/embed.ts`: a lazy singleton `feature-extraction` pipeline (`Xenova/bge-small-en-v1.5`, transformers.js 4.3, fp32), run locally and free. It uses **CLS pooling and the BGE query instruction prefix**, as the model card recommends (not mean pooling). The model downloads once (about 128 MB) into the git-ignored `data/.models/`.
- [x] `src/lib/retrieval/chunks.ts`: each article becomes an intro chunk plus one chunk per H2, tagged `intro | takeaways | body | conclusion | faq`. An FAQ at any heading level gets its own chunk, and the last content section becomes the conclusion when none is named. The text that gets embedded is title + heading + the first 300 words (BGE's input limit).
- [x] `src/lib/retrieval/store.ts` (planned as `index.ts`): `buildIndex` embeds the **train split only** (held-out test articles are never retrievable) and saves `data/index/<c>.json`, with vectors as base64 Float32. The file is git-ignored because it contains client text. `pnpm vryse profile build` also rebuilds the index.
- [x] `src/lib/retrieval/bm25.ts`: Okapi BM25 (k1 = 1.2, b = 0.75) with stopwords removed.
- [x] `src/lib/retrieval/search.ts`: `search` combines cosine and BM25, each **min-max normalised per query**, weighted **0.7 / 0.3**. The weight was chosen by measurement: at 0.8 / 0.2 a keyword query ("monsoon flooding rerouting") put the only two sections that mention monsoons at #9 and #11. At 0.7 the first one is #2, and three semantic briefs still put a relevant section first. 0.6 and below started to hurt the semantic briefs.
- [x] `selectExcerpts` returns the intro of the top article, the conclusion of the best-ranked article that has one, and two body sections **from different articles** (by outline heading when an outline exists). The `faq` and `takeaways` roles are never used as body excerpts. The total is capped at 2,500 tokens, truncating at block boundaries.
- [x] CLI: `pnpm vryse index build`, `pnpm vryse search --query … [--roles …]`, `pnpm vryse excerpts --topic … --points "a|b"`.
- [x] Vitest: chunk roles (including a nested FAQ and an implicit conclusion), BM25 (idf, length normalisation, stopwords), hybrid normalisation, truncation, and `selectExcerpts` on a hand-built index (diversity, role exclusions, conclusion fallback, token budget). 86 tests in total.
- [x] Quick check with three briefs on topics no single article covers:
  - **EV fleet:** a sustainable-commuting intro and conclusion, plus ESG and sustainability sections.
  - **Women's night-shift safety:** the night-shift article, plus a women's-safety compliance section from a different article.
  - **Monsoon disruption:** the only two sections in the corpus that mention monsoons or flooding.

**Done when** the excerpts for a test brief are clearly on-topic. ✅ Index: 457 chunks from 54 training articles, built in about 60 s on CPU, $0. Excerpt sets use about 800–1,000 of the 2,500-token budget.

### Step 6 — Planner and writer (2.5 h)

- [ ] `src/lib/schemas/brief.ts`: a `Brief` schema with these fields: company, topic, audience, targetWords, keyPoints[], requiredSections[], toneOverride?, notes.
- [ ] `src/lib/generation/planner.ts`: a structured-output call that returns an `Outline`. Every key point must map to a section, and the section count must fall within the profile band.
- [ ] `src/lib/generation/writer.ts`: takes the outline, the profile's voice, style and vocabulary, the excerpts and memory, and returns Markdown. Use a prompt order that makes caching work: stable system prompt, then profile, then excerpts, then outline and brief.
- [ ] `src/lib/generation/lint.ts`: check word count, heading count, AI-ism hits, n-gram overlap with references (flag 8-gram overlaps), and required sections. Make **one** repair call if a hard constraint fails.
- [ ] Keep the prompts in `src/lib/generation/prompts/*.md` and load them with `fs` at runtime, so they're versioned and easy to read.
- [ ] `src/lib/pipeline.ts`: `runGeneration(brief, onEvent)` chains retrieve → plan → write → lint → evaluate and emits stage events. The CLI and the API route both use it.
- [ ] `pnpm vryse generate --brief examples/briefs/<x>.json` saves a run and iteration 1.
- [ ] Write 3 example briefs, such as moving an employee fleet to EVs, transport for a new office in Hyderabad, and handling monsoon disruption in commute operations. Base them on topics that *aren't* already in the corpus.

**Done when** the generated article reads like a Routematic post when you compare it side by side with a real one.

### Step 7 — Evaluator (3 h)

- [ ] `src/lib/schemas/evaluation.ts`: `JudgeResult`, `DimensionScore` and `Evaluation`.
- [ ] `src/lib/evaluation/deterministic.ts`: band scoring (ARCHITECTURE.md §3.5), with per-feature scores rolled up into dimensions.
- [ ] `src/lib/evaluation/judge.ts`: a judge-model call (Gemini 2.5 Flash) with an anchored 1–5 rubric for each dimension. Each score needs at least one evidence quote. Run at temperature 0, and hide the version label. It also returns:
  - coverage of each key point (covered / partial / missing, with a quote);
  - generic passages;
  - strengths, weaknesses and recommendations, each with a target.
- [ ] `src/lib/evaluation/scoring.ts`: combine the scores per dimension, apply the weights to get the overall score, and apply the required-section cap.
- [ ] Run the deterministic part and the judge **in parallel** with `Promise.all`.
- [ ] `src/lib/evaluation/pairwise.ts`: a comparison of version A and version B with their order randomised. It returns the winner, a confidence and the reasons.
- [ ] Vitest for band scoring, weighting and the cap. These are pure functions, so they're quick to test.

**Done when** `pnpm vryse evaluate --iteration <id>` produces a full report.

### Step 8 — Calibration and noise (1.5 h)

This step is what makes the evaluation credible, so don't skip it. Use the same writer model you will use for the demo.

- [ ] **Noise:** run the judge 3 times on the same article and record the standard deviation of the overall score. Set the noise threshold to about 2σ, then put the value in the README and in the config.
- [ ] **Calibration:** `pnpm vryse calibrate` scores three sets:
  1. the held-out human articles;
  2. generic baselines: the same topics written with **no profile and no retrieval**;
  3. VRYSE v1 for the same topics.
- [ ] The expected ordering is human ≥ VRYSE > generic. If generic scores close to human, the metrics don't discriminate, so fix the weights or the features before going further.
- [ ] Fill in the calibration table in the README. Expected cost is about $1.40.

**Done when** the evaluator clearly separates human from generic, and the table is in the README. ✅ **Day 2 milestone.**

---

## Day 3 — Feedback loop, UI, demo

### Step 9 — Feedback compiler, reviser and memory (2.5 h)

- [ ] `src/lib/schemas/instruction.ts`: the `RevisionInstruction` schema (ARCHITECTURE.md §3.6).
- [ ] `src/lib/feedback/compile.ts`: takes the human feedback (rating, free text and optional section notes) and the evaluator recommendations the reviewer ticked. An analysis-model call returns `RevisionInstruction[]`, and each instruction carries an `acceptanceCheck`.
- [ ] `src/lib/generation/reviser.ts`: takes the previous draft and the instructions and returns the new draft. **Sections that no instruction targets must stay the same.** Check this afterwards by diffing the untouched sections.
- [ ] A "Regenerate from outline" mode for structural feedback: rerun the planner with the instructions added, then rerun the writer.
- [ ] `src/lib/evaluation/verify.ts`: the judge checks each `acceptanceCheck` against the new draft and returns ✓ or ✗ with evidence.
- [ ] `improvementVerdict(prevEval, newEval, verification)` returns Improved, Mixed or Regressed, using the rules in ARCHITECTURE.md §3.5.
- [ ] `src/lib/feedback/memory.ts`: instructions marked `persist` go into the memory table and are added to the planner and writer prompts.
- [ ] `src/lib/pipeline.ts`: `runRevision(iterationId, instructions, mode, onEvent)`.

**Done when** one full CLI cycle (generate → evaluate → feedback → revise → re-evaluate) produces a verdict and the ✓/✗ checklist.

### Step 10 — Next.js UI (3.5 h)

- [ ] **API routes (Node.js runtime):**
  - `POST /api/runs`: validates the brief with Zod, calls `runGeneration`, and returns a `ReadableStream` of NDJSON stage events.
  - `POST /api/runs/[id]/revise`: the same, calling `runRevision`.
- [ ] **Server Actions:** `saveFeedback`, `compileFeedback` (returns the instructions to edit), `approveIteration` and `deleteMemory`.
- [ ] **`/company/[slug]`:** a corpus summary and the profile shown as cards (structure bands, voice, vocabulary, do/don'ts), plus a Rebuild button.
- [ ] **`/articles/new`:** the brief form, using shadcn Form with Zod. On submit it reads the stream and shows a stage checklist (retrieve → plan → write → lint → evaluate), then redirects to the run.
- [ ] **`/runs/[id]`:**
  - the article rendered with `react-markdown` and `remark-gfm`;
  - a score panel with the overall score and a Progress bar per dimension;
  - Tabs for weaknesses, generic passages, missing points and recommendations;
  - a feedback form (rating, text, recommendation checkboxes) → **Compile** → an editable instruction table → **Revise**;
  - an iteration history list (v1, v2… and their scores).
- [ ] **`/runs/[id]/compare`:** two columns with a word-level diff from `diffWords` (additions in green, removals in red), a table of score deltas, the instruction checklist, the pairwise verdict and the improvement badge.
- [ ] **`/memory`:** list and delete entries.
- [ ] **`/observability`** *(stretch)*: a table of `llm_calls` with totals for tokens, cost and latency per run and per stage.

**Done when** someone who has never seen the project can run the whole loop in the UI without help.

### Step 11 — Before/after demo (1 h)

- [ ] Optionally switch the writer to `openai/gpt-5` or `openai/gpt-4.1` for extra polish, then run `pnpm vryse ping`. Choose one of the example briefs, generate v1 and read the evaluation.
- [ ] Write **realistic** feedback that targets real weaknesses, for example: "intro is generic, open with a concrete commute problem; too many product mentions; add a comparison table like other Routematic posts; the cost section needs a worked example".
- [ ] Revise to v2 and re-evaluate. If v2 isn't *Improved*, report that honestly and explain why. That still shows engineering judgment.
- [ ] *(Stretch)* Do a second cycle to get v3 and show the trend.
- [ ] `pnpm vryse export --run <id> --out examples/before_after/` exports the brief, v1.md, eval-v1.json, feedback, instructions, v2.md, eval-v2.json, a diff and the cost.
- [ ] Take screenshots of the Review and Compare pages for the README.
- [ ] Fill in README §10 using the real numbers.

**Done when** the README contains a complete before/after with score deltas taken from the real run.

### Step 12 — Documentation and polish (1.5 h)

- [ ] Fill in every _TBD_ in the README: the calibration table, the noise threshold, the before/after section, and the measured cost and latency per article.
- [ ] Update ARCHITECTURE.md wherever the implementation ended up different from the plan.
- [ ] Review the Known limitations section. Add anything real you ran into, such as heading heuristics that failed or judge disagreements.
- [ ] Test a clean install: clone into a new folder, run `pnpm install`, then follow the README word for word.
- [ ] Run `pnpm typecheck`, `pnpm lint` and `pnpm test`. All must pass.
- [ ] *(Optional)* Record a 2–3 minute screen capture of the full loop.

**Done when** the submission checklist below is fully ticked.

---

## Submission checklist (from the brief, §12)

- [ ] Working application
- [ ] Source code
- [ ] Reference document processing — Step 2
- [ ] Content and format analysis — Steps 3–4
- [ ] Article generation — Steps 5–6
- [ ] Quality evaluation — Step 7
- [ ] Quantitative performance indicators — Steps 7–8
- [ ] Human feedback mechanism — Steps 9–10
- [ ] Regeneration based on feedback — Step 9
- [ ] Before/after improvement example — Step 11
- [ ] Architecture documentation — ARCHITECTURE.md
- [ ] README
- [ ] Setup and run instructions
- [ ] Design decisions
- [ ] Evaluation methodology
- [ ] Known limitations
- [ ] Potential future improvements

---

## Risks and fallbacks

| Risk | Fallback |
|---|---|
| The Google Docs can't be accessed through the API | Download the `.docx` files manually (Step 0) |
| The docs use bold text instead of heading styles | Heading heuristic plus a manual spot check. Record the error rate in Limitations |
| The free credit runs out | Keep the dev cache on, use `openai/gpt-5-nano` or `openai/gpt-4.1-mini` as a cheaper writer, and shrink calibration to 5 topics. As a last resort, switch to `google-direct/` on the Gemini free tier |
| A model gets blocked on the gateway free tier ("Free tier users do not have access") | Pick another free-tier model; the probe results in ARCHITECTURE.md §3.8 list working alternatives. `pnpm vryse ping` confirms |
| Free-tier rate limits (429s) | `VRYSE_LLM_CONCURRENCY=1`, plus the wrapper's backoff |
| transformers.js or better-sqlite3 fails to bundle in Next.js | Check that both are in `serverExternalPackages` and that the route uses the Node.js runtime. If it still fails, build the index in the CLI only and embed queries the same way |
| AI SDK API differs from what you expect | Read `node_modules/ai/docs/` for the installed version. Don't rely on examples from memory |
| The judge is too noisy, so the before/after delta falls inside the noise | Average 3 judge runs for the demo evaluations (cheap with Gemini 2.5 Flash), and rely on the pairwise verdict and instruction verification |
| Generic baseline scores close to human in calibration | Give more weight to the deterministic style features and AI-ism hits, and add an embedding classifier for company vs generic |
| Running short on time on Day 3 | Drop the Observability page, the v3 cycle and the regenerate-from-outline mode. Keep the core loop and the demo |

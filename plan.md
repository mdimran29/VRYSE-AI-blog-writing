# Build Plan — VRYSE AI Blog Writing System

**Stack:** Next.js (App Router) · TypeScript · Vercel AI SDK through the AI Gateway (free $5 credit every 30 days) · Zod · SQLite + Drizzle · shadcn/ui · Vitest

This is a step-by-step plan to finish the take-home in **3 days**. Each step lists its tasks, the files it produces, and a **Done when** check. Don't move on until the check passes.

Priority order, taken from the brief: **Functional → Measurable → Iterative → Explainable.** If time runs short, cut the items marked *(stretch)* first.

Reference documents: [ARCHITECTURE.md](ARCHITECTURE.md) · [README.md](README.md)

---

## Overview

**Progress (2026-10-12):** ✅ Step 0 · ✅ Step 1 · ✅ Step 2 · ✅ Step 3 · ✅ Step 4 · ✅ Step 5 · ✅ Step 6 · ✅ Step 7 · ✅ Step 8 · ✅ Step 9 · ✅ Step 10 · ⏭ next: Step 11. **Client: Routematic.** VRYSE confirmed that any client's articles may be used, and the Protecto docs were access-restricted (see Step 2).

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

### Step 6 — Planner and writer (2.5 h) ✅

- [x] `src/lib/schemas/generation.ts` (planned as `brief.ts`): `BriefSchema` (topic, audience, targetWords, primaryKeyword, keyPoints, requiredSections, toneOverride, notes; unset fields are filled from the profile by `resolveBrief`), plus `OutlineSchema` and `Issue`.
- [x] `src/lib/ingest/markdown.ts`: `markdownToBlocks`, so generated Markdown can be measured with the same 37 features as the reference articles.
- [x] `src/lib/generation/style-guide.ts`: `renderStyleGuide(profile)` turns the profile into prompt text: voice, measured section order, length and sentence targets, counted intro/conclusion/CTA patterns, vocabulary, and do/don't rules.
- [x] `src/lib/generation/planner.ts`: `planOutline` (GPT-5 mini, structured output) is shown the H2 outlines of the 3 closest reference articles. `checkOutline` then verifies in code that every key point is assigned, required sections exist, the FAQ has enough questions, the H2 count is within the house range, the conclusion is last, and the word budget is within ±20%. If anything fails, it re-plans **once** with the problems listed.
- [x] Retrieval runs twice: once by topic, to find the articles whose structure the planner sees, and once per planned body section, for the voice excerpts the writer sees.
- [x] `src/lib/generation/writer.ts`: `writeArticle` puts the stable house style in the instructions (cacheable) and the excerpts, allowed URLs, brief, memory and outline in the prompt. Truthfulness rules: only figures from the excerpts or the brief, and only URLs from the allowed list.
  - **Length calibration:** GPT-5 mini overshot the word budget by 29–38% in 4 out of 4 runs, even with an explicit "never more than" instruction, so every draft needed a repair call. The writer now gets budgets scaled by **0.78**. The next two drafts came in at +9% and +6% with no repair.
- [x] `src/lib/generation/lint.ts`: hard checks for exactly one H1, length within ±25%, FAQ present, required sections, **URLs not found in the corpus** (possibly invented) and **12-word passages copied** from the corpus. Soft checks for close paraphrase (8-word overlaps), avoid-phrases, H2 range, FAQ position and **figures found in neither the corpus nor the brief**. Hard issues trigger **one** `repairArticle` call, which is kept only if it reduces the hard issues.
- [x] Prompts live in `src/lib/generation/prompts/{planner,writer,repair}.md`, loaded by `loadPrompt` with `{{placeholders}}` (a missing value throws).
- [x] `src/lib/pipeline.ts`: `runGeneration(brief, onEvent)` runs retrieve → plan → retrieve per section → write → lint → (repair) → save. It saves a `runs` row and iteration 1, writes `data/runs/<runId>/v1.md`, `v1.outline.json` and `v1.lint.json` (git-ignored), and reports the run's cost. Evaluation is added in Step 7.
- [x] `pnpm vryse generate --brief examples/briefs/<x>.json`
- [x] 3 example briefs: `ev-fleet-transition`, `new-office-commute-plan` and `monsoon-commute-disruption`, on topics no single reference article covers.
- [x] Vitest: markdown parsing (including a round trip), style-guide rendering, brief resolution, every `checkOutline` rule, every lint rule, the unsupported-figure check, the writer prompt contents and the planner re-plan (mock models). 112 tests in total.

**Done when** the generated article reads like a Routematic post. ✅ All three briefs produced articles in the house shape: intro ending in "what this article covers" → Key Takeaways → keyword-led H2s with H3s → conclusion → a 5-question FAQ last, with British spelling. The one specific statistic used (2.3 million EV sales and 29,000 chargers) comes from the reference articles, and no URLs were invented. Each article took 26–40 s and cost $0.007–0.03. The figure check found a weakness the evaluator must cover: unsourced planning numbers ("a 15–30% range buffer", "70–85% occupancy") get through when the same number appears elsewhere in the corpus.

### Step 7 — Evaluator (3 h) ✅

- [x] `src/lib/schemas/evaluation.ts`: the 7 dimensions and weights, `JudgeSchema` (per-dimension score, reason and quoted evidence; key-point coverage; generic passages; **unsupported claims**; strengths; ranked weaknesses with a fix and target), `PairwiseSchema` and `Evaluation`.
- [x] `src/lib/evaluation/bands.ts`: `bandScore` gives 100 inside p10–p90 and falls linearly to 0 at one IQR outside, optionally one-sided. `lengthScore` gives 100 within ±10% and 0 at ±50%. `judgeToScore` maps 1–5 onto 0–100.
- [x] `src/lib/evaluation/measured.ts` (planned as `deterministic.ts`): the code-measured half of each dimension.
  - Structure: H2s, H3s per H2, intro and closing length, FAQ size, FAQ present, FAQ last.
  - Style: 10 rhythm and formatting features, plus **embedding closeness to the company centroid**.
  - Readability: reading grade and reading ease.
  - Specificity: numbers per 1k words, minus 10 points per **unsupported figure**.
  - Completeness: length and required sections.
  - Relevance: brief similarity compared with the references.
  - Any feature scoring below 60 becomes a measured weakness, with the house range and a fix.
- [x] `src/lib/evaluation/semantic.ts`: each article's vector is the mean of its non-FAQ chunks. Style closeness is cosine to the centroid, scored against how close the 54 references are. Relevance scores 100 when the article is at least as close to the brief as the 90th-percentile reference, and 0 at the median.
- [x] `src/lib/evaluation/judge.ts` + `src/lib/prompts/judge.md`: Gemini 2.5 Flash with an **anchored rubric** (what a 1, 3 and 5 look like for each dimension), the source passages the writer saw (to check claims), temperature 0, no version label, and **never cached**, so re-judging is a real call. Key-point coverage counts only the brief's own key points; the judge sometimes added required sections.
- [x] `comparePair` + `src/lib/prompts/pairwise.md` (planned as `pairwise.ts`): A/B order randomised and mapped back to first/second. It's ready for Step 9.
- [x] `src/lib/evaluation/scoring.ts`: blends the parts (judge share 0.5, completeness 0.6, tone 1.0), weights them into the overall score, caps it at 70 if a required section or the FAQ is missing, and rescales the weights if the judge fails.
- [x] `src/lib/evaluation/evaluate.ts`: lint, features, embeddings and the judge, with the embeddings and the judge **run in parallel**. Weaknesses from the judge, measurements and lint are merged and ranked by severity. If the judge fails, the measured scores are still returned.
- [x] The pipeline now evaluates every new draft (stage `evaluate`), saves it to the `evaluations` table and `data/runs/<id>/v1.eval.json`, and records the writer's excerpt ids so a later re-evaluation uses the same sources.
- [x] `pnpm vryse evaluate --run <id> [--version n]` (planned as `--iteration`). `generate` prints the scores too.
- [x] Vitest: band, length and judge mapping, the combine/cap/fallback logic, measured scores and weaknesses, embedding geometry, judge and pairwise prompts (including the A/B mapping), and evaluation with the judge failing. 135 tests in total.

**Done when** `pnpm vryse evaluate` produces a full report. ✅ EV article: **78.4/100**. Structure 88, style 54, relevance 100, completeness 100, tone 50, readability 88, specificity 63. Measured weaknesses: paragraphs average 14 words (house 25–49), 93% one-sentence paragraphs (house 10–60%), 41 bold phrases per 1k words (house 3–17), no links (house 2.8–6.3). The judge's main criticism was claims without sourced evidence, with 7 quoted. Cost is about $0.027 per evaluation, mostly the judge's thinking tokens.

> ⚠ **Judge noise is larger than the plan assumed.** Re-judging the *same* article gave 84.7 instead of 78.4: tone went from 3/5 to 5/5 and specificity from 2/5 to 3/5, while the measured parts didn't change. The plan assumed about ±3. **Step 8 must measure this properly**, and the improvement verdict will probably need the mean of several judge runs.

### Step 8 — Calibration and noise (1.5 h) ✅

- [x] **Noise:** `pnpm vryse noise --run <id> --times 5` scores one saved draft 5 times without saving the scores. The measured half was identical every time, so all the variance is the judge's.

  | Judge | σ (single run) | Decision |
  |---|---|---|
  | Gemini 2.5 Flash, thinking on | 4.6 / 5.5 | Too noisy (a +13 threshold) |
  | **Gemini 2.5 Flash, thinking off** | **1.6 / 0.0** | **Chosen**: still critical, cheaper |
  | Mistral Large 3 | 0.6 | Rejected: lenient (specificity 5/5 despite quoted unsupported claims) |

  - New settings: `VRYSE_JUDGE_THINKING_BUDGET=0` and `VRYSE_JUDGE_RUNS=3`. Scores are averaged by `averageJudges`; the quotes and weaknesses come from the run closest to the mean.
  - **Threshold = 2·√2·σ/√k, rounded up to a half point: 3 points with 3 judge runs, 5 with 1** (σ is `VRYSE_JUDGE_SIGMA` = 1.63; computed by `thresholdFor`). Data: `data/calibration/noise.json`.
- [x] **Calibration:** `pnpm vryse calibrate --company routematic` scores three sets on the same 6 briefs. Each brief comes from a held-out article (`briefFromArticle`: title, 4 body headings, its length).
  1. the held-out human articles, scored with `trustFigures`, because their statistics come from the authors' research and not from our sources;
  2. a generic baseline: the same writer model and brief, with **no profile, examples or rules** (`writeGenericBaseline`);
  3. the full system (`runGeneration`).
- [x] The ordering holds where it matters: **human 85.5 > generic 70.0** (77.0 uncapped: the generic articles never include the FAQ that every Routematic article has). **System 87.0 ≈ human**: the 1.5-point gap is inside the 3-point noise. Style still prefers the human articles (79 vs 70). Relevance and completeness saturate because the briefs come from the articles' own headings.
- [x] README calibration table filled in, including uncapped scores and how to read them. Calibration cost $0.58.
- [x] **Spending cap:** `VRYSE_BUDGET_USD` (default $3). `call.ts` refuses new model calls once the logged total reaches it; cached answers still work. Tested.

**Done when** the evaluator clearly separates human from generic, and the table is in the README. ✅ Day 2 milestone. 146 tests in total.

---

## Day 3 — Feedback loop, UI, demo

### Step 9 — Feedback compiler, reviser and memory (2.5 h) ✅

- [x] `src/lib/schemas/feedback.ts` (planned as `instruction.ts`): `FeedbackInput`, `RevisionInstruction` (id, scope, target, action, instruction, **acceptanceCheck**, source, persist), `CompiledFeedback`, `Verification` and `Verdict`.
- [x] `src/lib/feedback/compile.ts` + `prompts/compile-feedback.md`: rating, free text, section notes and **ticked evaluator weaknesses** become numbered instructions (Gemini Flash-Lite, about $0.0004). `selectWeaknesses` resolves ticked numbers against **the list the reviewer was shown**. Code enforces that **only the editor's own instructions can be saved to memory**.
- [x] `src/lib/generation/reviser.ts` + `prompts/revise.md`: a targeted edit of the previous draft, using the same sources and allowed URLs. `sectionChanges` and `untargetedChanges` compare the drafts section by section and warn when a section changed without an instruction (the check is skipped for global instructions).
- [x] "Regenerate" mode (`--mode regenerate`): re-plans with the instructions added to the brief's notes, then re-writes.
- [x] `src/lib/evaluation/verify.ts` + `prompts/verify.md`: the judge checks each acceptance check (✓/✗ with a quote). Instructions it skips count as not addressed.
- [x] `src/lib/evaluation/verdict.ts`: `improvementVerdict` returns improved, mixed or regressed. **The threshold is derived from the judge runs actually used** (`thresholdFor(σ, k)`: 5 points with 1 run, 3 with 3), so a development run can't claim a real improvement that's really noise. The pairwise result is shown alongside.
- [x] `src/lib/feedback/memory.ts`: remember (deduplicated), list and forget. Saved preferences go into the planner, writer and reviser prompts.
- [x] `src/lib/pipeline.ts`: `runRevision` runs compile → revise or regenerate → lint (one repair) → **evaluate, verify and pairwise in parallel** → verdict → save. It writes `v{n}.md`, `v{n}.eval.json` and `v{n}.revision.json`. If the previous version was judged with **different judge settings**, it is re-scored first, so the comparison is like for like.
- [x] CLI: `vryse revise --run <id> --feedback "…" [--rating n] [--weaknesses 1,3] [--mode regenerate]`, `vryse weaknesses --run <id>` (no AI call), and `vryse memory --company <c> [--forget id]`.
- [x] Vitest: the verdict rules (including the stricter threshold for fewer runs), section changes, compile (prompt, renumbering, persistence rule), weakness selection, revise, verify (skipped means not addressed) and memory. 164 tests in total.

**Done when** one full CLI cycle produces a verdict and the ✓/✗ checklist. ✅ EV article, 1 judge run: 5 instructions, 5/5 addressed. Overall 78.4 → 81.3 (**+2.9, under the 5-point threshold**), structure −12.5, and the pairwise judge preferred the revision (4/5). Verdict **MIXED**. The cycle cost $0.05, including re-scoring v1 under the new judge settings and one repair.

Problems this live cycle exposed, all fixed and tested:
1. Ticked weakness numbers were looked up in the *re-scored* list, so "links" was dropped. They now resolve against the list the reviewer saw.
2. The compile model saved an evaluator finding as a permanent preference. Code now restricts memory to the editor's instructions, and the wrong entry was deleted.
3. The revision labelled unsupported claims as "(Routematic internal data)". The writer and reviser prompts now forbid labelling anything as company data unless a source does.
4. Links came out as bare URLs. The prompts now require `[text](url)`.

Fixes 3 and 4 are prompt changes; they'll be confirmed by the Step 11 demo run rather than an extra paid run now.

### Step 10 — Next.js UI (3.5 h) ✅

- [x] **Setup:** Cache Components turned off in `next.config.ts` (a single-user local tool; every page shows live DB state) and data pages marked `dynamic = "force-dynamic"`. shadcn/ui initialised (base-nova style on Base UI) with button, card, input, textarea, label, badge, progress, checkbox, tabs, table and separator.
- [x] **API routes (Node.js runtime):**
  - `POST /api/runs` validates the brief with Zod, runs `runGeneration` and streams NDJSON stage events (`src/lib/ui/stream.ts`).
  - `POST /api/runs/[id]/compile` returns the instructions **without revising**, so the reviewer can edit them first.
  - `POST /api/runs/[id]/revise` runs `runRevision` with the (edited) instructions and streams events.
- [x] **Server action:** delete a memory entry (`/memory`).
- [x] **`/company/[slug]`:** summary, voice, typical outline, measured ranges (p10–median–p90), intro patterns with counts, do/don't rules, vocabulary and phrases to avoid.
- [x] **`/articles/new`:** brief form (empty fields fall back to the profile) with a live stage checklist (spinner → ✓, detail, seconds), then a redirect to the run.
- [x] **`/runs/[id]`:** version tabs with scores; the verdict card for revisions (verdict, reasons, ✓/✗ instruction checklist with evidence, untargeted-change warning, pairwise reasons); the rendered article; the score panel (overall, dimension bars, measured and judged halves, judge runs); key points; judge summary; unsupported claims; and the feedback panel (tick weaknesses → rating → text → **Compile** → edit or remove instructions → targeted revision or regenerate → live progress → jump to the new version).
- [x] **`/runs/[id]/compare?a=&b=`:** score-delta table, verdict and checklist, and a side-by-side **word diff** (`diffWords`; removals red, additions green).
- [x] **`/memory`:** saved rules per company, with delete.
- [x] **`/observability`** (shown as "Usage"): total spend, the spending cap, the evaluation count, and calls, errors, average time and cost per stage and model.
- [x] Verified: production build passes; every page returns 200 and an unknown run returns 404; headless-Chromium screenshots of the run, compare, form and profile pages looked right (they caught a font bug: the theme's `--font-sans` wasn't wired to Geist); and a full compile → revise cycle through the streaming API worked.

**Done when** the whole loop runs in the UI. ✅

Found by testing the UI's compile step (fixed and tested):
- **Flash-Lite compiled feedback badly.** It invented a request and split "no links" into 9 per-section instructions. Compiling now uses GPT-5 mini (about $0.006), with a stricter prompt (one instruction per point, global for multi-section changes, never add requests). The same feedback then gave 4 correct instructions.
- **"Remember for all articles" was still too loose.** The model flagged article-specific fixes. `isStandingRule` now requires your own wording to state a general rule ("always", "never", "all our articles", "as a rule"…) in a sentence about the same thing.
- **The live revision confirmed the Step 9 prompt fixes:** "(Routematic internal data)" labels went from 27 to 0, Markdown links from 0 to 6, bare URLs from 1 to 0, and all 4 instructions were ✓. Verdict MIXED: +5.6 overall, but readability −8.7, and the pairwise judge preferred v2.

167 tests in total. Step 10 testing cost about $0.03.

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

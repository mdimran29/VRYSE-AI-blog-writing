# VRYSE — AI-Powered Blog Writing System

> **Status: in development.** Sections marked _TBD_ are filled in as each milestone in [plan.md](plan.md) is completed. The numbers in the results tables come from real runs and aren't estimated.

The system learns a company's blog style from its existing human-written articles. It then writes new on-brand articles, scores them, and improves them through human feedback. Measured improvement is shown at every iteration.

The reference client is **Routematic** (employee transport, India), using 61 of its human-written blog articles in `.docx` format. The brief suggested Protecto AI, but those docs were access-restricted, and VRYSE confirmed that any client's articles may be used.

---

## Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Technology choices](#3-technology-choices)
4. [Setup](#4-setup)
5. [Environment variables](#5-environment-variables)
6. [Running the application](#6-running-the-application)
7. [Using the application](#7-using-the-application)
8. [Evaluation methodology](#8-evaluation-methodology)
9. [Design decisions](#9-design-decisions)
10. [Before & after example](#10-before--after-example)
11. [Known limitations](#11-known-limitations)
12. [Future improvements](#12-future-improvements)

---

## 1. Overview

The workflow has three stages and a feedback loop:

| Stage | What it does | Output |
|---|---|---|
| **1. Analysis** | Parses the reference `.docx` articles. Measures structure, style and readability in code, and uses an LLM to extract tone, intro/conclusion patterns, examples and terminology | **Company Style Profile** (JSON) |
| **2. Generation** | Retrieves the most relevant reference excerpts, plans an outline constrained by the profile, then writes the article | Markdown article |
| **3. Evaluation** | Scores 7 dimensions with deterministic metrics plus an LLM judge, and lists weaknesses with evidence | Scores and qualitative report |
| **Feedback loop** | Compiles human feedback into typed revision instructions, revises the draft, re-evaluates, and checks that each instruction was addressed | Improved draft, diff, score deltas |

## 2. Architecture

```text
Reference .docx ─► Parse (AST) ─► Deterministic features ─┐
                              └─► LLM per-article extract ─┴─► Company Style Profile
                              └─► Embedding index

Brief ─► Retrieve excerpts ─► Planner (outline) ─► Writer ─► Lint ─► Evaluator ─► Review UI
                                                                                     │
          Company memory ◄── persistent preferences ◄── Feedback compiler ◄── Human feedback
                                                              │
                                              Reviser ─► Re-evaluate + verify + pairwise
```

The full component description, data model, scoring formulas and cost analysis are in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

### Repository layout

```text
.
├── README.md · ARCHITECTURE.md · plan.md
├── package.json · tsconfig.json · next.config.ts · drizzle.config.ts · .env.example
├── src/
│   ├── app/                         # Next.js App Router (UI + route handlers)
│   │   ├── page.tsx                 # home: company + recent runs
│   │   ├── company/[slug]/page.tsx  # style profile view
│   │   ├── articles/new/page.tsx    # brief form → generate
│   │   ├── runs/[id]/page.tsx       # review + feedback
│   │   ├── runs/[id]/compare/page.tsx
│   │   ├── memory/page.tsx · observability/page.tsx
│   │   └── api/runs/…               # streaming pipeline endpoints
│   ├── components/                  # shadcn/ui + app components
│   └── lib/                         # the pipeline (server-only)
│       ├── config.ts
│       ├── schemas/                 # Zod: brief, outline, profile, evaluation, instruction
│       ├── llm/                     # AI SDK wrapper, model routing, call logging, dev cache
│       ├── ingest/                  # sheet/Drive fetch, docx → Article AST → Markdown
│       ├── analysis/                # deterministic features, LLM extraction, profile synthesis
│       ├── retrieval/               # local embeddings, BM25, hybrid search
│       ├── generation/              # planner, writer, lint, reviser, prompts/
│       ├── evaluation/              # metrics, judge, scoring, pairwise, verify, calibrate
│       ├── feedback/                # feedback compiler, memory
│       └── db/                      # Drizzle schema + SQLite client
├── scripts/cli.ts                   # `pnpm vryse …`
├── data/
│   ├── raw/routematic/               # source .docx (git-ignored)
│   ├── processed/                   # parsed articles
│   ├── index/                       # embedding index
│   └── profiles/                    # style profiles (committed — they are a deliverable)
├── examples/                        # briefs + exported before/after run
└── tests/                           # Vitest
```

## 3. Technology choices

| Concern | Choice | Why |
|---|---|---|
| Language / runtime | **TypeScript**, Node.js 24 LTS | One language for the pipeline, the API and the UI. Typed schemas run end to end |
| Framework | **Next.js** (App Router) | Server Components read the DB directly, Route Handlers stream pipeline progress, and Server Actions handle mutations. No separate backend is needed |
| LLM access | **Vercel AI SDK** through the **Vercel AI Gateway** | Provider-agnostic, so any model is just a `"provider/model"` string. One key covers OpenAI, Google and others. **$5 of free credit every 30 days** covers this project |
| Models | Gemini 2.5 Flash-Lite (extraction) · GPT-5 mini (writing) · Gemini 2.5 Flash (judge) | All are available on the gateway's free tier. Cost fits each task, and the judge comes from a different model family from the writer to reduce self-preference bias. See [ARCHITECTURE.md §3.8](ARCHITECTURE.md#38-llm-client-srclibllm) |
| Schemas | **Zod** | Validates every LLM structured output and every API input |
| Document parsing | `mammoth` + `node-html-parser` | Turns Word heading, list and table styles into semantic HTML, which is needed for structural analysis |
| Text metrics | `Intl.Segmenter` + `syllable` | Built-in sentence and word segmentation. The readability formulas are implemented in-house |
| Embeddings | `@huggingface/transformers` (local `bge-small-en-v1.5`) | Free, with no API key or rate limit, and deterministic |
| Search | Cosine over `Float32Array` + in-house BM25 | A vector DB is unnecessary at about 70 documents |
| Storage | SQLite via `better-sqlite3` + **Drizzle ORM** | A single file with no service to run. The same schema can move to Postgres |
| UI | Tailwind + **shadcn/ui**, `react-markdown`, `diff` | Fast, clean components, Markdown rendering and word-level diffs |
| CLI | `commander` + `tsx` | Scripted ingestion, calibration and experiments |
| Testing | **Vitest** | Fast and native to TypeScript |
| Package manager | `pnpm` | Fast, strict installs |

## 4. Setup

**Prerequisites:** Node.js 22+ (24 LTS recommended), `pnpm`, and a free Vercel account for the AI Gateway key. See [§5](#5-environment-variables) for options that need no gateway.

```bash
git clone <repo-url> vryse && cd vryse
pnpm install
cp .env.example .env.local     # then fill in AI_GATEWAY_API_KEY
pnpm vryse ping                # checks all three models; creates data/vryse.db on first run
```

The SQLite database is created and migrated automatically the first time it's opened. After changing `src/lib/db/schema.ts`, run `pnpm db:generate` to add a migration.

**Getting an AI Gateway key:** open the Vercel dashboard, go to **AI Gateway → API Keys**, and create a key. Free credit is granted after your first request. Don't buy credits if you want to keep the free monthly grant, because buying credits moves the account to the paid tier. The free tier only allows some models; `pnpm vryse ping` tells you whether the configured ones work. A blocked model fails with "Free tier users do not have access to this model".

### Getting the reference articles

**Option A — Google API (automatic).** Create a service account with Sheets and Drive read access. Share the sheet and the docs with the service account, then set `GOOGLE_APPLICATION_CREDENTIALS` and run:

```bash
pnpm vryse ingest --company routematic --sheet-id "$CLIENT_SHEET_ID" --tab Routematic
```

**Option B — manual.** Download the Routematic articles as `.docx` into `data/raw/routematic/`, then run:

```bash
pnpm vryse ingest --company routematic --from-dir data/raw/routematic
```

## 5. Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AI_GATEWAY_API_KEY` | ✅ (gateway mode) | — | Vercel AI Gateway access |
| `VRYSE_ANALYSIS_MODEL` | | `google/gemini-2.5-flash-lite` | Per-article extraction, feedback compiler |
| `VRYSE_WRITER_MODEL` | | `openai/gpt-5-mini` | Profile synthesis, planner, writer, reviser |
| `VRYSE_JUDGE_MODEL` | | `google/gemini-2.5-flash` | Absolute and pairwise evaluation, instruction verification |
| `VRYSE_LLM_CONCURRENCY` | | `6` | Maximum parallel LLM calls. Set it to `1` on free tiers with strict rate limits |
| `VRYSE_DEV_CACHE` | | `true` | Reuse identical LLM responses during development |
| `VRYSE_EMBED_MODEL` | | `Xenova/bge-small-en-v1.5` | Local embedding model |
| `VRYSE_DATA_DIR` | | `./data` | Raw, processed, index and profile data |
| `VRYSE_DB_PATH` | | `./data/vryse.db` | SQLite database |
| `GOOGLE_GENERATIVE_AI_API_KEY` | only for `google-direct/` | — | Gemini API free tier, used directly |
| `OLLAMA_BASE_URL` | only for `ollama/` | `http://localhost:11434` | Local models |
| `CLIENT_SHEET_ID` | for option A | — | Google Sheet with the article list |
| `GOOGLE_APPLICATION_CREDENTIALS` | for option A | — | Service-account JSON path |

### Running at no cost

| Mode | Set the models to | Trade-off |
|---|---|---|
| **AI Gateway free credit** (recommended) | defaults | $5 every 30 days with no markup, limited to free-tier models. The whole project is estimated at about $1–2 |
| **Gemini free tier** | `google-direct/<flash model>` for all three stages | $0, but low and frequently changing rate limits, so set `VRYSE_LLM_CONCURRENCY=1`. Free-tier prompts may be used by Google to improve its products, so check that sending client articles is acceptable. The writer and judge are from the same family |
| **Ollama (local)** | `ollama/<model>` | $0 with unlimited use, but output quality is noticeably weaker and it needs a capable GPU or plenty of RAM |

## 6. Running the application

```bash
pnpm vryse ingest --company routematic --from-dir data/raw/routematic   # parse articles
pnpm vryse profile build --company routematic                         # style profile + embedding index
pnpm dev                                                            # open http://localhost:3000
```

Optional:

```bash
pnpm vryse generate --company routematic --brief examples/briefs/ev-fleet-transition.json
pnpm vryse calibrate --company routematic      # held-out human vs generic baseline vs system
pnpm test && pnpm typecheck && pnpm lint
```

## 7. Using the application

1. **Company:** open *Routematic* and review the style profile the system extracted.
2. **New article:** enter the topic, target audience, length, key points and any required sections, then click **Generate**. Progress for each stage streams live.
3. **Review:** read the article and look at the overall score, the per-dimension bars, and the ranked weaknesses with quoted evidence.
4. **Feedback:** give a 1–5 rating, write free-text notes, and tick the evaluator recommendations you agree with. Click **Compile**. The system shows the structured revision instructions, and you can edit them before continuing.
5. **Revise:** click **Revise** to generate version n+1.
6. **Compare:** view both versions side by side with a diff, the score deltas, a ✓/✗ checklist of instructions, the pairwise verdict and the improvement verdict (*Improved*, *Mixed* or *Regressed*).
7. Repeat until you **Approve**. Preferences marked *persist* are saved to company memory and applied to future articles.

## 8. Evaluation methodology

### Metrics

| Dimension | Weight | Why it matters | How it is calculated |
|---|---|---|---|
| Structure | 20% | The format must look like the company's blog | Band score of H2/H3 counts, intro/conclusion length and FAQ/list/table use vs the profile (50%), plus judge on flow and patterns (50%) |
| Style | 20% | The core requirement is not to sound generic | Band score of sentence/paragraph lengths, POV rates, signature terms, AI-ism hits and embedding similarity to the company centroid (50%), plus judge on voice (50%) |
| Relevance | 15% | The article must answer the brief | Brief↔article embedding similarity (50%), plus judge (50%) |
| Completeness | 15% | Required points must be covered | Per-key-point coverage (covered / partial / missing, with evidence) plus length vs target |
| Tone | 10% | It must match the brand voice | Judge against the profile's tone descriptors |
| Readability | 10% | It must suit the audience | FK grade vs the profile band (50%), plus judge on clarity (50%) |
| Specificity | 10% | Generic filler is the most common AI failure | Numbers and examples per 1k words vs the profile, plus judge-flagged generic passages |

**Band scoring:** a value inside the reference corpus's p10–p90 band scores 100. Outside the band, the score decays linearly to 0 at one IQR beyond it.

**Overall score:** the weighted sum. A missing required section caps it at 70.

**Human rating:** recorded and shown on its own, not mixed into the automatic score, so that automatic scores stay comparable across runs.

### How improvement is determined

An iteration is **Improved** only when all three of the following hold:

1. Overall Δ ≥ the noise threshold: **3 points**. Each score is the mean of 3 judge runs; the single-run σ is 1.63, and 2·√2·σ/√3 = 2.7, rounded up to 3.
2. No dimension drops by more than 5.
3. At least 80% of the revision instructions are verified as addressed.

A pairwise judge, with the order of the two versions randomised, gives an independent second opinion.

### Judge noise (measured)

Each draft was scored 5 times. The code-measured half was identical on every run, so all the variance comes from the judge.

| Judge | σ of the overall score (single run) | Decision |
|---|---|---|
| Gemini 2.5 Flash, default thinking | 4.6 and 5.5 (two articles) | Too noisy: an improvement would need +13 points to count |
| **Gemini 2.5 Flash, thinking off** | **1.6 and 0.0** | **Chosen.** Still critical, a third of the noise, and cheaper |
| Mistral Large 3 | 0.6 | Rejected: stable but lenient, giving 5/5 for specificity despite quoted unsupported claims |

Raw data: [`data/calibration/noise.json`](data/calibration/noise.json).

### Calibration results

Six held-out Routematic articles were never in the profile or the search index. For each one, a brief was built from its title, four body headings and length. Three sets were scored on those same briefs: the real article, a **generic baseline** (the same writer model with the brief only, no profile or examples), and **this system**. Each score is the mean of 3 judge runs. Raw data: [`data/calibration/calibration.json`](data/calibration/calibration.json).

| Set | Overall | Uncapped | Structure | Style | Relevance | Completeness | Tone | Readability | Specificity |
|---|---|---|---|---|---|---|---|---|---|
| Held-out human Routematic articles | **85.5** | 85.5 | 79 | 79 | 98 | 100 | 67 | 83 | 92 |
| Generic baseline (no profile) | **70.0** | 77.0 | 49 | 70 | 100 | 100 | 71 | 88 | 74 |
| VRYSE v1 (profile + retrieval) | **87.0** | 87.0 | 87 | 70 | 100 | 100 | 75 | 97 | 84 |

**Reading it:**
- **The metric separates on-brand from generic.** Human articles beat the generic baseline by 8.5 points even uncapped. The generic articles had an FAQ in 0 of 6 cases, against 100% of Routematic's, so the cap at 70 applies. Most of the gap is structure (79 vs 49) and specificity (92 vs 74).
- **The system matches the human articles within noise** (87.0 vs 85.5; the threshold is 3). It doesn't beat them. Style still favours the human articles (79 vs 70), so the evaluator can tell them apart.
- **Teaching to the test.** The system is guided by the same corpus ranges it's scored against, which explains part of its structure lead (87 vs 79) and its uniformity (86–88 against the humans' 74–93).
- Relevance and completeness saturate here, because each brief was derived from the article's own headings, so they don't discriminate in this test.

### Limitations of this evaluation

- The LLM judge has variance and its own biases. They are mitigated by using a judge from a different model family, an anchored rubric, required evidence quotes, temperature 0 and the measured noise threshold, but not eliminated.
- The band metrics reward matching the company's *averages*. A good article that is unusually short or long gets penalised.
- Embedding similarity mixes topic and style. It can't fully separate "sounds like Routematic" from "is about the same subject".
- With 54 reference articles, the percentile bands are rough, and calibration used only 6 held-out articles.
- Calibration briefs are derived from the held-out articles themselves, which makes relevance and completeness easy for every set.

## 9. Design decisions

| Area | Decision | Reasoning |
|---|---|---|
| Reference analysis | Deterministic stats plus LLM extraction, consolidated into a profile | The stats are reproducible and cheap. The LLM captures what code can't measure. The profile is inspectable and is reused by both the writer and the evaluator |
| Retrieval | Top-k articles and sections, with **excerpts only** in the prompt | Gives voice exemplars without copying or bloating the context |
| Generation | Outline first, then a single-pass writer | The outline makes structure and key-point coverage controllable and checkable. A single pass keeps the voice consistent |
| Evaluation | Hybrid deterministic plus LLM judge, plus pairwise comparison | Deterministic scores anchor the results. The judge covers the semantic dimensions. Pairwise comparison gives a robust before/after signal |
| Feedback | Compiled into typed, verifiable instructions, with a targeted revision | Proves that feedback *changed* the output, and keeps the good parts intact |
| Memory | Opt-in persisted preferences per company | Recurring feedback shouldn't need repeating, and the human controls what gets kept |
| Models | Gemini 2.5 Flash-Lite for extraction, GPT-5 mini for writing, Gemini 2.5 Flash for judging, all through the AI Gateway | Each model fits its task on cost and quality, and all are on the free tier. The judge's family differs from the writer's. The whole project fits within the free credit |
| Stack | One Next.js + TypeScript app | One language and one process. Typed schemas are shared by the pipeline and the UI |
| Architecture | A pipeline, not autonomous agents | The order is fixed, so a pipeline is predictable, cheaper and easier to debug |

See [ARCHITECTURE.md §6](ARCHITECTURE.md#6-why-not) for the alternatives that were considered.

## 10. Before & after example

_TBD — exported from a real run into `examples/before_after/`._

| | v1 (initial) | v2 (after feedback) | Δ |
|---|---|---|---|
| Overall | | | |
| Structure | | | |
| Style | | | |
| Relevance | | | |
| Completeness | | | |
| Tone | | | |
| Readability | | | |
| Specificity | | | |

**Brief:** _TBD_
**Human feedback:** _TBD_
**Compiled instructions:** _TBD_ (with ✓/✗ verification)
**Pairwise verdict:** _TBD_
**Cost of this run:** _TBD_ (from `llm_calls`)

## 11. Known limitations

- Documents that fake headings with bold text are normalised by heuristics, and some may be misclassified.
- The profile assumes a single house style per company. Mixed authorship or several content types blur the bands.
- The judge is itself an LLM; see §8.
- Generated claims and statistics aren't fact-checked against external sources.
- The system is single-user and runs locally on SQLite, with no auth and no concurrency handling. It isn't deployable to serverless as-is.

## 12. Future improvements

- **Per-content-type sub-profiles**, such as how-to, listicle or thought leadership, selected automatically from the brief.
- **A fact-grounding step** that uses web search and citation verification for statistics.
- **Judge calibration against human ratings**: once enough ratings are collected, fit the dimension weights to them.
- **Section-level regeneration** from the Compare view.
- **Automatic memory promotion**, where a preference is suggested for memory after it appears in feedback N times.
- **Deployment on Vercel:** move SQLite to Postgres (Neon) with Drizzle, store the `.docx` files in Blob, and run generation as a durable Workflow so long runs survive restarts.

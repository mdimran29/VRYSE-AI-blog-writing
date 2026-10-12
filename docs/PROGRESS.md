# What has been built so far — and what it actually does

_Last updated: 2026-10-12, after Step 8 of [plan.md](../plan.md)._

This document explains, in plain language, every part of the system that exists today: what was built, what it does when you run it, how to try it yourself, and what the results were. For the full design, see [ARCHITECTURE.md](../ARCHITECTURE.md).

---

## 1. The system in one paragraph

You give the system a short **brief**, for example "an article about moving employee cabs to electric vehicles". It writes a full blog article that sounds like **Routematic** wrote it. It can do this because it first studied 54 real Routematic articles: it measured them (length, structure, sentence style), asked an AI model to describe their style, and saved everything as a **style profile**. When writing, it plans an outline first, shows the writer short real passages from similar Routematic articles, writes the article, and then checks the result with code before saving it.

```text
 54 Routematic .docx articles
        │
        ▼
 ① Read & clean the Word files ──► ② Measure them (37 numbers each)
        │                                   │
        ▼                                   ▼
 ④ Search index of sections        ③ AI describes the style ──► Style profile
        │                                                         │
        └──────────────┬──────────────────────────────────────────┘
                       ▼
 Brief ──► ⑤ Find similar passages ──► ⑥ Plan outline ──► Write ──► Check ──► (Fix once) ──► ⑦ Score ──► Saved article + scores
```

**What is not built yet:** human feedback and improvement (Step 9) and the web interface (Step 10). Today everything runs from the command line.

---

## 2. The data

| Item | Details |
|---|---|
| Client | **Routematic**: employee transport software and services in India |
| Why not Protecto | The brief named Protecto AI, but its 63 Google Docs were private. VRYSE confirmed that any client's articles can be used. |
| Articles | 61 Word files in `data/raw/routematic/` (not committed to git: client content) |
| After cleaning | 60 articles: one older duplicate removed (a "Revised" version exists) |
| Split | **54 for learning**, **6 held back** for testing the scoring later. The held-back 6 are never shown to the writer. |

---

## 3. Step by step: what was done and what it does

### Step 1 — Project setup and the AI connection

**Built:** a Next.js + TypeScript project, a SQLite database (one file: `data/vryse.db`), and one function that every AI call goes through (`src/lib/llm/call.ts`).

**What it actually does:**
- Connects to AI models through the **Vercel AI Gateway** with your key (in `.env.local`, never committed).
- Checks that the AI's answer has the exact shape the code expects, and asks once more if it doesn't.
- Waits and retries automatically when the provider is busy (rate limits).
- **Remembers answers during development.** If the exact same question is asked again, the saved answer is reused for free.
- Logs every call (tokens, time, cost) to the database.

**Model choice:** the gateway's free tier blocks all Claude models and the newest Gemini models. I tested about 45 models with your key and chose:

| Job | Model | Why |
|---|---|---|
| Reading each article | Gemini 2.5 Flash-Lite | Very cheap, good at extraction |
| Planning and writing | GPT-5 mini | Strong writer at a low price |
| Judging (Step 7) | Gemini 2.5 Flash | A different company from the writer, so it doesn't favour its own style |

**Try it:** `pnpm vryse ping` (tests all three models) · `pnpm vryse cost` (spend and remaining credit)

---

### Step 2 — Reading the Word files

**Built:** a parser that turns each `.docx` into clean structured text (`src/lib/ingest/`).

**What it actually does:**
- Keeps headings (H1/H2/H3), paragraphs, bullet and numbered lists, tables, **bold text** and links.
- Removes editing clutter, such as "Grammarly Report" screenshots pasted at the end of 21 documents.
- Saves "Meta Title" and "URL Slug" lines as metadata instead of article text.
- Finds near-duplicates by comparing word sequences, not titles. Two "Car Rental" articles look alike by title but share only 2% of their text, so both were kept.
- Splits the articles into a learning set and a test set, the same way every time.

**Checked:** every real heading in all 60 articles matched the original Word file.

**Try it:** `pnpm vryse ingest --company routematic --from-dir data/raw/routematic`, then open any `.md` file in `data/processed/routematic/`.

---

### Step 3 — Measuring the articles (no AI)

**Built:** 37 measurements per article (`src/lib/analysis/metrics.ts`), combined into typical ranges for the company.

**What it actually does:** counts things that code can count reliably and for free:

| Measurement | Routematic typical (p10 – median – p90) |
|---|---|
| Words | 1,323 – 1,468 – 2,223 |
| H2 sections | 5 – 7 – 10 |
| Words per sentence | 11 – 15 – 18 |
| Words per paragraph | 25 – 33 – 49 |
| Reading level (grade) | 9.9 – 13.9 – 17 |
| Bold phrases per 1,000 words | 2.9 – 9.5 – 17 |

Also: FAQ in **100%** of articles, a conclusion heading in 63%, Key Takeaways in 28%. AI-style phrases ("delve", "game-changer"…) are **rare** in the human articles, so they're a useful warning sign in generated text.

**Try it:** `pnpm vryse profile stats --company routematic --brand Routematic`

---

### Step 4 — The style profile (AI + measurements)

**Built:** `data/profiles/routematic.json`, the system's written understanding of Routematic's style.

**What it actually does:**
1. An AI model reads each of the 54 articles and notes how it opens, how it ends, its tone, how it uses data and examples, and its formatting habits.
2. A second AI call combines all 54 sets of notes with the Step 3 numbers into one style guide, with counts ("intro pattern X: 22 of 54 articles") and 10 do / 10 don't rules.
3. Code adds what code can check better: **the order of sections** and **the phrases to avoid**.

**What it says about Routematic** (summarised):
- Readers: transport, HR and operations decision-makers in Indian enterprises.
- Structure: intro → Key Takeaways (optional) → numbered or keyword-led sections → Conclusion → **FAQ always last**.
- The intro names a real problem, often gives a statistic, and ends with "what this article covers" (about 125 words).
- British/Indian spelling and ₹; every outside statistic is linked to its source; CTAs only at the end, and in only about 40% of articles.

**A problem found and fixed:** the AI's first version put Key Takeaways and the FAQ in the wrong place. Measuring the real order in code (FAQ last in 51 of 54 articles) and giving it to the AI fixed it.

**Cost:** about $0.03 per build.

**Try it:** `pnpm vryse profile build --company routematic --brand Routematic`

---

### Step 5 — Finding similar passages (search)

**Built:** a search index of 457 article sections (`src/lib/retrieval/`), made with a free model that runs on your computer.

**What it actually does:**
- Splits each article into its intro and its sections, and labels each one: intro, key takeaways, body, conclusion or FAQ.
- Searches by **meaning** (embeddings, 70%) and by **exact words** (BM25, 30%).
- For each brief, picks one intro, one conclusion and two body sections from **different** articles, within a fixed size limit. The writer uses these as examples of Routematic's voice, not as text to copy.

**A decision made by measuring:** with 80% meaning / 20% words, a search for "monsoon flooding" ranked the only two monsoon passages 9th and 11th. At 70/30 the first one is 2nd, and other searches stayed accurate.

**Try it:** `pnpm vryse excerpts --company routematic --topic "Keeping commutes running during monsoon floods"`

---

### Step 6 — Planning and writing the article

**Built:** the planner, the writer, the automatic checks and the full pipeline (`src/lib/generation/`, `src/lib/pipeline.ts`).

**What it actually does, in order:**
1. **Find:** the 3 most similar Routematic articles, whose section headings the planner sees as structure examples.
2. **Plan:** the AI writes an outline: title, intro plan, sections with word budgets, the FAQ questions, and a CTA if appropriate. **Code then checks the outline**: every key point from the brief has a section, required sections exist, the FAQ has enough questions, the number of sections is normal for Routematic, and the conclusion is last. If something is wrong, the AI gets one more try with the problems listed.
3. **Find again:** the best passages for **each planned section**.
4. **Write:** the AI writes the article. It must use only statistics and links found in the passages it was shown, never invented ones.
5. **Check (code):**

   | Problem | Severity |
   |---|---|
   | Not exactly one title, length more than 25% off, no FAQ, a required section missing | must fix |
   | A link that doesn't exist in any Routematic article (possibly invented) | must fix |
   | 12 or more words copied from a Routematic article | must fix |
   | Similar phrasing, phrases to avoid, unusual section count, FAQ not last | warning |
   | **A number not found in any Routematic article or the brief** | warning |

6. **Fix once:** if there's a "must fix" problem, the AI repairs the draft once. The repair is kept only if it actually reduced the problems.
7. **Save:** to the database and to `data/runs/<run id>/v1.md` (plus the outline and the check results).

**Problems found and fixed while testing:**
- **The writer always wrote too much:** 29–38% over the target in 4 out of 4 tests, even when told "never more than". Each article then needed an extra repair call. The writer is now given budgets scaled to 78%, and the next articles came out within +6% to +9% with no repair. This is a measured correction; if the writer model changes, it should be measured again.
- **Invented-looking numbers:** the new number check flags figures like "1,200 employees" or "3%" that appear in no source. Most were worked examples rather than false facts, but a human should decide, so they show up as warnings.

**Results on the three example briefs** (`examples/briefs/`):

| Brief | Words (target 1,450) | Sections | FAQ | Time | Cost |
|---|---|---|---|---|---|
| Moving the fleet to EVs | 1,576 | 9 H2 | 5 questions | 31 s | $0.008* |
| New office in Hyderabad | 1,538 | 9 H2 | 5 questions | 26 s | $0.007* |
| Monsoon disruption | 1,614 (before the length fix) | 9 H2 | 5 questions | 77 s | $0.022 |

\* These reruns reused the outline from the dev cache, so their cost and time leave out planning (about $0.01 and 30 s). A fresh article costs about $0.02–0.03.

Every article followed the Routematic shape (intro → Key Takeaways → sections → conclusion → FAQ last) with British spelling. No links were invented. The one specific statistic used (2.3 million EV sales in India) really is in the Routematic articles.

**Try it:** `pnpm vryse generate --brief examples/briefs/ev-fleet-transition.json`, then open the `.md` file it prints.

---

### Step 7 — Scoring the article

**Built:** the evaluator (`src/lib/evaluation/`). Every new article is scored automatically, and saved articles can be re-scored.

**What it actually does:** it gives the article a score from 0 to 100 on seven **dimensions**, then combines them into one **overall** score. Each dimension has up to two halves:

| Dimension | Weight | Measured by code | Judged by the AI judge |
|---|---|---|---|
| Structure | 20% | Section counts, intro and closing length, FAQ present and last | Flow; intro and conclusion follow Routematic's patterns |
| Style | 20% | Sentence and paragraph rhythm, bold, links, "you"/"we", AI-style phrases, **how close the article is to Routematic's real articles** (embeddings) | Voice and the do/don't rules |
| Relevance | 15% | How close the article is to the brief, compared with Routematic's articles | On-topic, serves the audience |
| Completeness | 15% | Length vs target, required sections | Each key point: covered / partial / missing |
| Tone | 10% | — | Matches Routematic's tone |
| Readability | 10% | Reading grade vs Routematic's range | Clear and easy to skim |
| Specificity | 10% | Numbers per 1,000 words, minus 10 points per unsupported number | Generic filler; **claims not supported by the sources** |

- **"Measured by code" uses Routematic's real ranges.** If a value sits where 80% of Routematic's articles sit (p10–p90), it scores 100. Further outside, the score drops to 0.
- **The judge is a different AI company's model** (Gemini, while the writer is GPT), so it doesn't favour its own writing. It must quote the article as evidence for every score, and it is never told which version it's reading.
- **Weaknesses come from three sources** (judge, measurements, checks) and are ranked by severity, each with a concrete fix. These become the input for human feedback in Step 9.
- **If the judge fails**, the code-measured scores are still shown.
- **Ready for Step 9:** a "which is better, A or B?" judge, which shows the two versions in random order so position can't bias it.

**Result on the EV article:**

| Dimension | Score |
|---|---|
| Structure | 88 |
| Style | **54** |
| Relevance | 100 |
| Completeness | 100 |
| Tone | 50 |
| Readability | 88 |
| Specificity | **63** |
| **Overall** | **78.4** |

The main weaknesses it found are real and fixable:
- Paragraphs average **14 words**; Routematic's are 25–49.
- **93%** of paragraphs are a single sentence; Routematic's range is 10–60%.
- **41** bold phrases per 1,000 words; Routematic uses 3–17.
- **No links** at all; Routematic has 3–6 per 1,000 words.
- The judge's main point: claims like "lower maintenance" or "6–18 month rollouts" have no source. It quoted seven of them.

**A problem found by testing:** re-scoring the *same* article gave **84.7 instead of 78.4**. The judge gave tone 3/5 the first time and 5/5 the second; the code-measured half didn't change at all. So one judge run can move the score by about ±6 points. This matters because the system must later prove that an improved article is *really* better, not just luckier. Step 8 measures this properly.

**Two smaller fixes:**
- The judge sometimes counted the required FAQ as a "key point". Coverage now counts only the brief's real key points.
- The judge is never answered from the development cache, so re-scoring always makes a fresh, independent judgement.

**Cost:** about **$0.027 per score**, mostly the judge's "thinking". A full article plus its score costs about $0.05.

**Try it:** `pnpm vryse generate --brief examples/briefs/ev-fleet-transition.json` (prints the scores), or `pnpm vryse evaluate --run <run id>`

---

### Step 8 — Proving the scores can be trusted

**Built:** two tools, `pnpm vryse noise` and `pnpm vryse calibrate`, plus a spending cap.

**What it actually does:**

**1. Measuring the judge's noise.** It scores the same article 5 times. Any difference between the runs is noise, because the text didn't change.

| Judge | Spread (σ) | Decision |
|---|---|---|
| Gemini, normal "thinking" | 4.6–5.5 points | Too noisy |
| **Gemini, thinking turned off** | **1.6 and 0** | **Chosen**: still strict, much steadier, and cheaper |
| Mistral | 0.6 | Rejected: steady but **too kind**, giving top marks even to weak parts |

Every score is now the **average of 3 judge runs**. From the measured spread, an improvement counts as real only if the score rises by **at least 3 points**. Anything smaller could be luck.

**2. Checking that the scores mean something.** The 6 Routematic articles the system never saw were each turned into a brief (their title, main headings and length). Three versions were scored on each brief:

| Version | Score |
|---|---|
| The real Routematic article | **85.5** |
| A generic AI article (same model, no Routematic knowledge) | **70.0** (77.0 before the missing-FAQ cap) |
| This system's article | **87.0** |

- The scorer clearly rates real Routematic writing above generic AI writing, so it measures something real.
- The system scores about the same as the real articles. The 1.5-point difference is smaller than the noise, so it does **not** mean the system is better than a human.
- Style still rates the real articles higher (79 vs 70).
- Honest caveat: the system is guided by the same Routematic numbers it's scored on, so it's partly "writing to the test".

**3. Protecting the credit.** A spending cap (`VRYSE_BUDGET_USD`, default $3) stops all new AI calls once the logged total reaches it. Answers saved in the cache still work, because they're free.

**Cost of Step 8:** about $0.85, mostly the noise experiments (25 extra scorings) and the calibration ($0.58).

**Try it:** `pnpm vryse noise --run <run id> --times 3` (about $0.03) · `pnpm vryse calibrate --company routematic` (about $0.60)

---

## 4. Money and time so far

| Item | Amount |
|---|---|
| Total AI spend for all building and testing | **$1.08** |
| Free credit left (of $5 per 30 days) | **about $3.92** |
| Cost of one fresh article, including its score (3 judge runs) | about **$0.05** |
| Spending cap | **$3.00** total (`VRYSE_BUDGET_USD`) |
| Time for one fresh article, including its score | about **2 minutes** |

---

## 5. How to check that everything works

```bash
pnpm test        # 146 automatic tests
pnpm typecheck   # TypeScript has no errors
pnpm lint        # code style is clean
pnpm vryse ping  # all three AI models answer
```

---

## 6. Honest limitations (so far)

- **Fact-checking is partial.** The number check only knows whether a number appears *somewhere* in the Routematic articles. A common number like "30%" used in a different context still passes. The Step 7 judge will compare claims with the actual passages.
- **The style profile is based on one company** with 54 articles. Ranges like "5–10 sections" are only as reliable as that sample.
- **The length correction (0.78)** was measured on a handful of articles with one model.
- **The judge still has some noise**, although much less than before (thinking off, 3 runs averaged). Differences under 3 points should be ignored.
- **The calibration is small:** 6 articles. The system matching the human articles is a promising sign, not proof.
- **"Writing to the test":** the system is guided by the same numbers it's scored on, so its scores flatter it a little.

---

## 7. What comes next

| Step | What it will add |
|---|---|
| 9 — Feedback loop | A person's feedback becomes clear instructions, the article is revised, and the system checks each instruction was followed |
| 10 — Web interface | The whole flow in a browser: brief → article → scores → feedback → improved article → side-by-side comparison |
| 11–12 | The before/after demo and the final README |

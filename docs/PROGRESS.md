# What has been built so far — and what it actually does

_Last updated: 2026-10-12, after Step 6 of [plan.md](../plan.md)._

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
 Brief ──► ⑤ Find similar passages ──► ⑥ Plan outline ──► Write ──► Check ──► (Fix once) ──► Saved article
```

**What is not built yet:** scoring the article (Step 7), human feedback and improvement (Steps 9–10), and the web interface (Step 10). Today everything runs from the command line.

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

## 4. Money and time so far

| Item | Amount |
|---|---|
| Total AI spend for all building and testing | **$0.20** |
| Free credit left (of $5 per 30 days) | **$4.80** |
| Cost of one fresh article today | about **$0.02–0.03** |
| Time for one fresh article | about **60 seconds** |

---

## 5. How to check that everything works

```bash
pnpm test        # 112 automatic tests
pnpm typecheck   # TypeScript has no errors
pnpm lint        # code style is clean
pnpm vryse ping  # all three AI models answer
```

---

## 6. Honest limitations (so far)

- **Fact-checking is partial.** The number check only knows whether a number appears *somewhere* in the Routematic articles. A common number like "30%" used in a different context still passes. The Step 7 judge will compare claims with the actual passages.
- **The style profile is based on one company** with 54 articles. Ranges like "5–10 sections" are only as reliable as that sample.
- **The length correction (0.78)** was measured on a handful of articles with one model.
- **There's no scoring yet**, so "reads like Routematic" is currently judged by reading the output, not by a number. Step 7 adds the scores.

---

## 7. What comes next

| Step | What it will add |
|---|---|
| 7 — Evaluator | Scores for structure, style, relevance, completeness, tone, readability and specificity, plus written weaknesses with quotes as evidence |
| 8 — Calibration | Proof that the scores mean something: real Routematic articles should score high and a generic AI article low |
| 9 — Feedback loop | A person's feedback becomes clear instructions, the article is revised, and the system checks each instruction was followed |
| 10 — Web interface | The whole flow in a browser: brief → article → scores → feedback → improved article → side-by-side comparison |
| 11–12 | The before/after demo and the final README |

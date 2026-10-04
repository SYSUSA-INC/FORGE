# 09 — True AI platform or AI wrapper? (2026-10-04)

> The owner's question: is FORGE a TRUE AI platform or an AI wrapper?
> The goal is a platform that:
> - reads a solicitation accurately;
> - learns from every interaction, separately for each organisation;
> - outperforms anything comparable on the market;
> - eventually produces proposals without human intervention.
>
> This assessment re-reads the code after the BL-AIP program (audit 08)
> and everything shipped since. It also surveys the market and proposes
> the program that would close the gap.

## 1. The answer

**FORGE is not an AI wrapper. It is not yet a true AI platform either.**
The fairest description today is *an AI application with real platform
foundations*.

Two tests separate the two:

1. **Take the model away: what is left?** A lot, and it is real:
   - a domain data model covering capture through submission;
   - a hard compliance export gate;
   - a calibrated PWin model graded by Brier score;
   - a per-tenant knowledge base (the "Brain") labelled by outcome, with hybrid vector and full-text search;
   - voice profiles for each author;
   - a durable job queue;
   - one AI gateway that meters, routes and logs every call.

   A wrapper has none of this. FORGE's output is already shaped by each
   tenant's data, not just by the model.
2. **Is the intelligence ours?** Not yet.
   - **Single prompts.** Every AI capability is one prompt and one answer
     from a vendor model. The model does all the reasoning, in one pass,
     with no planning, no checking of its own work and no revision.
   - **No structured view of the solicitation.** FORGE has no model of
     the solicitation's structure (Sections L, M and C), no requirement
     with a page reference, and no measured accuracy anywhere.
   - **Shallow learning.** "Learning" means placing tenant data into the
     next prompt. Nothing tunes itself, nothing is checked against
     results, and the main signal that measures AI quality is flawed
     (§4.3).

So FORGE has done the hard, unglamorous groundwork that most "AI
proposal tools" skip. It has not yet built the parts that would make it
the leader:
- a structured understanding of solicitations;
- an agent that plans, drafts, scores and revises;
- learning that compounds per tenant and can be shown to improve results;
- accuracy we can measure and publish.

### Scorecard

Ratings are 0–5; each review defines its scale in §4. "Frontier" is
the best claimed in the market (§5). No vendor claim was independently
checked.

| Dimension | FORGE today | What 5 looks like | Market frontier |
|---|---|---|---|
| Solicitation understanding | **2** | L/M/C modelled as structure; every requirement cited to page and paragraph; crosswalk; measured recall; learns from corrections | ~3 (claimed: whole package to matrix and outline in under 60 s; "95% accurate", self-reported) |
| Proposal autonomy | **3 (low end)** | Notice → package ready to submit; people only at gates | ~3 (claimed: volume drafts "60–70% complete"; humans in the loop by design) |
| Learning per tenant | **2** | Per-tenant preference memory, outcome-chosen examples, evaluation-driven tuning, adapters | ~1–2 ("trains on past proposals"; nobody shows learning from edits or outcomes) |
| AI engineering foundations | **2.5** | Resilient model layer that works with any provider, routed by data policy; durable workflows; evaluations block releases | Unknown; competitors don't publish this |
| Measurement and evals | **1** | Gold sets in CI, published benchmark, online quality trends | **0 published** — the biggest opening |
| Trust, safety, data governance | **1.5** | Every claim checked; prompt-injection defences; CUI/ITAR routing; FedRAMP | Security authorizations (FedRAMP Moderate/High by inheritance) are the market's moat |

## 2. What changed since September (credit where due)

The BL-AIP program and the BL-FB features closed much of what audit 08
found:

- **Hand-offs fixed.** AI edits arrive as tracked changes from "FORGE
  AI". The editor shows what the AI wrote. Exports and AI input use the
  final text (pending suggestions resolved).
- **Requirements-first pipeline.**
  - Requirements are now swept from the full text in windows; they used
    to be "top 25 from the first 80k characters".
  - The compliance matrix is seeded automatically and auto-mapped.
  - The drafter gets its section's requirements word for word.
  - The export gate truly blocks.
  - Citations are on by default and checked by a verifier.
- **Brain.**
  - Hybrid retrieval: vector plus full-text search, merged by rank
    fusion, with outcome, kind, recency and quality boosts.
  - HNSW indexes.
  - Outcome labels actually reach harvested proposals and approved
    entries.
  - Files are stored in R2.
  - A durable background job queue recovers stuck jobs.
- **Proactive AI.** A nightly scout, nightly PWin snapshots and "movers",
  stored and graded briefs, AI colour-team pre-review, and onboarding
  from a UEI.
- **Learning loops.** Of the 14 half-finished loops in audit 08:
  - 2 are now fully closed;
  - 3 are partly closed;
  - new closed loops exist: author voice profiles, scout decisions, and
    debrief weaknesses and winner gaps reaching the drafter.
- **Control.** A per-tenant AI Engine panel (model class per feature,
  monthly budget, burn-down) and a golden evaluation keyed by prompt
  version.

## 3. Defects to fix now

These are bugs, not strategy. Rows marked **[confirmed]** were re-read
in the source while writing this report. One was reproduced by running
the same similarity function. The rest are reported by one of the four
code reviews, with file:line.

| # | Defect | Evidence | Impact |
|---|---|---|---|
| 1 | **[confirmed, reproduced]** The duplicate filter merges requirements that differ only in a number or qualifier. Similarity scores: "Technical Volume shall not exceed 30 pages" vs "Management Volume … 15 pages" = 0.75; "Secret" vs "Top Secret facility clearance" = 0.88; "monthly" vs "weekly status report" = 0.75. The threshold is 0.6, so the second of each pair is dropped. | `requirements-text.ts:92-126` (the tokenizer ignores tokens of 2 characters or fewer, so "30" and "15" vanish); used in 4 merge paths | **Page limits and clearance requirements disappear without trace** |
| 2 | **[confirmed]** The pass that produces the Section L/M summaries and key dates reads only the first 80k characters. The comment claims that covers L and M "of nearly every RFP", but in the standard federal format (Uniform Contract Format) L and M are Part IV, at the end. | `ai-prompts.ts:81-83` | The drafter, outline and scan get Section L/M summaries from the wrong part of the document |
| 3 | **[confirmed]** The requirement sweep stops at 12 windows (about 700k characters). Only the first 400 requirements are kept. Nothing tells the user. | `requirements-text.ts:49`; `solicitation-extract.ts:196` | Long RFPs lose their end, where L and M sit |
| 4 | **[confirmed]** The health-scan cron skips a proposal whose tenant has no access to the feature or is over quota, without backoff and without clearing the flag. It takes the 5 oldest each run, so 5 such proposals block background scans for **every tenant**. | `proposal-scan-cron.ts:100-121` | Background scans can stop platform-wide |
| 5 | **[confirmed]** "Auto-draft proposal" is a loop in the browser and stops if the dialog closes. It overwrites sections with no snapshot, saves drafts that were cut off at the output limit, and never queues a health scan. | `AutoDraftButton.tsx:72-148`; `auto-draft-actions.ts:201-215`; `markScanDirty` only in `proposals/actions.ts:823` | Unreliable at proposal scale; nothing checks the result |
| 6 | **[confirmed]** The red-team pre-review prompt says it scores "against Section M", but Section M is never passed to it. | `ai-prompts.ts:244` vs `review-preflight.ts` | The pre-review cannot score against the evaluation criteria |
| 7 | **[confirmed]** Edit learning cannot tell the AI's suggestions from people's. `isAiAuthor` is defined and never called. "Accept all" on FORGE AI text teaches the drafter its own phrasing as the team's preference. | `tracked-diff.ts:42`; `edit-feedback.ts:66-89`; `edit-feedback-summary.ts:116-120` | The learning loop feeds on itself |
| 8 | **[confirmed]** The "accepted" share of AI text is word-set overlap: any AI word found anywhere in the saved text counts as kept, and common words match. It is graded at the first save, and that number is shown to the drafter as "how much this team keeps". | `draft-signal.ts:11-20`; `proposals/actions.ts:833-841` | The main measure of AI quality is inflated |
| 9 | **[confirmed]** Compliance rows marked not-applicable are still sent to the drafter as "MUST be addressed". | `section-draft.ts:150-164` (no status filter) | Drafts address things they shouldn't |
| 10 | **[confirmed]** The only prompt-injection guard covers teammates' chat notes. RFP text, Brain passages and SAM.gov text go into prompts with no "this is data, not instructions" boundary. Extracted text becomes "MUST address" rows in the drafter. | `chat-mentions.ts:103` is the only guard | Text hidden in a document can steer drafting; the nightly scout reads SAM.gov text with no human in between |
| 11 | **[confirmed]** The ITAR flag is never read by the AI layer. ITAR-restricted tenants' documents go to the same commercial endpoints as everyone else's. | `itarRestricted` is read only by admin and invite code | Compliance exposure for regulated customers |
| 12 | The citation verifier checks only sentences that carry a citation marker. An invented fact with no marker passes, and the export gate counts only `[NEEDS CITATION]`. | `citations.ts:81`; `citation-verify.ts:36`; `compliance-gate.ts:115` | Grounding can be bypassed simply by not citing |
| 13 | Model and embedding calls have no timeout, retry, backoff or provider fallback. A hung call is killed by the function time limit, so no telemetry row is written and the quota is not refunded. | `ai.ts:341-349,502-506`; `embeddings.ts:184-195` | A single provider error reaches the user as a failure |
| 14 | An uploaded amendment never gets the opportunity link, so it never reaches the matrix, drafter or Q&amp;A flagging. Non-Q&amp;A SAM.gov attachments are marked "seen" and dropped. | `solicitations/actions.ts:94-107`; `solicitation-qa.ts:214,222` | Amendments, the commonest late change, don't flow through |
| 15 | The golden evaluation is contaminated and drifts. The case's own harvested text and review comments reach the evaluation draft, and the case set reorders by `updatedAt`. | `golden-eval.ts:84,132-138` | The only quality score is not trustworthy |

## 4. Findings by area

### 4.1 Reading the solicitation — 2 / 5

Scale used: 0 = cover-page facts only · 1 = AI summaries · 2 = a flat
list of requirements from the text, feeding a matrix and the drafter ·
3 = a structured model of Sections L/M/C with citations and human
checking · 4 = an L↔M↔C crosswalk, measured accuracy, and amendments and
Q&amp;A carried through · 5 = a shredder that learns from corrections.

**Strong:**
- Windowed sweep over the full text, with split-and-retry when a
  window's answer is cut off.
- Handles DOCX, XLSX, PPTX, PDF, plus vision for scans.
- One loader feeds every consumer of the requirements.
- The matrix is seeded idempotently (up to 400 rows) and auto-mapped.
- Parsing runs as a durable job.
- Deterministic Q&amp;A ingestion and matching.

**Missing (what "deciphering accurately" actually needs):**
- **No structure.**
  - Section M factors, sub-factors and their relative importance are
    not modelled.
  - There is no volume hierarchy with page and format rules (font and
    margins end up in a free-text note), no CLINs, no clause list, no
    key-personnel or past-performance rules.
- **No L↔M↔C crosswalk.** Nothing ties an instruction to its evaluation
  factor and to the PWS task.
- **No provenance.**
  - A requirement is `{kind, text, ref, sourceDocId}`: no page, no
    paragraph, no offset.
  - Nothing checks that the extracted sentence actually appears in the
    source, so a made-up requirement goes undetected.
- **No human checking, no learning.**
  - The requirement list is read-only.
  - Matrix edits are audited but never fed back.
  - A deleted false positive comes back on the next re-seed.
- **No accuracy measurement at all.** No gold set, no precision or
  recall, and extraction calls carry no prompt version.
- **Scans and companion documents.**
  - A scanned PDF gets one vision call: up to 50 requirements, no sweep.
  - Companion documents' L/M summaries are written but read nowhere.

### 4.2 Producing the proposal — low 3 / 5

Scale used: 0 = manual · 2 = AI does single steps on request · 3 = AI
drafts a whole work product on request, but people move every stage ·
4 = stages chain in the background, the AI checks and revises its own
work, people approve at gates · 5 = from SAM.gov notice to a package
ready to submit, people only at gates.

| Stage | Today | Hands off to the next stage? |
|---|---|---|
| Discovery and triage | Automatic (nightly scout) | No — import is a click, and the notice's documents are not pulled |
| Bid / no-bid | AI-assisted (PWin nightly, brief on click) | No |
| Solicitation intake | Upload is manual; parse and sweep are automatic | Partly — review, capability matrix and questions are each a click |
| Outline from Section L | One click (when creating the proposal) | Yes, into matrix seeding and auto-map; **not into drafting** |
| Drafting | One click per section, or a browser loop | No |
| Compliance | Seeding and mapping automatic; pre-flight a click; rows accepted **one by one** | No |
| Review | Person starts it; the AI pre-review then runs | Findings become comments, never revisions |
| Revision | AI-assisted (tracked changes) | Never automatic |
| Graphics | One click; Word export drops images | No |
| Pricing | Not found | — |
| Assembly / export | Manual, behind the hard gate | — |

The drafter's prompt is rich: about a dozen tenant signals, requirements
word for word, voice, house style, the customer's own phrasing, and up
to 10 sources. But:

- **One call.** Each draft is a single call capped at 2,200 output
  tokens (about 4.7 pages). Nothing continues a draft that hit the cap.
  Output is plain paragraphs: no headings, lists or tables.
- **No agent loop.** There is no plan, no score, no revision, and no
  awareness of other sections. Every call forces exactly one tool, and
  no tool result ever goes back to the model.
- **Gates are manual.** The compliance gate is the biggest workload:
  rows are accepted one at a time, up to 400 rows.

### 4.3 Learning per tenant — 2 / 5

Scale used: 0 = nothing captured · 1 = captured and displayed · 2 =
injected into prompts as context and statistics, with rules set by hand ·
3 = measured correctly, examples chosen by outcome, trends drive
decisions · 4 = prompts, retrieval and variants chosen automatically per
tenant · 5 = the model itself adapts per tenant under continuous
evaluation.

- **Mechanisms.**
  - Present: retrieval memory, aggregate numbers in prompts, crude
    example selection.
  - Absent: automatic tuning of any kind (the only exception is the
    1-parameter PWin calibration), bandit or A/B auto-selection,
    evaluation-driven prompt optimisation, preference or adapter
    training.
  - `ai_call_log` stores no prompt or response, so no training dataset
    exists.
- **The quality signal is broken** (defects 7 and 8), and the model's
  own text leaks into voice profiles and "winning patterns".
- **Retrieval doesn't learn from use.**
  - Inserted passages are never credited to their source.
  - The boosts are constants.
  - Past performance given to the drafter is the first 3 rows, not the
    most relevant.
- **The knowledge model is documents plus vectors**, not entities.
  - No structured personnel (clearances, labour categories).
  - No pricing or rate history.
  - No contract ↔ agency ↔ person ↔ capability links.
  - No library of themes and their win rates.
- **No trend shows the AI improving for a tenant.** There is no
  acceptance trend, no AI-to-final edit distance, and no gating by
  evaluation.
- **Isolation is clean.** Every learned artifact is scoped by
  organisation. Nothing is shared across tenants.

### 4.4 Engineering foundations — 2.5 / 5

Scale used: 2 = a governed gateway (metering, routing, structured
output, tenant caps) · 3 = reliable and measurable (timeouts and
retries, provider fallback, versioned prompts, evaluations in CI) · 4 =
adaptive (evaluations block releases, per-tenant provider and residency
routing, durable workflows).

- **Platform-grade:**
  - One gateway with a required feature key on every call; 27 model
    features.
  - Per-feature model class with tenant overrides.
  - Forced structured output validated by schema.
  - Tenant isolation in vector queries enforced by a static check.
  - Hybrid retrieval.
  - Citation verification.
- **Adequate:**
  - The durable job table covers only 3 job kinds and drains 3 jobs
    per 5 minutes.
  - Nine prompt-version constants exist, and 26 call sites pass one.
    Requirement extraction, chat, health scan, auto-map and pre-review
    pass none (**[confirmed]**).
  - Telemetry has no stop reason, cost per model or latency
    percentiles.
- **Wrapper-grade or missing:**
  - No resilience: timeouts, retries and fallback.
  - One provider is chosen globally; Bedrock still throws.
  - Prompt caching is mostly a no-op: system prompts are below the
    caching minimum, and the large shared RFP text carries no cache
    marker.
  - No Batches API for nightly work (Anthropic confirms 50% savings).
  - No agent framework.
  - No ITAR/CUI routing or data-retention configuration.
  - Changing the embedding model would mix incompatible vectors.
- **Model generation.** Defaults are `claude-sonnet-4-6` and
  `claude-haiku-4-5`. Anthropic's current model list prices Sonnet 5.5
  at $2/$10 per million tokens, Opus 5.5 at $4/$20 and Haiku 4.5 at
  $1/$5. Sonnet 4.6 is listed as legacy. The engineering review also
  reported that newer models reject `temperature` and forced
  `tool_choice`, which the gateway sends on every call. **I could not
  confirm that in Anthropic's docs**, so treat it as something to test
  before upgrading, not as fact.
- **Scale limits:**
  - Scout: 25 tenants a day.
  - PWin snapshots: 40 tenants a day.
  - Brain indexer fallback: 12 extractions a day, platform-wide.
  - A 12-window sweep in sequence probably exceeds the 300-second
    function limit (inference).

## 5. The market (sourced, with caveats)

The market review could read only search summaries (direct page reads
were blocked). None of the claims below were independently checked, and
several comparison pages were written by competitors. Treat this as
orientation, not evidence.

- **Consolidation in 2026:**
  - Procurement Sciences bought Rogue (Feb).
  - Vultron's customers moved to pWin.ai (Apr).
  - GovSignals bought Turingon (Jul).
  - GovDash raised a $30M Series B (Jan), reports about 200 customers,
    and is positioning as the "AI infrastructure layer" for government
    contracting.
- **What everyone now claims:**
  - Shredding a solicitation into a matrix and outline in minutes.
  - Drafts of whole volumes grounded in the customer's content.
  - AI review against Section M or custom criteria.
  - Agents with "memory" and "skills" (GovDash).
  - The most candid figure is drafts "60–70% complete" (Vultron, before
    its exit). Every serious vendor keeps people in the loop.
- **The moat they are building is security authorization**, usually
  inherited from someone else's boundary:
  - High: GovSignals and AutogenAI (Palantir FedStart).
  - Moderate authorizations: Procurement Sciences and Sweetspot (via
    Knox).
  - Many others have "Ready" or "Equivalency", which is not the same
    thing.
- **What nobody shows:**
  - A published, reproducible accuracy benchmark.
  - Learning from edits, debriefs or win/loss results.
  - A review score checked against real government ratings.
  - Automatic verification of every factual claim.
  - Consistency held across a 100-page volume.
- **The government is starting to evaluate with AI.** The Army's
  AI-assisted $449M White Sands award survived a protest, but the judge
  criticised how the AI use was disclosed. Legal exposure runs the
  other way too:
  - False Claims Act risk from AI-generated falsehoods.
  - GAO dismissed protests built on made-up citations.

**FORGE's relative position.** FORGE trails the leaders on breadth of
packaging and on security authorization. It is ahead, or alone, in
depth that the market doesn't claim:
- calibrated PWin;
- retrieval labelled by outcome;
- learning from edits;
- per-author voice;
- a hard export gate with citation verification.

**Those are exactly the seeds of the four things nobody has built:
measured accuracy, real learning loops, calibrated scoring, and checking
every claim.** That is where FORGE can leapfrog. Matching the current
feature list will not get it there.

## 6. What "a true AI platform" means for FORGE

Six properties. Each one is testable.

1. **It understands the domain, not just the text.** It holds a
   structured model of the solicitation and the proposal, and every
   requirement traces to page and paragraph.
2. **It owns a data flywheel.** Every interaction and outcome is
   captured as clean, labelled signal, and that signal measurably
   changes outputs per tenant.
3. **It measures itself.** Gold sets and evaluations gate every change,
   and online metrics show quality trending up per tenant.
4. **It does the work, not just a step.** Agents plan, draft, check,
   score and revise across a whole volume, and people approve at gates.
5. **It is trustworthy by construction.**
   - Every claim is checked.
   - Untrusted text is handled as data.
   - Data is routed by policy (CUI/ITAR).
   - Every AI action is audited.
6. **It works with any model.** Models are interchangeable parts behind
   a resilient, measured layer, so FORGE gets better with every model
   generation instead of being disrupted by it.

## 7. Target architecture

```
                    ┌──────────────────────────────────────────────┐
  SAM.gov / eBuy →  │ 1. Solicitation Intelligence Engine          │
  uploads / Q&A  →  │  segment → L/M/C model → requirements with   │
  amendments     →  │  page/para provenance → crosswalk → conflicts│
                    │  & questions → amendment deltas → verify UI  │
                    └──────────────┬───────────────────────────────┘
                                   │ structured solicitation
┌──────────────────────────┐      ▼
│ 2. Tenant Knowledge Graph │  ┌────────────────────────────────────────┐
│ contracts/CPARS, people,  │→ │ 3. Proposal Agent (durable workflow)   │
│ capabilities, claims with │  │ plan/storyboard → draft (parallel,     │
│ evidence, themes+win rate,│  │ tool-using) → verify claims → score vs │
│ pricing, agencies, rivals │  │ Section M → revise → volume consistency│
└──────────────────────────┘  │ → render & page-fit → package          │
                               │ human gates: bid · outline · red · sign│
                               └──────────────┬─────────────────────────┘
                                              │ every decision & outcome
              ┌───────────────────────────────▼─────────────────────────┐
              │ 4. Learning layer (per tenant, isolated)                 │
              │ preference memory from edits · outcome-selected exemplars│
              │ · evaluator calibrated on debriefs · bandit over prompts/│
              │ models · optional per-tenant adapters on open models     │
              └───────────────────────────────┬─────────────────────────┘
              ┌───────────────────────────────▼─────────────────────────┐
              │ 5. Evaluation & trust layer                              │
              │ gold sets in CI · online quality trends · claim checks · │
              │ injection defence · CUI/ITAR routing · audit             │
              └───────────────────────────────┬─────────────────────────┘
              ┌───────────────────────────────▼─────────────────────────┐
              │ 6. Model layer: retries, fallback, capability table,     │
              │ caching, batches, per-tenant routing by data policy      │
              └──────────────────────────────────────────────────────────┘
```

**Isolation is absolute, including for learning** (owner decision,
2026-10-04). Solicitations are public documents, so learning across
tenants from corrections to public RFP text was considered. It was
**rejected**: any path that moves learned signal between tenants opens
a hole in the isolation boundary. Every learned artifact in the layers
above (extraction corrections, preferences, examples, evaluator
calibration, retrieval weights) is scoped to one organisation.

The only cross-tenant asset is the extraction **gold set**. It is
built by FORGE from public SAM.gov RFPs, drafted by AI and reviewed by
the owner's proposal expert. It is used only to measure accuracy, is
never trained on, and contains no tenant data.

## 8. "Proposals without human intervention": an honest position

Full autonomy for competitive best-value technical volumes is not
credible today, for FORGE or anyone else. The reasons are:
- **Quality ceiling:** the best market claim is drafts "60–70%
  complete".
- **Long-output limits:** long-form generation loses coherence beyond a
  few thousand words without planning.
- **Liability:**
  - False Claims Act exposure for false statements;
  - representations and certifications that someone must sign;
  - GAO's dismissals over made-up citations.

The right target is **"autonomous by default, human by exception"**,
reached step by step by type of response:

| Rung | Response type | Autonomy target |
|---|---|---|
| A | RFIs, sources-sought, capability statements | Package fully generated; one person approves before sending |
| B | eBuy / GSA RFQs, task orders under IDIQs held, recompetes | Full draft plus self-scoring; people review exceptions flagged by the evaluator and claim checker |
| C | Full-and-open best-value proposals | AI writes the whole volume and scores it; people own strategy, the outline gate, red team and sign-off |

**North-star metric: the autonomy rate.** That is the share of
submitted text written by FORGE AI and accepted without a human edit,
together with human hours per response. It needs defects 7 and 8 fixed
first, because today's acceptance number can't measure it.

## 9. Proposed program — BL-AIX ("AI platform, next generation")

Strictly serial, one PR per slice, each under 1,500 lines. Phases 1 and
2 come first because the owner named reading the solicitation as the
first step, and nothing else can be measured until evaluation exists.

**Phase 0 — Correctness (about 1–2 weeks).** Fix defects 1–11 and 14 in
§3:
- number-aware duplicate filtering, plus a record of deletions so a
  re-seed doesn't bring them back;
- the scan-cron stall;
- auto-draft on the server as resumable jobs (snapshot, truncation
  check, queue a scan);
- give Section M to the pre-review;
- separate AI from human authors in edit learning;
- an accurate AI-acceptance number;
- filter not-applicable rows from the drafter;
- a "data, not instructions" wrapper on every prompt that embeds a
  document;
- a coverage banner when a sweep is cut short;
- link amendments to their opportunity.

**Phase 1 — Measure and harden (about 3–4 weeks).**
- An **extraction gold set**: 15–20 public SAM.gov RFPs annotated by a
  proposal SME. It must include RFPs in the standard federal format over
  200 pages, scans and multi-attachment packages. Score:
  - recall and precision of "shall" statements;
  - page-limit and format accuracy;
  - Section M factor, order and weight accuracy.

  Run it in CI per prompt version.
- Retrieval recall@k evaluation; a fixed, uncontaminated golden draft
  set with a rubric judge calibrated against SME ratings.
- A prompt version on every feature, with a hash test so a changed
  prompt must bump its version.
- Gateway resilience: the official SDK or equivalent timeouts and
  retries, a concurrency limiter, a provider fallback (finish Bedrock),
  and a per-model capability table.
- Move to current models behind evaluations.
- Cache markers on the large shared context; the Batches API for
  nightly work.

*Exit:* extraction recall is reported per prompt version, and a
regression blocks the merge.

**Phase 2 — Solicitation Intelligence Engine (about 4–6 weeks).**
- Section segmentation by rules (Uniform Contract Format B–M,
  attachments, PWS headings) before chunking.
- Dedicated structured passes over L (volumes, page and format rules)
  and M (factors and sub-factors with order and relative importance).
- `solicitation_requirement` rows with document, page and offset, and a
  check that the quoted text exists in the source.
- An L↔M↔C crosswalk; conflict and ambiguity detection feeding drafted
  questions to the contracting officer.
- A verify/edit/reject screen whose every correction is recorded as
  labelled data inside that tenant only. The corrections improve that
  tenant's extraction, never another's.
- Amendments diffed on the source text and carried into the matrix,
  re-opening affected rows.
- Automatic import of SAM.gov attachment packages (ZIP included).

*Exit:* at least 98% "shall" recall and 100% page-limit accuracy on the
gold set, with the remaining errors visible and correctable.

**Phase 3 — Proposal Agent v1 (about 6–8 weeks).**
- A durable server workflow: bid decision → outline (gate) → storyboard
  (talking points per section, themes and discriminators, a shared fact
  sheet) → parallel section drafts with a retrieval tool → claim checks
  on every factual sentence → score against Section M → revise up to N
  rounds → volume-wide consistency pass → render and page-fit check →
  package.
- Long sections drafted in parts, with continuation; structured output
  (headings, lists, tables).
- Compliance verdicts accepted automatically above a confidence
  threshold, so the gate needs a person to sign off rather than 400
  clicks.

*Exit:* Rung A responses produced end to end; Rung B drafts with
self-scores and a list of flagged exceptions.

**Phase 4 — Tenant Knowledge Graph (about 4–6 weeks).**
- Structured contracts and past performance (CPARS), people (clearances,
  labour categories, resumes), capabilities, a claims library with
  evidence, themes with win rates, pricing history, agencies and
  competitors.
- Retrieval over the graph plus hybrid search.
- Relevance-chosen past performance and staff in drafts.

**Phase 5 — Learning layer v2 (about 4–6 weeks).**
- Preference memory learned from edits, per tenant, per section kind and
  per author: rules written as text from accept/reject patterns
  (CIPHER-style, no fine-tuning).
- Examples chosen by outcome and survival.
- Retrieval weights fitted on "inserted and kept".
- An evaluator calibrated against debrief ratings and outcomes.
- A bandit over prompt variants and model classes per tenant, with
  evaluations as guardrails.
- Optional per-tenant adapters on open-weight models (vLLM or Bedrock)
  for tenants who opt in, with consent-based prompt/response logging.

**Phase 6 — Governance and scale (runs alongside, with operator
work).**
- CUI/ITAR tenants routed to GovCloud endpoints (Bedrock GovCloud or
  Azure Government) for completions and embeddings.
- Documented data retention.
- Redaction hooks.
- Fair, parallel job scheduling.
- A FedRAMP path, probably by inheriting another provider's boundary as
  competitors have.

## 10. Metrics that prove "true AI platform"

| Metric | Today | Target |
|---|---|---|
| Requirement recall on the gold set | Unmeasured | ≥ 98% (page limits: 100%) |
| Requirements with source page/paragraph | 0% | 100% |
| Autonomy rate (AI text submitted unedited) | Unmeasurable (defects 7–8) | Rung A: ≥ 90%; Rung B: ≥ 60% |
| Human hours per response | Not tracked | Tracked; −50% in year 1 |
| Factual sentences verified against a source | Cited sentences only | 100% of factual sentences |
| Evaluator vs debrief rating correlation | n/a | Measured; a rank correlation of ≥ 0.6 before the score is shown to customers |
| Acceptance trend per tenant over time | None | Rising, shown per tenant |
| Win rate of FORGE-assisted bids vs the tenant's baseline | Not tracked | Tracked per tenant |

## 11. Decisions for the owner

Decided on 2026-10-04:
1. **Autonomy first for Rung A** — RFIs and sources-sought responses.
2. **Gold set:** AI drafts the annotations of 15–20 public SAM.gov
   RFPs; the owner's proposal expert reviews them (about half a day
   per RFP).
3. **No cross-tenant learning of any kind**, not even from public
   solicitation text (see §7).
6. **API Slice 2c (webhooks) is parked.** BL-AIX Phase 0 starts now.
   Slice 2b shipped in PR #334.

Still open:

4. **Regulated customers:** do we serve CUI/ITAR tenants in the next 12
   months? If so, GovCloud routing and an inherited FedRAMP boundary
   move up.
5. **Prompt/response logging** with consent, to make per-tenant
   preference training possible later?

## Appendix — method and caveats

- Four read-only code reviews (solicitation, autonomy, learning,
  foundations) at HEAD `d694f07`, each with file:line evidence, plus a
  web review of the market. This report's author re-read every row
  marked **[confirmed]**; one was reproduced by running the same
  similarity function.
- Ratings use the scales stated in §4 and are judgements, not
  measurements. Phase 1 exists to replace them with numbers.
- **Market claims:** the reviewer could read only search summaries,
  because the network blocked direct page reads. No vendor capability
  was independently checked.
- **Claude API points:** the prices and the 50% Batches discount were
  confirmed from Anthropic's docs. The parameter-rejection claim was
  not.
- Inferences rather than observations are labelled as such in the text:
  HNSW recall under tenant filtering, the 300-second limit on a long
  sweep, and the acceptance score near 1.0.

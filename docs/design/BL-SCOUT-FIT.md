# BL-SCOUT-FIT — Plan: design for review

**Status:** proposed, awaiting the owner's answers in §4. Nothing is built.
**Backlog:** BL-SCOUT-BACKFILL (3bu), item C; item D (BL-SCOUT-SHOWN) is
the second delivery step here. **Shape:** the same as
`BL-NAV-LIFECYCLE_PHASE4_PLAN.md`.
**Owner's ask (2026-11-10):** "People want opportunities relevant to
their capabilities." **Owner decision:** no wider net by PSC or related
NAICS; relevance first, nothing crossing the company's own codes.

## 1. What FORGE already has

| Piece | Where today | What it gives fit |
|---|---|---|
| The heuristic score | `scoutFit` (`src/lib/scout-logic.ts`): NAICS primary +25 / listed +15 / outside −10, set-aside eligibility +10 / −30, recompete of a won pursuit +25, customer history, keyword strength; stored as `scout_candidate.fit_score` (0..100) and `signals` | Eligibility and history, but it never reads what the company *does*: a notice in the right code about work the company has never done scores the same as one it could win |
| The approved company model | `getApprovedCompanyModel` (`company-model-read.ts`): summary, up to 12 capabilities each `proven` / `unproven` / `partial` with evidence ids, `naicsWork` per code, customers, differentiators, gaps, partners, keywords | The company's own account of its work, already human-approved |
| What the company has done and won | `knowledge_entries` (kind capability / past_performance), past performance records, decided pursuits (won / lost, agency, NAICS) feeding the model (`company-model-inputs.ts`) | Evidence, and the won/lost signal (`outcomeBoost` in `brain-rank.ts`) |
| The brain | `searchBrain` (`brain-retrieval.ts`): hybrid vector + full-text over corpus chunks and curated entries, fused and boosted by outcome; `embedBatch` (`embeddings.ts`, OpenAI `text-embedding-3-small` or a stub when no key); vectors already stored for entries and artifacts | Retrieval by meaning, per tenant (every query takes `organizationId`) |
| The AI triage | `queueTriageBatch` / `scoutTriageBatchHandler`: Pursue / Watch / Skip with a rationale, grounded in `capabilitiesOf` (the model, else four capability entries); at most `MAX_TRIAGE_PER_RUN` = 25 a run, in fit-score order; capped by `scoutTriageAllowance` (a fifth of the plan's monthly AI requests held back, `SCOUT_AI_RESERVE`) | The only place capability is read today, and only for the 25 best by the heuristic |
| The list | `filterFinds` / `defaultFindsFilter`: Recommended (Pursue + Watch) is the default; All leaves the AI's Skips out; Skipped holds them | A find the AI has not reviewed is outside the default view |
| The reach | #490: first run and **Search every open notice** read up to 8 pages per code, keep the 500 best by `scoutFit` | A large pool, ranked by the weakest signal |

**What's missing:** a score of each find against what the company can do,
available *before* the AI, for every find and at no AI-request cost; a
shown set decided by it; and a count of what that hid.

## 2. The design

### 2.1 Capability cards (once per run, per tenant)

Build a short list of *capability cards* from the tenant's own data:

1. each capability of the approved company model (`name + description`),
   each `naicsWork` line, and the summary;
2. each past-performance record and each **won** pursuit
   (title + agency + description), marked as evidence of the strongest
   kind;
3. with no approved model: the tenant's capability knowledge entries and
   past performance (the `capabilitiesOf` fallback); with none of those,
   no fit is computed and the run note says why (the find is shown with
   "fit not scored", never penalised).

Cards are embedded in one `embedBatch` call (a few dozen texts) at the
start of the run and held in memory. Nothing is stored for other runs and
no vector leaves the tenant.

### 2.2 Scoring a find

Each find's text (title, agency, description to `SCOUT_DESCRIPTION_CHARS`)
is embedded in batches (`embedBatch`, 100 a call) and compared with every
card by cosine similarity, in memory: no per-find database round trip, so
a 500-find backfill costs 5 embedding calls and a few milliseconds of
arithmetic. The result, `capabilityFit` 0..100, is the best card's
similarity mapped through two thresholds (§4.5) onto bands:

| Band | Meaning | Effect on rank |
|---|---|---|
| Strong | close to a proven capability or a won pursuit | +20 |
| Related | close to a claimed or partial capability | +5 |
| Weak | close to nothing the company does | −20 |

The closest card's name and similarity are kept as the *basis* (
"Closest: Cloud migration, proven, 0.71"), and shown on the find, so a
person sees why, and the model's `gaps` list can veto: a find closest to
a stated gap is capped at Related.

With the stub provider (no embedding key) there are no meaningful
vectors: fit is not scored, as with no cards.

### 2.3 How it combines with `scoutFit`

`scoutFit` stays what it is (eligibility, codes, set-aside, recompete,
customer, keyword) and is not rewritten. `fit_score` becomes
`clamp(scoutFit + band adjustment, 0, 100)`; the signals list gains one
line for the capability basis. Eligibility still dominates: a set-aside
the company cannot take (−30) is not rescued by a strong capability.
Because `fit_score` already orders the list, the triage's 25 slots
(chosen "best first") start going to the finds closest to what the
company does, and the 500-find backfill cap keeps those rather than the
best keyword hits.

### 2.4 What happens to a weak fit

A Weak find is **hidden by default but counted, never dropped**: it
stays a `scout_candidate` row (status `new`), leaves the default view and
the AI triage queue, and is listed under a new **Weak fit** filter with a
count on the tab ("37 weak fit, not shown"). The run note states the
number. A person can open Weak fit, import any find, and the choice is
learned from (`learningExamples`). A find that stays Weak and unreviewed
is cleared by the existing stale rules (`clearStaleFinds`), as any other.
The backfill's 500 cap counts Weak finds last, and the run note says how
many fell past the cap.

### 2.5 Cost and the AI quota

No new AI *request* is made: the embeddings are not metered against
`aiRequestsPerMonth` (`recordEmbeddingCall` logs them; the cost is
`text-embedding-3-small`, about two cents per million tokens, so a
500-find backfill is a fraction of a cent). The triage's fifth held back
by `scoutTriageAllowance` is unchanged. Weak finds leave the triage
queue, so the same allowance is spent on better finds.

### 2.6 Tenancy

Cards are built only from the tenant's `organization_id` rows; finds are
public SAM.gov notices already stored per tenant; the comparison runs in
memory inside `runScoutForOrganization` for one organization. No shared
index, no cross-tenant retrieval, no cache keyed by anything but the
organization. A new isolation test seeds two tenants with opposite
capabilities and checks each sees only its own bands.

### 2.7 Data

Migration 0168: `scout_candidate.capability_fit integer`,
`capability_band text`, `capability_basis text` (all nullable; null =
not scored), with the schema.ts declaration; `scout_run.weak_hidden
integer` for the count. No new enum value, no new index (the list is
filtered in memory over at most a few hundred rows as today).
`EXPECTED_LATEST_MIGRATION` moves to 0168.

## 3. Delivery (one PR each)

1. **C — BL-SCOUT-FIT:** `src/lib/scout-fit.ts` (cards, banding, pure
   and tested), the run integration and `rescoreWaitingFinds`
   re-banding when the model is re-approved, the basis on the card, the
   Weak fit filter and count, migration 0168, docs.
2. **D — BL-SCOUT-SHOWN** (after C merges): an **All, best first** view
   (Pursue, Watch, unreviewed and Related together by combined score),
   the default when few are recommended; "found N, shown M" counts on
   the tab; a run note saying where notices went (outside the codes,
   expired, passing mentions, weak fit, past the 500 cap, AI Skip).

## 4. Decisions for the owner

1. **Embeddings or the model.** Embeddings against capability cards,
   in memory (recommended: every find scored, no AI requests, pennies)?
   Or have the AI score every find (better prose, but a request per find
   or per batch, so the 500-find backfill would spend the plan's quota
   and could not run on every tenant)?
2. **What counts as the company's capabilities.** The approved model,
   plus past performance and won pursuits as the strongest evidence,
   with the capability entries as the fallback (recommended)? Or the
   model alone?
3. **How fit combines.** Adjust `scoutFit` by band (+20 / +5 / −20), keep
   one `fit_score`, eligibility still dominant (recommended)? Or show two
   separate scores?
4. **Weak fit.** Hidden by default under a **Weak fit** filter with a
   count, never deleted, out of the AI queue (recommended)? Or shown
   but ranked last, or removed outright?
5. **Thresholds.** Ship defaults (Strong at similarity 0.55 and above,
   Weak below 0.35), show the similarity on each find, and tune after
   the owner sends one tenant's run note (recommended)? Or calibrate
   first on a sample you provide.
6. **A tenant with no model, no entries and no past performance.** Skip
   fit, show every find as "fit not scored" and say so in the run note,
   nudging them to build the company model (recommended)? Or treat
   all finds as Weak.
7. **Gaps.** A find closest to a gap the model names is held to Related
   at best (recommended)? Or ignore gaps in the score.
8. **Per tenant only.** Confirmed as designed (2.6); no cross-tenant
   learning, including from other tenants' won pursuits (recommended).
9. **D inside this doc.** Keep D as the second PR here, after C merges
   (recommended), or write its own design doc.

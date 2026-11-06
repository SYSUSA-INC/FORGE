# Phase 2 — Evaluate: design for review

**Status:** proposed (2026-11-06), for the owner's review before any code.
**Requirements:** FORGE II footnote 5, E-1 to E-15 in
`docs/FORGE_II_REQUIREMENTS.md`. **Plan:** BL-NAV-LIFECYCLE phase 2.

> "Once the opportunities have been identified in the Identify stage, we
> will display them under this page, which will replace our current
> solicitation page. Each opportunity shown on this page must have two
> buttons associated with it: Analyze and Capability Matrix … the
> customer can review the provided reports to make a final decision on
> the opportunity and determine whether it is a GO, NO-GO, or PARTNER."

## 1. What FORGE already has

Evaluate doesn't start from zero. FORGE already has most of the pieces, spread across tabs:

| Piece | Where today | What it does |
|---|---|---|
| Win probability (PWin) | Opportunity → Overview, **PwinPanel** (`src/lib/pwin.ts`) | A calibrated score with its factors (NAICS, set-aside, history at the agency, recompete, capability coverage) |
| AI pursuit brief | Opportunity → Overview, **AI pursuit brief** (`src/lib/briefs.ts`) | Pursue, Watch or Consider no-bid, with signals and next actions, graded against outcomes |
| Qualification scorecard | Opportunity → Evaluation, **EvaluationForm** | Five 0–10 ratings and a rationale |
| Capability questionnaire | Opportunity → Evaluation, **CapabilityMatrixPanel** (`capability-matrix-*`) | The AI drafts questions from the solicitation's requirements. Six answers per question. Suggested answers from evidence. A coverage score, and a "partner needed" flag under 70% |
| Gate decision | Opportunity → Evaluation, **GateDecisionPanel** | Advance, no-bid or lost, with a reason, logged as activity |
| Solicitation AI review | Solicitations → a solicitation | The AI's review of the documents, Sections L and M, Q&A, key dates |
| Partners | Companies (relationship *teaming partner* / *subcontractor*), Company search (SAM.gov entities) | Your known partners, and a search for others |

**What's missing, in the document's terms:**
- the **Evaluate page** as the list with **Analyze** and **Capability Matrix** on each row;
- the **three answers** (Yes / No / Partial with a percentage);
- the two **reports** as documents you keep and open from the opportunity;
- the **GO / NO-GO / PARTNER** decision, with a required reason on No-Go and a partner list on Partner;
- the **Solicitations** page giving way to Evaluate.

## 2. The design

### 2.1 The Evaluate page (E-1, E-2)

The page at **Pipeline → Evaluate** lists every opportunity at Identified or Sources sought. Each opportunity is one compact row, in the same style as the Scout rows:

| Column | Shows |
|---|---|
| Opportunity | Title, agency, number, owner |
| Due | Days left (red under 5) |
| Analysis | PWin % and the AI's call once analysed, else **Analyze** |
| Capability | Coverage % (Yes / Partial / No counts) once built, else **Capability Matrix** |
| Decision | **Go / No-Go / Partner** once both reports exist; before then, the button says what's missing |

Filters: *Needs analysis*, *Needs matrix*, *Ready to decide*, *All*.

**Solicitations.** The **Solicitations** list moves under Evaluate.
- **Documents not yet on an opportunity** appear below the list, each with **Create opportunity from it**.
- **A solicitation's own page stays.** It becomes a *document* page, opened from its opportunity.
- **The menu item goes.** `/solicitations` redirects to Evaluate.

### 2.2 Analyze → the Analysis Report (E-3, E-4)

**Analyze** opens `/opportunities/{id}/analysis`. It runs, in one go:
- the PWin model, which takes no AI request;
- the AI pursuit brief;
- a short AI report that ties them together.

The report has these sections:
1. **Summary:** the call and why.
2. **Win probability** with its factors.
3. **Fit:** NAICS, set-aside, past performance at this agency.
4. **Competition:** the incumbent, known competitors, a recompete.
5. **Risks.**
6. **What would raise PWin.**
7. **Sources:** what FORGE read.

The report is **kept**: each run is a new version, dated, with who ran it. The latest shows on the opportunity as **Analysis Report**, and it prints or saves as a PDF. It uses one AI request, or two with the brief, under the plan's AI switch.

### 2.3 Capability Matrix → the Matrix Report (E-5 to E-8)

**Capability Matrix** opens `/opportunities/{id}/capability`, the existing questionnaire on a page of its own. The six answers become **your three**:

| Your answer | Stored as today | Notes |
|---|---|---|
| **Yes** | *have it* | A **Proven by past performance** tick keeps today's proven / unproven split, which PWin uses |
| **Partial** + **%** | *partial* + a new `percent` (5–95) | Coverage counts the percentage, not a flat 50% |
| **No** | *gap* | A **A partner could cover it** tick, with an optional partner from your Companies |
| (Not applicable) | *na* | Kept for requirements that don't apply |

Everything else stays:
- the AI still drafts the questions from the RFP / RFI;
- suggested answers still come from evidence;
- you still edit, add and remove questions.

The **Matrix Report** is a printable page. It shows each requirement with its answer, percentage and evidence, the coverage score, the gaps, and whether a partner is needed. It is kept as a dated snapshot each time you click **Save report**, and appears on the opportunity as **Matrix Report**.

No migration is needed: answers are already stored as JSON. The two reports get one table, `opportunity_report` (kind, version, body, who, when).

### 2.4 The opportunity's own page (E-9, E-14)

The opportunity page is already each opportunity's own page. Its Overview gets a **Reports** strip: **Analysis Report** and **Matrix Report**, each with its date, plus the decision once made. The reports stay there through Capture, Plan and Develop.

### 2.5 The decision: GO / NO-GO / PARTNER (E-10 to E-13, E-15)

The **Decision** panel replaces the gate panel on the opportunity and on the Evaluate row:

- **GO** moves the opportunity to **Capture** (stage *Qualified*), with a note.
- **NO-GO** asks for a **reason category** and a **reason in your words** (at least 20 characters). The categories are: scope, capacity, price, competition, timing, customer relationship, compliance, other. It cannot be saved without both. The opportunity closes (*No bid*), and the amendment watch stops. The reason feeds Lessons and Loss intelligence, so FORGE learns from it.
- **PARTNER** moves the opportunity to **Capture** marked *partner needed*, with:
  - **suggested partners from your own list:** Companies marked teaming partner or subcontractor whose NAICS codes and capabilities match the matrix's **No** and **Partial** answers, each with the reason it matched;
  - **Find more partners**, which opens Company search pre-filled with the NAICS codes. The full partner finder (FORGE's partner database, prioritised list, invitations) is phase 3, Capture.

**Every decision is recorded**, not overwritten, in a new table `opportunity_decision`. Each record has the decision, the category and reason, who decided and when, and the PWin and coverage at that moment. A changed decision is a new record, and the history shows on the Activity tab.

## 3. Delivery (one PR each, in this order)

1. **2a: the decision and the Evaluate page.** The Evaluate list and its filters, the Go / No-Go / Partner panel and its record, the No-Go reason, the amendment watch stopping on No-Go, partner suggestions from your list, and Solicitations folding into Evaluate.
2. **2b: the capability matrix.** Yes / Partial % / No, the page of its own, the Matrix Report.
3. **2c: Analyze.** The analysis page and the Analysis Report.

Each PR updates the manuals and the requirements trace.

## 4. Decisions for the owner

1. **Solicitations.** Remove the menu item and redirect `/solicitations` to Evaluate, with unlinked documents listed there and a solicitation page kept as a document page? (Recommended.)
2. **Yes.** Keep a **Proven by past performance** tick under Yes? PWin weighs proven capabilities higher; without the tick, every Yes counts as unproven. (Recommended: keep.)
3. **GO.** GO goes to **Capture** with PARTNER, as footnote 6 lists both there, and GO then moves on to Plan without the partner tasks. Or should GO skip Capture and go straight to **Plan**?
4. **NO-GO reason.** A category plus your own words (recommended), or your own words only?

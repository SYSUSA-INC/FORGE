# Phase 5 — Develop: design for review

**Status:** approved by the owner (2026-11-09, "all recommended") with every recommended answer in §4. Nothing is built yet; 5a follows, then 5b to 5d, one PR each. One open point: decision 2's search provider is not yet named (FORGE has none), and 5b waits on it.
**Requirements:** FORGE II footnote 8, D-1 to D-8 in
`docs/FORGE_II_REQUIREMENTS.md`. **Plan:** BL-NAV-LIFECYCLE phase 5.
**Shape:** the same as `BL-NAV-LIFECYCLE_PHASE4_PLAN.md`.

## 1. What FORGE already has

| Piece | Where today | What it gives Develop |
|---|---|---|
| The stage | `moveToDevelop` (4c-2) moves `capture` → `pre_proposal` and writes a `plan` decision; `writing` is legacy and folds into `pre_proposal` ("Developed", `src/lib/opportunity-types.ts`); Pipeline → Develop (`PipelineStagePage`, `src/lib/lifecycle.ts`) lists both | The opportunities Develop works on; the page itself is generic: pWin, owner, due date, and links to Proposals and New proposal |
| Creating a proposal | `createProposalAction` (`proposals/actions.ts`) from `/proposals/new`: title, template, the three leads, optional bootstrap from the solicitation; it creates `proposal` and the default `proposal_section` rows and does **not** touch the opportunity's stage | The machinery for D-1, but not on the opportunity, and it ignores the plan |
| The outline | `proposal-bootstrap*.ts`, `BootstrapPanel`, `proposal.bootstrap` jsonb (sections, due date, themes from Section L); frozen on the plan in 4c-2 | The outline Develop writes against |
| The plan | Team and RACI, colour teams, milestones, section owners and due dates (`proposal_section.authorUserId`, `dueDate`), signed charter with win themes written to the newest proposal | Who writes what by when, and the win themes; none of it yet *used* when the proposal is created |
| Section drafting | `section-draft.ts` / `section-draft-run.ts` (`prepareSectionDraft`, `runSectionDraft`), `/api/ai/draft`, feature key `section_draft` (`src/lib/ai-features.ts`); company knowledge through `searchBrain` (`brain-retrieval.ts`), Sections L and M, win themes, past performance, pattern intel; `[S3]` citations and `[NEEDS CITATION]` (`citations.ts`); `auto-draft*.ts`, `draft-judge*.ts` | D-2 for one section at a time. **No internet research anywhere** |
| The editor | TipTap `RichSectionEditor` with track changes, comments, snapshots (`proposal_section_snapshot`), `SnapshotDiffViewer` | D-6's word editor |
| Compliance | `compliance_item` with owners and status, auto-map, `/proposals/[id]/compliance`, `review-preflight.ts` | The "compliant with the RFP" check |
| Reviews | `proposal_review` (pink, red, gold, white_gloves, green) with `proposal_review_assignment`, `proposal_review_section_assignment` (a reviewer scoped to sections), comments, checklist, reminders; `startReviewAction` fills the plan's reviewers and date (4c-2) | D-4 for internal users, section-scoped already. Reviewers must be `users` rows |
| Learning | `section_draft_signal` (share of the AI draft kept), `section_change_decision` (accept / reject of each tracked change), `edit-feedback.ts` (180 days, kind-first, minimum five samples) feeding the drafter's prompt, `DraftInsightsPanel`, `company-model*.ts` | D-7's first half: it learns from the writer's own accept / reject. Nothing learns from reviewers' edits, and no AI-draft-vs-final text is kept |
| Meetings | Nothing: a review has `dueDate`, status `scheduled` and reminder emails only | Nothing for D-5 |
| External people | No guest or partner login; partner accounts are phase 8 | Nothing for D-4's external half |

**What's missing:** a Create a Draft on the opportunity that uses the
plan; a first draft of the *whole* proposal in one run, with research;
a "ready for Pink" state; meeting links on a review round; learning from
what reviewers change; invited external reviewers.

## 2. The design

### 2.1 Create a Draft on the opportunity (D-1, D-3)

A **Develop** tab on the opportunity, beside Plan, and **Create a Draft**
on it. One click, no form, creates the proposal from what Plan settled:
the title from the opportunity; the proposal manager, capture manager and
pricing lead from the plan's team (the A for management, the capture lead,
the pricing lead); the outline from the frozen bootstrap; each section's
author and due date from the parts table; the win themes from the signed
charter. It is `createProposalAction`'s body behind a plan-aware wrapper
(`src/lib/develop-store.ts`), audited `opportunity.develop.draft_create`,
and idempotent: with a proposal already there the button reads **Open the
proposal**. The opportunity stays in `pre_proposal`. Pipeline → Develop
lists each opportunity with its draft's state line (sections drafted of
N, compliance mapped, next review and its date) and the next step.

**Ready for Pink (D-3)** is computed, not clicked: every section past
`not_started` with words written, every requirement mapped to a section,
`review-preflight` clean. The tab lists what is missing, as Move to
Develop lists its blockers; when met, **Start Pink review** is offered
(`startReviewAction`, already filling the plan's reviewers and date).

### 2.2 The first draft, with research (D-2)

**Draft all sections** on the proposal runs `runSectionDraft` for every
empty section as one durable job (the parse-job pattern: one row per
section, a waiter that refreshes, a failed section retried alone, never
overwriting a section a person has started). Each section keeps its
`[S#]` citations. **Research** is a new step before drafting: a short list
of public sources about the agency and the requirement (the agency's
strategy and budget pages, recent awards on USAspending, which FORGE
already queries elsewhere) gathered by a search provider, stored on the
proposal as numbered sources with URL and retrieval date, and offered to
the drafter as `DraftSource`s, so a claim from the web cites a URL and one
from the company's brain cites its record. New feature key
`develop_research`, a read audit `proposal.draft.research`, a per-tenant
switch and the existing AI budget. The company's own claims never come
from the web.

### 2.3 Reviewers, external and internal (D-4)

Internal reviewers: unchanged. For external reviewers the design adds
no accounts in phase 5: the plan's colour teams may name a partner
contact (a name and email), and **Invite to review** emails a single-use,
expiring link to a **guest review page** that shows only the sections that
reviewer's `proposal_review_section_assignment` allows, read and comment
only, no editing, no download of the full proposal, every open audited.
The link is the only credential; phase 8's partner accounts replace it.
Decision 3 asks whether to build this now or wait for phase 8.

### 2.4 Meetings (D-5)

A review round gets a **meeting link** (any URL: Teams, Zoom, Webex) and a
start time. **Send invites** emails every reviewer a calendar invite
(`.ics`, with the link and the sections in scope); the day-before reminder
carries the link. FORGE creates no meetings itself: the lead pastes the
link from their own calendar. Decision 4 asks whether that is enough.

### 2.5 Learning how the company writes (D-7)

Three additions to what exists. (1) Keep the **AI draft's text** per
section in a first snapshot (`source = ai_draft`) so the final text can be
diffed against it. (2) Capture **reviewer edits**: when a reviewer's
suggestion on a tracked-change mark is accepted or rejected at a colour
team, it is stored with the colour, as `section_change_decision` is today.
(3) A **style note** per section kind, rebuilt weekly from the edits (what
was cut, what was added, wording preferred), read by `edit-feedback.ts`
with its existing minimum of five samples, shown on the Draft insights
panel, and never sent between tenants. D-8 stays the measure: the panel
reports the kept share through each review.

## 3. Delivery (one PR each, under 1,500 lines)

1. **5a — the Develop tab, Create a Draft, ready for Pink** (§2.1): the
   plan-aware create, the readiness rules (`develop-logic.ts`, pure,
   tested), the state line and next step on Pipeline → Develop. Likely no
   migration; if the proposal needs to remember it was made from the
   plan, one nullable column.
2. **5b — draft all sections, with research** (§2.2): the draft job
   table, the research sources, `develop_research`, the waiter.
3. **5c — meetings and invited reviewers** (§2.3, §2.4): meeting link and
   time on `proposal_review`, the invite `.ics`, and, if decision 3 says
   now, the guest review page and its token table (split in two PRs if
   it passes the budget).
4. **5d — learning** (§2.5): the `ai_draft` snapshot, reviewer-edit
   capture, the style note and its panel.

## 4. Decisions for the owner

1. **Create a Draft: how much does it do?** One click from the plan,
   using the team, outline, dates and win themes (recommended)? Or open
   today's New proposal form pre-filled for the user to confirm?
2. **Internet research for the first draft (D-2).** Gather public
   sources through a search provider, each cited by URL, kept apart from
   the company's own claims, behind a per-tenant switch (recommended)?
   Or draft from company knowledge only for now? If yes: **which
   provider** (the recommendation is whichever the owner already pays
   for; FORGE has none today).
3. **External reviewers (D-4).** Wait for phase 8's partner accounts
   (recommended: the requirements assign external users to phases 5
   *and* 8, and a link-only guest page is a second sign-in path to secure
   and then retire)? Or build the emailed guest link now?
4. **Meetings (D-5).** A meeting link and a calendar invite on the review
   round, the lead pasting the link (recommended)? Or meetings opened
   and created inside FORGE through Microsoft Graph, which needs the
   tenant's Microsoft consent and a Teams-only answer for Zoom and Webex?
5. **"Ready for Pink" (D-3).** Computed from the draft, the compliance
   map and the preflight, advising and never blocking, so the manager
   can start Pink early (recommended, as starting a round early is
   possible today)? Or a hard gate like Move to Develop?
6. **Learning (D-7) and privacy.** Learn per tenant only, from the draft
   and the reviewers' accepted and rejected edits, with a style note the
   team can read and reset (recommended)? Or also feed anonymised
   patterns across tenants (not recommended: it crosses the
   multi-tenant line).
7. **Order.** 5a, 5b, 5c, 5d as above (recommended: each is usable
   alone)? Or research (5b) last, because it needs the provider?

**Decided 2026-11-09: all recommended** — one click from the plan (1); research cited by URL behind a per-tenant switch, provider still to be named by the owner (2); external reviewers wait for phase 8 (3); meeting link and `.ics` invite (4); ready for Pink advises and never blocks (5); learning per tenant only (6); order 5a, 5b, 5c, 5d (7). With decision 3 answered, 5c carries no guest page or token table.

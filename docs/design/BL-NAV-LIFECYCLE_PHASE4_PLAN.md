# Phase 4 — Plan: design for review

**Status:** draft for the owner (2026-11-08); nothing built. The decisions in §4 are open.
**Requirements:** FORGE II footnote 7, P-1 to P-8 in
`docs/FORGE_II_REQUIREMENTS.md`. **Plan:** BL-NAV-LIFECYCLE phase 4.
**Shape:** the same as `BL-NAV-LIFECYCLE_PHASE3_CAPTURE.md`.

## 1. What FORGE already has

| Piece | Where today | What it gives Plan |
|---|---|---|
| The stage | `moveToPlan` (3a-1) puts the opportunity in stage `capture`, which Pipeline → Plan lists (`src/lib/lifecycle.ts`); every stage change fires `opportunity_advanced` | The opportunities Plan works on, and the gate before it |
| The chosen partner | `opportunity_partner` (3a-1) with "Teaming agreement: to do" on the gate decision | Who joins the team, and the agreement still owed |
| The team | `solicitation_assignment` with nine roles (capture lead, proposal manager, technical lead, pricing lead, compliance reviewer, color-team reviewer, SME, contributor, observer; `src/lib/solicitation-roles.ts`, TeamPanel on the solicitation); `proposal.proposalManagerUserId` / `captureManagerUserId` / `pricingLeadUserId`; `opportunity.ownerUserId`; `solicitation_role_assigned` notifies | The people, but on the solicitation and the proposal, not on the opportunity in Plan, and with no RACI meaning |
| Colour-team reviews | `proposal_review` (pink / red / gold / white_gloves / green) with reviewers, section scope, due date, checklist and reminders (`review-workflow.ts`, `review-reminders.ts`); a round exists only once it starts (`startReviewAction`) | The review machinery; what is missing is naming the teams ahead of time |
| Section owners | `proposal_section.authorUserId` with `proposal_section_assigned`; the Section L brief as `instructions`; no due date per section | Part owners told their duties (P-4), without the plan view |
| Dates | `solicitation.keyDates` (Q&A cut-off, site visit, final RFP, due, orals, award, debrief, protest) with T-7/3/1 reminders; `opportunity.responseDueDate` with `opportunity_due_soon`; `proposal_review.dueDate` per round | The fixed points a schedule hangs on; no task or milestone table |
| Next actions | `opportunity_next_action` (rule-proposed, with `dueBy`, priority, status; `src/lib/next-actions.ts`) | The nearest thing to a task list |
| Compliance matrix | `compliance_item` (category, requirement, mapped section, status, owner and owner status, AI assessment) with seeding, auto-map and the gate (`compliance-*.ts`); `/proposals/[id]/compliance` | The matrix to freeze at the end of Plan |
| The outline | `proposal.bootstrap` (sections, due date, proposed themes) built from Section L (`proposal-bootstrap*.ts`, BootstrapPanel) | The outline to freeze |
| Win themes | `proposal.winThemes` (three at most, WinThemesPanel); discriminators only inside AI prompts | The theme sign-off (P-7) |
| Notification rules | 22 trigger kinds, recipients by user, role, formula (proposal owner, opportunity owner, capture manager, pricing lead, section author) or payload mention; SLA and escalation; no default rules seeded, so a tenant with no rule hears nothing (`notification-dispatcher.ts`) | The one way Plan tells people their duties |

**What's missing:** a Plan page on the opportunity; a RACI; a charter; the
colour teams named before their round exists and told when it starts;
milestones and task dates with owners; the agreement's place in Plan;
the budget, risk list and cut-off dates P-7 proposes; the freeze of the
compliance matrix and outline; and Move to Develop.

## 2. The design

### 2.1 The Plan page (P-1 to P-8)

**Pipeline → Plan** lists every opportunity that passed Capture, as
Capture does: days left, the plan's state (team named, charter signed
off, milestones set, matrix frozen) and the next step. Each opportunity
gets a **Plan** tab beside Capture holding §2.2 to §2.7 as panels, in
the order a proposal manager fills them.

### 2.2 The team and the RACI (P-1, P-2)

One table, `opportunity_plan_role`: a person (a member, or a partner
contact once phase 8 gives partners accounts), the role (the nine
solicitation roles plus *executive sponsor* and *contracts*), and the
RACI letter per area of the proposal (management, technical, past
performance, pricing, compliance, production). Who is R or A for an
area is who gets that area's milestones and parts. Naming someone
fires `plan_role_assigned` (a new trigger, defaulted to in-app + email
to the person named) so they are told their duty at once. The
solicitation's existing assignments seed the table on the first visit;
they are not two lists.

### 2.3 The charter (P-2)

A short structured record on the plan, `opportunity_plan.charter`: the
bid strategy in one paragraph, the win themes (read from
`proposal.winThemes`, or set here first and written there), the
discriminators, the pricing posture, the partner's share, and the sign-
off (who, when). FORGE AI drafts it from the evaluation report, the
decision, the matrix and the partner's answers, with every sentence
resting on a cited record (the 3b / 3c-2 pattern); the manager edits
and signs. A signed charter is one of the gates to Develop.

### 2.4 The colour teams (P-3)

On the plan, four named teams, Pink, Red, Gold and White Gloves, each a
list of members (and, later, partner reviewers) with the round's planned
date. Stored on `opportunity_plan_role` with role *color-team reviewer*
and the colour, so one table holds the whole team. When a proposal of the
opportunity reaches that colour (`startReviewAction`), the round is
created with these reviewers already assigned and the planned date as
its due date, and `review_assignment_added` tells them; the day-before
reminder stays as it is. Starting a round early, or with other
reviewers, remains possible.

### 2.5 Parts and owners (P-4)

The outline's sections (`proposal.bootstrap` → `proposal_section`) each
get an owner and a due date in Plan. The owner is the section author
(`authorUserId`, as today, so Develop sees the same people), the due
date a new `proposal_section.dueDate`, and `proposal_section_assigned`
tells the owner, with the brief and the date. The `proposal_section_overdue`
trigger, defined but never fired, is fired by the daily cron for a
section past its date with no draft.

### 2.6 Milestones and the schedule (P-5)

A new table, `opportunity_milestone`: title, kind (kick-off, outline
frozen, each colour team, pricing complete, final production, submit,
and *other*), date, owner, status (planned / done / missed) and the key
date it hangs on. **Build the schedule** proposes them from the
solicitation's key dates and the due date, counting back (submit two
days before due, White Gloves four, Gold ten, Red twenty, Pink thirty,
kick-off at once), and the manager moves them. The daily cron fires
`milestone_due_soon` (T-7 / T-3 / T-1, like key dates) to the owner, and
the Plan page shows the schedule as a timeline, with the key dates on it.

### 2.7 The agreement, the freeze, and Move to Develop (P-6, P-7, P-8)

- **Agreement (P-6):** until phase 8, the plan records the agreement's
  state by hand (to do / in negotiation / signed, with a date and an
  uploaded file through `uploadFile()`); phase 8 replaces the hand
  record with the module's. A PARTNER opportunity needs *signed* to
  move to Develop (the owner's decision 3 below).
- **The rest of the plan (P-7):** the bid budget in hours and dollars
  with the hours spent read from the time the team logs (none today;
  an estimate only), the Q&A and amendment cut-off dates (from the key
  dates), and a risk list (title, likelihood, impact, owner, mitigation)
  on `opportunity_plan`.
- **The freeze:** at the end of Plan the compliance matrix and the
  outline are stamped `frozenAt` on `opportunity_plan`; items and
  sections can still change in Develop, but each change after the
  freeze is written to the Activity so the Red team sees what moved.
- **Move to Develop (P-8):** offered when the team has an A for every
  area, the charter is signed, the milestones exist, the matrix and
  outline are frozen and (for PARTNER) the agreement is signed; writes
  an `opportunity_decision` of kind `plan` and moves the stage to
  `pre_proposal`, which Develop lists. The blockers are shown, as
  Capture's Move to Plan shows its own.

## 3. Delivery (one PR each)

1. **4a:** the Plan page and tab, `opportunity_plan` and
   `opportunity_plan_role` (team, RACI, the colour teams named), the
   `plan_role_assigned` trigger, and the seeding from the solicitation's
   team.
2. **4b:** milestones (`opportunity_milestone`, Build the schedule,
   `milestone_due_soon`), section due dates and the overdue trigger.
3. **4c:** the charter with the AI draft, the agreement record, the
   budget and risk list, the freeze, and Move to Develop; the review
   round created from the named team.

## 4. Decisions for the owner

1. **Where the team lives.** One table on the opportunity's plan, seeded
   from the solicitation's assignments and kept in step with them
   (recommended)? Or keep the solicitation's TeamPanel as the only team
   and add the RACI letters there?
2. **The charter's shape.** A structured record with an AI draft that
   cites its sources (recommended)? Or a free-text document in the
   proposal's files?
3. **Moving to Develop without a signed agreement.** Hold a PARTNER
   opportunity in Plan until the agreement is recorded as signed
   (recommended: Plan is where P-6 says it is finalised)? Or allow it
   with "agreement: to do" carried forward, as Capture does today?
4. **Milestone defaults.** The count-back above (submit T-2, White
   Gloves T-4, Gold T-10, Red T-20, Pink T-30) as the proposed schedule
   (recommended; the manager moves any of them)? Or no proposal, dates
   set by hand?
5. **Hours and budget (P-7).** An estimate only, with no time logging in
   FORGE (recommended for phase 4)? Or add time logging now?
6. **Default notification rules.** Seed a rule per tenant for
   `plan_role_assigned` and `milestone_due_soon` (in-app + email to the
   person named), as the CRM follow-up did (recommended)? Or leave each
   tenant to create them under Settings → Notification rules?

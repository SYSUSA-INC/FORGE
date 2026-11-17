# FORGE II — requirements trace

The owner's **FORGE II** document (2026-11-01) defines the menu and the
proposal lifecycle **Identify → Evaluate → Capture → Plan → Develop →
Deliver → Measure**. This file lists every requirement in it, and each
one the owner added later in conversation, with an ID, its status and
the phase that delivers it. The phases are those of **BL-NAV-LIFECYCLE**
in `docs/BACKLOG.md`. Each phase gets a design review before it is
built ("pause, assess, analyze, and then plan, and then start
developing").

**Status key**

- ✅ **Shipped**: merged, with the PR that shipped it.
- 🟡 **In part**: FORGE does some of it today, but not yet in the
  lifecycle flow, or not all of what the document asks.
- 🔄 **In progress**: in the open PR.
- 📋 **Planned**: in the plan, in the phase named. Not built yet.
- ⚠️ **Gap**: was missing from the plan or only implied by it. It is
  added to the plan here.
- ❓ **Owner to decide**: needs an answer before it can be built.

Last reviewed 2026-11-17, after PR #508 and Phase 6d-1 (this PR).

---

## M — Menu (document body)

| ID | Requirement | Status |
|---|---|---|
| M-1 | A folding menu that gives the page more room | ✅ #452 |
| M-2 | Every menu item expands and folds; using one group folds the others | ✅ #452: one group open at a time, the active page's group always open |
| M-3 | Command Center at the top | ✅ #452 |
| M-4 | **Opportunity Management** replaces Opportunities, with Dashboard and Pipeline | ✅ #452 |
| M-5 | Under Pipeline: Identify, Evaluate, Capture, Plan, Develop, Deliver, Measure | ✅ #452: a page per stage at `/pipeline/<stage>` |
| M-6 | Under Identify: Scout and Create | ✅ #452, #453 |
| M-7 | **Business Management** replaces Operations Management | ❓ Owner is still placing the rest of the menu. Left as it was, by the owner's instruction |
| M-8 | **Company Settings** replaces Settings, holding Integrations, Notifications and Security | ❓ Same as M-7 |
| M-9 | Platform Intelligence holding AI Engine and Company Model | ❓ Same as M-7 |
| M-10 | **Partners** group holding Company Search (and an item still to be named, "XXXX") | ❓ Same as M-7. Also ties to C-2 |
| M-11 | Customers | ❓ Same as M-7 |
| M-12 | Admin workspaces stay. Consolidate the menu where possible and leave the rest until planned (owner, in conversation) | ✅ #452 |

## L — The lifecycle frame (footnote 1)

| ID | Requirement | Status |
|---|---|---|
| L-1 | The workflow and menu follow the seven stages | 🟡 The menu does (#452). Opportunities still carry the old pipeline stage names, and their move to the seven stages is phase 9 |
| L-2 | A chevron at the top of the page shows the stage the opportunity is in, and stays visible through the lifecycle | ✅ #452: on every stage page, opportunity and proposal. Pipeline itself has none, by the owner's choice |
| L-3 | Each stage has its own sub-menus | 🟡 Identify has Scout and Create. The other stages get theirs in their phases |

## I — Identify (footnotes 2–4)

| ID | Requirement | Status |
|---|---|---|
| I-1 | Identify is one page with tabs (Scout, Create), instead of many pages | ✅ #453 |
| I-2 | **Scout** is one page to scout and bring in opportunities from public and commercial portals | ✅ #453 |
| I-3 | Bring in from SAM.gov on that page | ✅ #453 |
| I-4 | Bring in from a pasted GSA email | ✅ #453 |
| I-5 | Bring in from GSA eBuy | ✅ #453 |
| I-6 | Bring in from **enterprise portals** | 🔄 BL-SCOUT-INBOX. Research found no feeds for state or prime portals (BL-SCOUT-PORTALS). The owner chose a company bid email address that the portals mail directly, with no forwarding (2026-11-06). Phase 1 (receive, Bid inbox) shipped in #460, phase 2 (the AI reads every bid alert into Scout finds) in #461, and receipt moved to FORGE's Exchange mailbox in #462; eBuy and GSA email results share the one Scout page's rows (#458, #459). Next: dedicated portal readers, once the owner confirms the first connectors |
| I-7 | Bring in from the **GWACs** a company holds, current and future | 📋 BL-SCOUT-GWAC (backlog by the owner's choice, 2026-11-03). The tab is on the source bar, marked *soon*, and records requests |
| I-8 | A one-stop, user-friendly experience | ✅ BL-SCOUT-ONEPAGE (#458, and this PR for eBuy and GSA email). #453 put every source on one page, but as two stacked experiences. The page now has one source bar, one search bar, and the same compact rows for every source |
| I-9 | An **Add to pipeline** button next to every opportunity the scout finds or a search returns | ✅ #453 |
| I-10 | Added opportunities show on the Pipeline as part of the current pipeline | ✅ #453 |
| I-11 | **Create** merges New Opportunity and New Solicitation into one page | ✅ #453: start from a document or fill in by hand |
| I-12 | A created opportunity shows on the Pipeline | ✅ #453 |
| I-13 | The scout must judge how a keyword is used and must not bring in every notice that names one ("our Scout has to be smarter", owner 2026-11-03) | ✅ #455 |
| I-14 | One card per solicitation, not one per amendment (owner 2026-11-03) | ✅ #455 |
| I-15 | Explain what makes a fit score high (owner 2026-11-03) | ✅ #455: the score is earned from zero, and each card lists its reasons |
| I-16 | Keep **Show skipped** (owner 2026-11-03) | ✅ #455 |
| I-17 | **Amendment watch:** for every opportunity being pursued, the scout downloads amendments and every other published document, files them on the opportunity and notifies the team (owner 2026-11-03) | ✅ #457, BL-SCOUT-AMEND. Every open opportunity is checked daily and on demand. New documents are filed and read, the due date follows an amendment, and the owner and the proposal and review teams are told in the app and by email |
| I-18 | The scout must not miss opportunities in the company's codes ("only 3 opportunities … Scout seems to be broken", owner 2026-11-05) | ✅ #456, BL-SCOUT-REACH. There were two causes, both older than #455. (1) Keywords were a hard filter, matched as exact phrases. (2) Only the first 100 notices per NAICS code were read, and the run didn't say when more were cut off. The owner chose to have keywords rank rather than filter. Every open notice in the codes is now a find, up to 1,000 notices are read per code, and the run note shows where the notices went. It then grew past that fix: BL-SCOUT-BACKFILL (#490) reads a year back, paged past 1,000 notices, keeping the best 500; BL-SCOUT-FIT (#492) scores capability fit from the company model and counts weak fits instead of dropping them; BL-SCOUT-LEARN (#493) lets each find's score learn from the company's own outcomes; BL-SCOUT-SHOWN (#494) adds the Best first view and found-versus-shown counts. The owner declined to widen by PSC or related NAICS (2026-11-10): relevance first |

## E — Evaluate (footnote 5)

| ID | Requirement | Status |
|---|---|---|
| E-1 | Evaluate lists the opportunities identified in Identify and **replaces the Solicitations page** | ✅ Phase 2a: the Evaluate list (#452, rows and filters in 2a); `/solicitations` redirects to it, with documents not yet on an opportunity listed there |
| E-2 | Two buttons on each opportunity: **Analyze** and **Capability Matrix** | ✅ Both on every Evaluate row: Analyze opens the Analysis page (2c), Capability Matrix the Capability page (2b) |
| E-3 | Analyze opens a new page where FORGE AI, using what it knows of the company, gives a **PWin score** and a **report** that supports it | ✅ Phase 2c: the Analysis tab runs the calibrated PWin with its factors, the pursuit brief and one AI report (the call, fit, competition, risks, what would raise PWin, what FORGE read) |
| E-4 | The analysis is saved, and an **Analysis Report** button then appears on the opportunity | ✅ Phase 2c: each run is a dated, numbered Analysis Report, printable, on the Overview's Reports line |
| E-5 | Capability Matrix opens a page where the AI extracts the required capabilities from the RFP, RFI or other document into an editable, user-friendly list | ✅ Phase 2b: the opportunity's **Capability** page, questions drafted by the AI from the solicitation's requirements, each editable and removable |
| E-6 | Three answers for each capability: **Yes / No / Partial** | ✅ Phase 2b: Yes (proven tick), Partial, No (partner tick), over the six stored answers |
| E-7 | **Partial** asks for a percentage: how much the company can do without a partner | ✅ Phase 2b: 5 to 95%, counted in coverage |
| E-8 | Once the matrix is done, a **Matrix Report** button appears | ✅ Phase 2b-2: **Save report** keeps a dated, numbered snapshot; **Matrix Report vN** opens it, printable |
| E-9 | **Every opportunity has its own page** holding both reports, open to the team for the rest of the process | ✅ The Overview's **Reports** line: Analysis Report, Matrix Report and the decision, kept through every stage |
| E-10 | The final decision on that page: **GO / NO-GO / PARTNER** | ✅ Phase 2a: the Decision panel, each decision kept (`opportunity_decision`) |
| E-11 | GO moves the opportunity to Capture | ✅ Phase 2a: to Qualified (Capture), then Plan |
| E-12 | NO-GO requires a reason, and the opportunity won't close without one, so FORGE learns from it | 🟡 Phase 2a: a category and at least 20 characters of the team's words, or it can't be saved; kept with the decision. Feeding Lessons and Loss intelligence from it is to come |
| E-13 | PARTNER: the scout engine proposes businesses with similar capabilities, and suggests from the company's own list of partners when it has one | 🟡 Phase 2a: the company's own teaming partners and subcontractors, same NAICS first, and Find more partners (Company search with the NAICS). FORGE's own partner finder is phase 3 |
| E-14 | The opportunity page keeps growing through the lifecycle to submission and beyond, with FORGE learning along the way | 🟡 The opportunity page carries activity, documents and AI today. Each phase adds its part |
| E-15 | A No-Go stops the amendment watch (owner 2026-11-03) | ✅ Phase 2a: a NO-GO closes it as No bid, which the watch skips |

## C — Capture (footnote 6)

| ID | Requirement | Status |
|---|---|---|
| C-1 | Capture lists every GO and PARTNER opportunity on one page. Each opens its own opportunity page with the fields needed to advance it | ✅ Phase 3a-1: Pipeline → Capture lists every Qualified opportunity with its GO / PARTNER decision, days left, partners and next step; each opens the opportunity's Partners tab |
| C-2 | A **partner database**: every company with the same NAICS codes and capabilities serving **federal, state or local** markets, with socio-economic status and certifications (ISO, CMMI, CMMC), kept current | 🟡 Federal: ✅ phase 3a-2, **Find partners** on the opportunity joins USAspending awards (five years, at the agency first), the SBA certification registry, SAM.gov entities and your Companies by UEI. ISO / CMMI / CMMC come from the partner's own answers (3c). **State and local:** later, one registry at a time as the owner names them (owner, 2026-11-07) |
| C-3 | FORGE AI finds teaming and subcontracting partners in that database and gives a **prioritised list with its rationale** | ✅ Phase 3b: **Rank the best 10 with FORGE AI** on the Partners tab, a reason per partner resting on facts the search returned. The AI's partner *rating* from partners' answers is 3c (C-7) |
| C-4 | FORGE AI can scout for more partners on request | ✅ Phase 3b: **Find more** widens the search to the NAICS family and any state |
| C-5 | Invite one or more partners from the platform to answer the **same capability matrix** the company answered | ✅ 3c-1: **Invite** on the Partners tab emails a personal link (no account, 14 days, token hashed); the partner answers the same questions Yes / Partial % / No with evidence and lists its ISO, CMMI and CMMC certifications |
| C-6 | Each partner sees and edits **only its own** answers. The company sees **all partners' answers in one view** | ✅ 3c-1: the partner's page shows the questions only and its own answers, never the company's. ✅ 3c-2: **Compare** shows the company's answers and every partner's side by side per question, the partner that closes each gap highlighted |
| C-7 | FORGE AI rates each partner from its answers and recommends the best-aligned, in priority order | ✅ 3c-2: each partner scored on the gaps it closes (weighted like coverage), its evidence and its certifications, listed best first with one reason each resting on its own answers; advice only, the user chooses |
| C-8 | **Agreement templates**: teaming agreement, subcontract, contractor teaming arrangement and others | 📋 Phase 8 |
| C-9 | The company fills in the agreement and sends its link from the portal | 📋 Phase 8 |
| C-10 | The partner opens the link, proposes redlines, goes back and forth, then signs, all in the portal | 📋 Phase 8: e-signature through a provider (DocuSign or Dropbox Sign) |
| C-11 | Once the agreement is final and the partner chosen, the opportunity moves to Plan | 🟡 Phase 3a-1: Choose partner and Move to Plan; a PARTNER opportunity needs a chosen partner, and "Teaming agreement: to do" is recorded until the agreement module (phase 8, owner 2026-11-07) |
| C-12 | GO opportunities go straight to Plan | ✅ Phase 3a-1: a GO opportunity's Move to Plan is open at once |

## P — Plan (footnote 7)

| ID | Requirement | Status |
|---|---|---|
| P-1 | A development plan with a **RACI** matrix (responsible, accountable, consulted / kept informed, notified) | ✅ Phase 4a: the RACI letter per person per area on the opportunity's Plan tab |
| P-2 | A team and a **charter** for the proposal | 🟡 Phase 4a: the team on the plan, one list with the solicitation's, told their duty at once. ✅ Phase 4c-1: the charter, drafted by FORGE AI from cited records, edited and signed (it gates Develop in 4c-2) |
| P-3 | Name the **Pink, Red, Gold and White Gloves** team members, notified automatically when the proposal reaches their review | ✅ Phase 4a and 4c-2: the four teams named on the plan and each person told now; Start review opens with the colour's team and its milestone date already filled in, and each person named is told they are on the round |
| P-4 | Assign the proposal's parts (implementation plan, financial, compliance and so on) to owners, who are told their duties | ✅ Phase 4b-2: the proposal's sections as parts on the Plan tab, each with an owner (the section author, told with the date) and a due date; the owner of a part past its date with no draft is told by the daily cron |
| P-5 | **Timelines and milestones** for each task, to meet the deadline | ✅ Phase 4b-1: the milestones on the plan, built by the count-back from the due date and moved by the manager, each with an owner reminded at T-7 / T-3 / T-1. Phase 4b-2: the schedule drawn as a timeline with the due date, the key dates and the parts' dates on it |
| P-6 | Finalise the teaming or subcontract agreement in Plan, so partner staff can join the review groups | 🟡 Phase 4c-1: the agreement kept by hand (to do / in negotiation / signed, with a date and a file); a PARTNER bid moves only on signed ✅ (4c-2, Move to Develop). Phase 8 replaces the hand record |
| P-7 | Anything else a plan needs ("you can think of anything else") | ⚠️ Proposed for the phase 4 design: bid / no-bid budget and hours, a win-theme and discriminator sign-off, a compliance matrix and outline frozen at the end of Plan, the Q&A and amendment cut-off dates, and the risk list. ✅ Phase 4c-1 and 4c-2: the budget estimate, the cut-offs, the risk list and the win-theme and discriminator sign-off (in the charter); the matrix and outline freeze, with each later change written to the Activity |
| P-8 | Once the plan is set, the opportunity moves to Develop | ✅ Phase 4c-2: Move to Develop lists what is missing and, once open, records a PLAN decision and moves the opportunity to Pre-proposal |

## D — Develop (footnote 8)

| ID | Requirement | Status |
|---|---|---|
| D-1 | A **Create a Draft** button on the opportunity page | ✅ Phase 5a: the Develop tab, one click from the plan (team, Section L outline, charter win themes) |
| D-2 | FORGE AI writes the first draft from what it knows of the company **and internet research** | 🟡 Phase 5b-1 (5b-1a #496 and 5b-1b, migrations 0171 and 0172): draft-all runs a web research step first (Claude's built-in search, open web, per-tenant switch, domain lists and a monthly search cap on Settings → AI Engine, a metered search allowance), and web claims cite their page. 5b-2a (migration 0173): a prepaid pack balance, drawn after the plan's searches. 5b-2b (migration 0174): org admins buy a pack through Stripe Checkout on Settings → Billing; a refund takes back the unused searches |
| D-3 | The first draft is ready for the team to prepare for Pink review | ✅ Phase 5a: computed Ready for Pink (sections drafted, requirements mapped), advisory, with Start Pink review |
| D-4 | The writer invites **internal and external** users to the whole proposal or to **specific sections** | 🟡 Internal reviewers exist. External users with section-level access are phases 5 and 8 |
| D-5 | **Teams, Zoom or Webex** in the portal, so the lead can schedule reviews | ✅ Phase 5c (this PR, migration 0170). The owner chose the recommended answer on 2026-11-09: a calendar invite with the meeting link is enough. The lead pastes a link and a start time on the review round; **Send invites** emails every reviewer an `.ics` with the link and their sections; the day before, a reminder carries the link. FORGE creates no meeting. External reviewers wait for phase 8 |
| D-6 | The Pink draft is complete, **compliant with the RFP** and editable in a word editor in the platform | 🟡 The section editor and compliance matrix exist. Phase 5 |
| D-7 | While the proposal is edited, FORGE AI **learns how the company writes** and suggests improvements through every review to White Gloves and submission | 🟡 Draft insights and the company model exist. Phase 5d-1 (migration 0175) keeps the AI's draft, the colour of each reviewer's suggestion and the share of the draft kept at each review; phase 5d-2 (migration 0176) adds the weekly style note per section kind, read by the drafter and shown on AI Draft Insights |
| D-8 | Everything happens in the portal. FORGE AI keeps learning until it can write up to 100% of the proposal, with people validating | ⚠️ A direction, not one feature. Recorded as the measure each phase reports against |

## S — Deliver (footnote 9)

| ID | Requirement | Status |
|---|---|---|
| S-1 | Reviews **Pink, Red, Green, Gold and White Gloves** completed and **formally signed off** by everyone before submission | ✅ #504: the opportunity's Deliver tab shows each colour's sign-off and blocks a submission until all five are signed off; an org admin or the proposal manager may override with an audited reason |
| S-2 | Option 1: generate a **PDF** the lead submits by email | ✅ #504: Deliver → Record submission keeps a copy of the file sent, with who, when, how and to whom |
| S-3 | Option 2: **submit by email from the portal**, from an email address assigned to the portal | ✅ #505: Deliver → Send from FORGE emails the chosen files once, from the opportunity's own address on the inbound domain, with the sender copied. Real sends need that domain verified in Resend (owner). ✅ #506: extra uploaded files on a send, receipts on a submission, and download of the kept copy |
| S-4 | A reply to that email **comes back to the portal**, is read and parsed, and is filed on the opportunity, building its history and audit trail | ✅ #507: a reply to the opportunity's address is read from FORGE's Exchange mailbox through Microsoft Graph, filed on the opportunity (Deliver → Correspondence, the Activity timeline, the audit log) and announced to the proposal manager, the capture manager and the sender; delivery failures and automatic replies are recognised, an unknown or unverified sender is marked. ✅ #508: FORGE AI reads what a reply is (receipt, question, amendment, evaluation notice, award, unsuccessful), summarises it and picks out a date it names, as a suggestion that never changes the opportunity; an attachment can be filed as a document. 🔄 6d-1 (this PR): **Reply** on a filed message answers its sender from the opportunity's own address in the same thread, kept under Correspondence and in the audit log; an answer is not a submission (no sign-off, no stage change) |
| S-5 | Submission through government portals: explore later | 📋 Recorded for later (owner) |
| S-6 | Suggestions on how to do S-3 and S-4 | 📋 In phase 6's design: one sending domain, a reply address for each opportunity, and replies received in FORGE's Exchange mailbox and read through Microsoft Graph, as the bid inbox does (BL-SCOUT-INBOX; the owner chose Exchange over a separate mail service, 2026-11-06) |

## R — Measure (footnote 10)

| ID | Requirement | Status |
|---|---|---|
| R-1 | Keep the opportunity's history: **win / loss** | 🟡 Proposal outcomes exist. Phase 7 makes Measure the place for them |
| R-2 | Keep **debriefing** data | 🟡 Debriefs exist. Phase 7 |
| R-3 | Use both to **strengthen the knowledge base** for better responses | 🟡 Lessons and loss intelligence exist. Phase 7 ties them to the stage |

---

## The plan, in order

The order is serial, one PR at a time, with a design review before each
phase:

1. **Done:** BL-SCOUT-REACH (I-18, #456), BL-SCOUT-AMEND (I-17, #457), BL-SCOUT-ONEPAGE (I-8, #458, #459), BL-SCOUT-INBOX (I-6, #460 to #462), phases 2 to 4 (Evaluate #463 to #469, Capture #470 to #478, Plan #483 to #487), Develop 5a (#489), and the Scout ask (#490 to #494: backfill, capability fit, learning, Best first). **Now:** Develop 5c, the review meeting and its invite (D-5, this PR). **Then:** 5b (draft all sections with research; waits for the owner to name the search provider), then 5d (learning). BL-SCOUT-PORTALS (I-6) waits for the owner to confirm the first connectors.
2. **Phase 2, Evaluate:** E-1 to E-15, with the partner hand-off of
   E-13.
3. **Phase 3, Capture:** C-1 to C-7, C-11, C-12.
4. **Phase 4, Plan:** P-1 to P-8.
5. **Phase 5, Develop:** D-1 to D-8. Design for review: `docs/design/BL-NAV-LIFECYCLE_PHASE5_DEVELOP.md`.
6. **Phase 6, Deliver:** S-1 to S-6.
7. **Phase 7, Measure:** R-1 to R-3.
8. **Phase 8, the partner portal:** C-6, C-8 to C-10, P-6, D-4 for
   external users.
9. **Phase 9:** pipeline stages renamed to the seven stages (L-1).
10. **When the owner places them:** M-7 to M-11, I-6, I-7.

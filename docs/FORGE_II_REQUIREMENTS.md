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

Last reviewed 2026-11-06, after PR #457.

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
| I-6 | Bring in from **enterprise portals** | 📋 BL-SCOUT-PORTALS. The owner picked state portals, prime portals and commercial aggregators (2026-11-06). Research found no feeds for state or prime portals, but a documented aggregator API (HigherGov), and alert emails that could be forwarded to FORGE. The tab says what is coming and records requests. ❓ The owner confirms the first connectors |
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
| I-18 | The scout must not miss opportunities in the company's codes ("only 3 opportunities … Scout seems to be broken", owner 2026-11-05) | ✅ #456, BL-SCOUT-REACH. There were two causes, both older than #455. (1) Keywords were a hard filter, matched as exact phrases. (2) Only the first 100 notices per NAICS code were read, and the run didn't say when more were cut off. The owner chose to have keywords rank rather than filter. Every open notice in the codes is now a find, up to 1,000 notices are read per code, and the run note shows where the notices went |

## E — Evaluate (footnote 5)

| ID | Requirement | Status |
|---|---|---|
| E-1 | Evaluate lists the opportunities identified in Identify and **replaces the Solicitations page** | 🟡 The stage page lists them (#452). Replacing Solicitations is phase 2 |
| E-2 | Two buttons on each opportunity: **Analyze** and **Capability Matrix** | 📋 Phase 2 |
| E-3 | Analyze opens a new page where FORGE AI, using what it knows of the company, gives a **PWin score** and a **report** that supports it | 🟡 A PWin panel and AI evaluation exist on the opportunity page today. Phase 2 makes them the Analyze flow |
| E-4 | The analysis is saved, and an **Analysis Report** button then appears on the opportunity | 📋 Phase 2 |
| E-5 | Capability Matrix opens a page where the AI extracts the required capabilities from the RFP, RFI or other document into an editable, user-friendly list | 🟡 A capability matrix exists (`capability-matrix-actions.ts`). Phase 2 reshapes it |
| E-6 | Three answers for each capability: **Yes / No / Partial** | 📋 Phase 2, mapped onto today's six-answer scale |
| E-7 | **Partial** asks for a percentage: how much the company can do without a partner | 📋 Phase 2 |
| E-8 | Once the matrix is done, a **Matrix Report** button appears | 📋 Phase 2 |
| E-9 | **Every opportunity has its own page** holding both reports, open to the team for the rest of the process | 🟡 Opportunity pages exist. Phase 2 puts the reports on them |
| E-10 | The final decision on that page: **GO / NO-GO / PARTNER** | 📋 Phase 2 |
| E-11 | GO moves the opportunity to Capture | 📋 Phase 2 |
| E-12 | NO-GO requires a reason, and the opportunity won't close without one, so FORGE learns from it | 📋 Phase 2 |
| E-13 | PARTNER: the scout engine proposes businesses with similar capabilities, and suggests from the company's own list of partners when it has one | ⚠️ The plan had the partner finder in Capture (phase 3) only. The document wants a first list at the moment of the decision. Phase 2 links to it; phase 3 builds it |
| E-14 | The opportunity page keeps growing through the lifecycle to submission and beyond, with FORGE learning along the way | 🟡 The opportunity page carries activity, documents and AI today. Each phase adds its part |
| E-15 | A No-Go stops the amendment watch (owner 2026-11-03) | 📋 Phase 2. Until then the watch stops at No bid |

## C — Capture (footnote 6)

| ID | Requirement | Status |
|---|---|---|
| C-1 | Capture lists every GO and PARTNER opportunity on one page. Each opens its own opportunity page with the fields needed to advance it | 🟡 The stage page lists Qualified opportunities (#452). Listing by the GO / PARTNER decision is phase 3 |
| C-2 | A **partner database**: every company with the same NAICS codes and capabilities serving **federal, state or local** markets, with socio-economic status and certifications (ISO, CMMI, CMMC), kept current | 🟡 Company search and the SBA 8(a) registry cover part of the federal market. ⚠️ The plan named federal sources only. **State and local** are added here. ❓ Their sources (state procurement registries, certification bodies) need the owner's call |
| C-3 | FORGE AI finds teaming and subcontracting partners in that database and gives a **prioritised list with its rationale** | 📋 Phase 3 |
| C-4 | FORGE AI can scout for more partners on request | ⚠️ Added to phase 3 |
| C-5 | Invite one or more partners from the platform to answer the **same capability matrix** the company answered | 📋 Phase 3: a tokenised link |
| C-6 | Each partner sees and edits **only its own** answers. The company sees **all partners' answers in one view** | 📋 Phases 3 and 8. ⚠️ The comparison view is added here explicitly |
| C-7 | FORGE AI rates each partner from its answers and recommends the best-aligned, in priority order | ⚠️ Added to phase 3 |
| C-8 | **Agreement templates**: teaming agreement, subcontract, contractor teaming arrangement and others | 📋 Phase 8 |
| C-9 | The company fills in the agreement and sends its link from the portal | 📋 Phase 8 |
| C-10 | The partner opens the link, proposes redlines, goes back and forth, then signs, all in the portal | 📋 Phase 8: e-signature through a provider (DocuSign or Dropbox Sign) |
| C-11 | Once the agreement is final and the partner chosen, the opportunity moves to Plan | 📋 Phase 3 / 8 |
| C-12 | GO opportunities go straight to Plan | 📋 Phase 3 |

## P — Plan (footnote 7)

| ID | Requirement | Status |
|---|---|---|
| P-1 | A development plan with a **RACI** matrix (responsible, accountable, consulted / kept informed, notified) | 📋 Phase 4 |
| P-2 | A team and a **charter** for the proposal | 📋 Phase 4 |
| P-3 | Name the **Pink, Red, Gold and White Gloves** team members, notified automatically when the proposal reaches their review | 🟡 Color-team review rounds exist on proposals today. Naming the teams in Plan and notifying them automatically is phase 4 |
| P-4 | Assign the proposal's parts (implementation plan, financial, compliance and so on) to owners, who are told their duties | 🟡 Section assignments with notifications exist. Phase 4 adds the plan view |
| P-5 | **Timelines and milestones** for each task, to meet the deadline | 📋 Phase 4 |
| P-6 | Finalise the teaming or subcontract agreement in Plan, so partner staff can join the review groups | 📋 Phases 4 and 8 |
| P-7 | Anything else a plan needs ("you can think of anything else") | ⚠️ Proposed for the phase 4 design: bid / no-bid budget and hours, a win-theme and discriminator sign-off, a compliance matrix and outline frozen at the end of Plan, the Q&A and amendment cut-off dates, and the risk list |
| P-8 | Once the plan is set, the opportunity moves to Develop | 📋 Phase 4 |

## D — Develop (footnote 8)

| ID | Requirement | Status |
|---|---|---|
| D-1 | A **Create a Draft** button on the opportunity page | 🟡 A draft bootstrap exists on proposals. Phase 5 moves it to the opportunity |
| D-2 | FORGE AI writes the first draft from what it knows of the company **and internet research** | 🟡 The draft uses the company's knowledge today. ⚠️ Internet research is added to phase 5 |
| D-3 | The first draft is ready for the team to prepare for Pink review | 📋 Phase 5 |
| D-4 | The writer invites **internal and external** users to the whole proposal or to **specific sections** | 🟡 Internal reviewers exist. External users with section-level access are phases 5 and 8 |
| D-5 | **Teams, Zoom or Webex** in the portal, so the lead can schedule reviews | 📋 Phase 5: the plan says scheduling links. ❓ Owner to confirm whether meetings must open inside FORGE or a calendar invite with the meeting link is enough |
| D-6 | The Pink draft is complete, **compliant with the RFP** and editable in a word editor in the platform | 🟡 The section editor and compliance matrix exist. Phase 5 |
| D-7 | While the proposal is edited, FORGE AI **learns how the company writes** and suggests improvements through every review to White Gloves and submission | 🟡 Draft insights and the company model exist. ⚠️ Learning from edits through the reviews is added to phase 5 |
| D-8 | Everything happens in the portal. FORGE AI keeps learning until it can write up to 100% of the proposal, with people validating | ⚠️ A direction, not one feature. Recorded as the measure each phase reports against |

## S — Deliver (footnote 9)

| ID | Requirement | Status |
|---|---|---|
| S-1 | Reviews **Pink, Red, Green, Gold and White Gloves** completed and **formally signed off** by everyone before submission | 🟡 The review rounds include these colours. ⚠️ A formal sign-off gate before submission is added to phase 6 |
| S-2 | Option 1: generate a **PDF** the lead submits by email | 🟡 The PDF export exists. Phase 6 puts it in Deliver |
| S-3 | Option 2: **submit by email from the portal**, from an email address assigned to the portal | 📋 Phase 6 |
| S-4 | A reply to that email **comes back to the portal**, is read and parsed, and is filed on the opportunity, building its history and audit trail | 📋 Phase 6: an inbound provider's webhook |
| S-5 | Submission through government portals: explore later | 📋 Recorded for later (owner) |
| S-6 | Suggestions on how to do S-3 and S-4 | 📋 In phase 6's design: one sending domain, a reply address for each opportunity, and inbound parsing by Postmark, SendGrid or Mailgun |

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

1. **Done:** BL-SCOUT-REACH (I-18, #456), BL-SCOUT-AMEND (I-17, #457). **Now:** BL-SCOUT-ONEPAGE (I-8), its second part. **Then:** BL-SCOUT-PORTALS (I-6), once the owner confirms the first connectors.
2. **Phase 2, Evaluate:** E-1 to E-15, with the partner hand-off of
   E-13.
3. **Phase 3, Capture:** C-1 to C-7, C-11, C-12.
4. **Phase 4, Plan:** P-1 to P-8.
5. **Phase 5, Develop:** D-1 to D-8.
6. **Phase 6, Deliver:** S-1 to S-6.
7. **Phase 7, Measure:** R-1 to R-3.
8. **Phase 8, the partner portal:** C-6, C-8 to C-10, P-6, D-4 for
   external users.
9. **Phase 9:** pipeline stages renamed to the seven stages (L-1).
10. **When the owner places them:** M-7 to M-11, I-6, I-7.

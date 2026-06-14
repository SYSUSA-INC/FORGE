# FORGE — User Manual

*Framework for Optimized Response Generation & Execution*

A step-by-step guide for day-to-day users. For admin tasks (inviting teammates, managing roles, platform admin), see **ADMIN_MANUAL.md**.

> This manual reflects the current shipped state of FORGE. Screenshot placeholders live under `docs/images/`. When the UI changes, update both the text and the screenshot in the same PR.

FORGE is built around two ideas that show up on every screen:

- **Every record has a clear owner.** Opportunities have an owner. Proposals have a manager, capture lead, and pricing lead. Sections have an author. Reviews have assigned reviewers. Compliance items have an owner. The role you sign in with controls what you're allowed to touch; the assignment on each record names the person responsible for it.
- **Every meaningful change is recorded.** Stage changes, gate decisions, evaluation saves, review verdicts, comment threads, status edits on compliance items, and organization-profile updates are all kept on a timeline you can read after the fact. You don't have to remember why a deal was no-bid'd or who closed a Red Team review — FORGE writes it down.

This manual covers what each role can do and where to find the trail FORGE leaves behind.

---

## Contents

1. [Getting started](#1-getting-started)
2. [The app layout](#2-the-app-layout)
3. [Roles & responsibilities](#3-roles--responsibilities)
4. [Organization settings](#4-organization-settings)
5. [Opportunities](#5-opportunities)
6. [Proposals](#6-proposals)
7. [Companies](#7-companies)
8. [Knowledge base](#8-knowledge-base)
9. [What FORGE records (the audit trail)](#9-what-forge-records-the-audit-trail)
10. [Notifications inbox](#10-notifications-inbox)
11. [Signing out and switching orgs](#11-signing-out-and-switching-orgs)

---

## 1. Getting started

### 1.1 Create your account

Open **https://www.sysgov.com/sign-up**.

![Sign-up card](docs/images/sign-up.png)

Fill in:
- **Name** — how we'll display you in the app
- **Work email** — used for verification and sign-in
- **Password** — at least 10 characters, with an uppercase, a lowercase, and a digit
- **Confirm password**

Click **Create account**. You'll see a "Check your inbox" screen.

### 1.2 Verify your email

Look for an email from `Forge <noreply@sysgov.com>` titled **"Verify your email for Forge"**. Click **Verify email** (or paste the link into a browser). The link expires in 24 hours.

![Verification email](docs/images/verify-email.png)

After verification you land on the sign-in page with an **Email verified** confirmation.

### 1.3 Sign in

On **https://www.sysgov.com/sign-in** enter your email + password and click **Sign in**.

![Sign-in card](docs/images/sign-in.png)

If your organization uses SSO, use **Continue with Google** or **Continue with Microsoft** instead.

### 1.4 Forgot your password

Click **Forgot password?** below the sign-in form. Enter your email — you'll get a reset link (valid for 1 hour). If no email arrives, contact your administrator; see the Admin manual's "Force password reset" for what they can do.

### 1.5 Accepting an invitation

If a teammate invited you, your email has a link that looks like:
```
https://www.sysgov.com/sign-up?invite=...&id=...
```

Clicking it lands you on a sign-up page pre-filled with your email (you can't change it). Enter your name + password and click **Accept and create account**. You'll be signed in immediately and placed in your teammate's organization with the role they assigned you.

---

## 2. The app layout

After signing in you'll see the main **app shell**:

![App shell](docs/images/app-shell.png)

- **Left sidebar** — navigation, grouped into Command Center, Operations, Opportunities, Platform Intelligence, Help, and Platform Administration (superadmin only). Operations + sub-pages are gated to org admins. Inside the Opportunities group you'll find **Opportunities Dashboard**, **In-flight Proposals**, and **New Proposals** as siblings (see §6).
- **Top bar** — the mobile hamburger, live session clock, Settings shortcut, and your avatar
- **Content area** — changes with the page you're on

The top-right avatar is your **user menu**. Click it to see your name/email and sign out.

### 2.1 Command Center vs. Opportunities Dashboard

The default landing page after sign-in is the **Command Center** (`/`). It's the at-a-glance home — a 10-tile stage grid for opportunities (count + value range + due hint per stage), a "Next deadline" panel highlighting the soonest non-past-due opportunity, and a "Proposal stages" breakdown. Clicking any tile **navigates** to the Opportunities Dashboard pre-filtered to that stage.

The **Opportunities Dashboard** (`/opportunities`) is the same tile grid plus an editable filter + search + the per-opportunity list. Clicking a tile here **filters in place** rather than navigating.

Both pages source from the same `getOrganizationSnapshot()` aggregate, so the numbers can't disagree. Mutations on either page (creating an opportunity, advancing a stage, closing a review, etc.) refresh the Command Center on the next nav with no manual reload.

---

## 3. Roles & responsibilities

Every membership in an organization carries exactly one role. Your role decides which buttons are enabled, which tabs you can edit, and what FORGE will let you submit. Roles are assigned by an organization admin on the **Users** page; you can see your own role on your row in the Members panel (or in the top-right user menu in a future release).

The seven roles, and what each is responsible for:

| Role | Owns | Can edit | Read-only |
|---|---|---|---|
| **Admin** | Organization configuration, member roster, role assignments | Everything in the org — settings, opportunities, proposals, companies, users | — |
| **Capture** | Identifying and qualifying opportunities; recommending pursue / no-bid | Opportunities (all tabs), companies, knowledge base | Settings, Users |
| **Proposal** | Running the proposal lifecycle for assigned proposals; scheduling reviews; closing them out | Proposals (all tabs), opportunities they're owner on | Settings, Users |
| **Author** | Writing the sections they're assigned | Their assigned proposal sections, their own activity notes | Other authors' sections, settings |
| **Reviewer** | Casting a verdict on color-team reviews they're assigned to | Their own review verdict + comments | Section text outside review windows, settings |
| **Pricing** | The price volume and cost narrative on assigned proposals | Pricing-kind sections, related compliance items | Other section kinds, settings |
| **Viewer** | Read-only access for stakeholders, executives, audit reviewers | — | Everything in the org |

A few things to keep in mind:

- **Roles are checked server-side, not just in the UI.** A Viewer who tries to POST to an edit endpoint gets a 403 even if they craft the request by hand. Don't rely on the absence of a button as your only safety net.
- **Assignments override role gates in one direction only.** Being named Author on a section lets you edit that section even though Authors can't edit arbitrary sections. Being named Reviewer on a review lets you cast a verdict. Assignment never *expands* you outside your role — a Viewer named as a reviewer still can't submit a verdict; they'd need to be at least a Reviewer.
- **Admins can change anyone's role at any time.** The change takes effect on the user's next request; they don't need to sign out. Your previous role's permissions are revoked immediately.
- **Your role is per-organization.** If you ever belong to more than one org, you can be Admin in one and Author in another.

If a button is greyed out and you think it shouldn't be, check your role in **Users → Members** (or ask your admin). Don't ask for a higher role just to clear a single warning — the role you carry determines what FORGE expects you to be accountable for.

---

## 4. Organization settings

Go to **Settings** in the sidebar (or click Settings in the top-right).

Only organization admins can edit these fields. Everyone else sees them read-only.

![Organization settings page](docs/images/settings-org.png)

The page has four tabs. Right now only **Organization** is active.

### 4.1 Entity banner

At the top: your organization's name, UEI, CAGE code, data source (Manual / SAM.gov), and last sync time.

### 4.2 SAM.gov sync (admin only)

Paste a **UEI** and click **Sync from SAM.gov**. We pull the registered entity's name, address, registration IDs, primary NAICS, NAICS list, socio-economic certifications, and contact POC — then overwrite those fields in your org profile.

![SAM.gov sync](docs/images/settings-samgov-sync.png)

A success message confirms which entity was imported.

### 4.3 Identity & Primary contact

Legal name, website, and primary point-of-contact (name, title, phone, email). Phone and email are validated — bad formats show a red error and block Save.

### 4.4 Address

Line 1, Line 2, City, State, ZIP, Country. For US addresses State must be a 2-letter code (auto-uppercased). ZIP is 5 digits or 5+4.

### 4.5 Registration IDs

UEI (12 alphanumeric), CAGE code (5 alphanumeric), DUNS (9 digits — optional, SAM.gov is deprecating this field).

### 4.6 Security & compliance

Company and employee **security clearance level** (None / Confidential / Secret / Top Secret / TS/SCI) and **DCAA compliant** toggle.

### 4.7 Classification

- **Primary NAICS** — 6-digit code
- **NAICS list** — additional NAICS codes your org pursues
- **PSC codes** — Product/Service Codes

Used to filter SAM.gov opportunity and entity search, so keep them accurate.

### 4.8 Socio-economic

SBA 8(a), Small Business, SDB, WOSB, SDVOSB, HUBZone checkboxes.

### 4.9 Contracting vehicles

Chip selector pre-populated with civilian (GSA MAS, CIO-SP4, etc.) and DoD (SEWP, ITES-3S, SeaPort-NxG, etc.) vehicles. Add custom ones.

### 4.10 Past performance

Add rows with customer, contract name, value, period start/end, description. Used as evidence in proposals.

### 4.11 Search keywords

Tag-based editor for terms that describe your core competencies. (Future phases will use these for opportunity matching.)

### 4.12 Save / Reset

Changes only persist when you click **Save changes** at the top-right. **Reset** reverts unsaved changes. The Save button is disabled if any field has validation errors.

---

## 5. Opportunities

**Opportunities** are pursuits you're tracking — from identification through submission. Each opportunity has a single named **owner**: the person accountable for advancing it through the stage gates. Capture and Admin roles can change the owner; everyone else can view it. Every meaningful change to an opportunity gets a row on its **Activity** timeline (§5.4) so the audit trail tells you not only the current state but how it got there.

Go to **Opportunities** in the sidebar.

### 5.1 List view

![Opportunities list](docs/images/opportunities-list.png)

The page leads with a **10-widget grid** of stage tiles — one per active stage (S1 through S7, spelled out as "Stage 1"… "Stage 7") plus the three closed states (Won / Lost / No Bid). Each tile shows:

- The count of opportunities in that stage
- The descriptive label ("Sources Sought / RFI", "Qualification", etc.)
- A **value range** — sum of `valueLow` to sum of `valueHigh` across the stage, formatted compactly (`$250k – $5M`). Tiles where every entry has no value range hide the line.
- A due-date hint — "due in 3 days" / "due today" for the soonest upcoming response date, or a red **N past due** badge if responses are stale
- An "Everything" tile at the start that clears the filter

Click a tile to filter the list below to that stage. The active tile gets a colored border + filled background so you can tell at a glance what's selected.

Below the grid:
- **Search** — title, agency, owner, solicitation number
- **+ New opportunity** — manual create
- **Import from SAM.gov** — live SAM.gov search

Click any row to open its detail page. The same tile grid is mirrored on the **Command Center** (`/`) home page — but the Command Center tiles **navigate** to a pre-filtered dashboard view instead of filtering in place, so it's the at-a-glance read whereas Opportunities is the filter-and-drill workspace. Both views read from the same `getOrganizationSnapshot()` aggregate so the numbers can never disagree.

### 5.2 Import from SAM.gov

Click **Import from SAM.gov**.

![SAM.gov import](docs/images/opportunities-import.png)

The page prefills your org's NAICS codes and returns active solicitations from the last 30 days. Adjust:
- **NAICS codes** — comma-separated
- **Keyword** — optional search term
- **Posted in last** — 7 / 14 / 30 / 60 / 90 days

Click **Search**. Results show title, agency, solicitation number, NAICS, set-aside, place of performance, description preview, due date, and a link to the SAM.gov page. Checkboxes let you multi-select; **Select all** picks every un-imported result. Click **Import N selected** to pull them into your opportunities list.

Already-imported notices are flagged and disabled so you don't duplicate.

### 5.3 Creating an opportunity manually

Click **+ New opportunity**.

![New opportunity form](docs/images/opportunities-new.png)

Fill in:
- **Title** (required) — a short name like "Army NETCENTS-2 App Services task order"
- **Agency / Office** — customer agency and sub-command
- **Stage** — default Identified
- **PWin %** — your estimate (0–100)
- **Owner** — a team member to be accountable
- **Solicitation number** / **SAM.gov Notice ID**
- **Value low / high** — estimated contract value range
- **Contract type** — FFP / T&M / CPFF / etc.
- **Release date / Response due / Award date**
- **NAICS / PSC / Set-aside**
- **Place of performance / Incumbent**
- **Description**

Click **Create opportunity**. You'll land on the detail page.

### 5.4 Opportunity detail — tabs

Every opportunity has four tabs.

![Opportunity detail tabs](docs/images/opportunity-detail.png)

#### Overview

Same form as New opportunity, but with every field editable. Save persists.

#### Evaluation

A qualification scorecard with 5 weighted dimensions (0–100 sliders):
- Strategic fit
- Customer relationship
- Competitive posture
- Resource availability
- Financial attractiveness

![Evaluation scorecard](docs/images/opportunity-evaluation.png)

A live **Rollup score** with a verdict label — **Strong pursue** (≥70), **Watch** (50–69), or **Consider no-bid** (<50). Add a rationale and click **Save evaluation**. The save is stamped with your user id and a timestamp, so anyone reviewing the deal later can see who scored it that way and when.

Right-side **Gate decision** panel lets you:
- **Advance stage** to any non-closed stage
- **Declare no-bid** (stage → No Bid)
- **Record as lost** (stage → Lost)

Each gate decision **requires a reasoning note**. The note becomes a permanent entry on the Activity timeline, attributed to you. This is the trail you'll lean on at quarterly pipeline reviews when somebody asks "why did we walk away from this one?" — open the opportunity, scroll Activity, read the note. No tribal knowledge.

Capture and Admin roles can take gate decisions. Other roles see the panel but the buttons are disabled.

#### Competitors

Track competitors (including incumbent). Per competitor: name, incumbent flag, past performance, strengths, weaknesses, notes.

![Competitors tab](docs/images/opportunity-competitors.png)

#### Activity

Reverse-chronological timeline. **Auto-logs**: stage changes (with the prior stage and the reason note), gate decisions, evaluation saves, and competitor adds/removes. **Manually log**: Note, Meeting, or Action entries — anyone with edit access on the opportunity can post.

Each entry shows the author's avatar, name, kind, body, and timestamp. You can delete entries you posted yourself; you cannot edit or delete auto-logged system entries (stage changes, gate decisions) — those are part of the permanent record. If a stage was advanced in error, advance it again with a corrective note explaining what happened. The timeline tells the truth even when the truth is "we made a mistake and corrected it."

![Activity timeline](docs/images/opportunity-activity.png)

---

## 6. Proposals

A **Proposal** is tied to an opportunity and tracks the color-team review lifecycle. Proposals carry three named roles on the record itself, separate from your platform role:

- **Proposal manager** — schedules and closes color-team reviews, advances the proposal stage, owns the final submission
- **Capture manager** — typically the person who shepherded the opportunity through pursuit; stays on the proposal as the customer-relationship lead
- **Pricing lead** — owns the price volume and any cost-narrative sections

Anyone in the org can read every proposal. Editing is gated by role *and* assignment: Proposal-role users can edit proposals where they're the manager; Authors can edit sections they're listed as author on; Reviewers can submit verdicts on reviews they're assigned to. Admins can edit any proposal, full stop.

The proposals area lives under the **Opportunities** sidebar group as two siblings:

- **In-flight Proposals** (`/proposals`) — the proposals list with all the filters and tabs described below
- **New Proposals** (`/proposals/new`) — the launcher for creating a new proposal from an existing opportunity

Use whichever entry matches the task you're about to do; both lead to the same underlying records.

### 6.1 List view

![Proposals list](docs/images/proposals-list.png)

- **Tabs**: `All` / `Draft` / `In review` / **`Past proposals`** (rolls up Submitted / Awarded / Lost / No Bid / Archived — the underlying stage filter still drills further within each tab).
- Stage filter chips (Draft / Pink / Red / Gold / White / Submitted / Awarded / Lost / No Bid / Archived)
- Search by title, agency, PM
- Stat tiles: Total / Draft / In review / Submitted. The **Submitted** stat tile is the count of proposals at the `submitted` stage specifically — distinct from the **Past proposals** tab, which is the broader "everything done" rollup. The tile and the tab don't disagree; they're measuring different things.

### 6.2 Create a proposal

Click **+ New proposal**, or use the **New Proposals** nav entry under Opportunities — both lead to the same launcher.

![New proposal form](docs/images/proposal-new.png)

Pick an **Opportunity** (dropdown of your org's opportunities), optionally override the **Title**, and assign **Proposal manager**, **Capture manager**, **Pricing lead**. Click **Create proposal**. The app seeds six default sections:
- Executive Summary
- Technical Approach
- Management Approach
- Past Performance
- Price Volume
- Compliance Matrix

### 6.3 Proposal detail — tabs

![Proposal detail header](docs/images/proposal-detail-header.png)

#### Overview

Edit title, roles, notes. Right-side **Workflow** panel shows:
- Color-team progression bar with your current stage highlighted
- **Advance to next stage** button
- Close-out buttons (Submitted, Awarded, Lost, No Bid, Archived)

Quick section rollup below shows which sections are Not started / In progress / Draft complete / In review / Approved.

#### Sections

![Proposal sections](docs/images/proposal-sections.png)

Click any section to expand and edit:
- **Title**, **Status**, **Page cap**, **Author**
- Large textarea for prose with live word count

Add custom sections with **+ Add** at the top (specify kind — Technical / Management / etc.). Remove sections from inside the editor.

#### Reviews

Run formal color-team reviews. **Start review** panel:
- Pick color team (Pink / Red / Gold / White Gloves)
- Due date (optional)
- Check reviewers

When you click Start, the review is in progress and reviewers get access. Clicking into a review shows:
- **Reviewer list** with each person's verdict badge and submission state
- **Comments panel** — add section-scoped or general comments, resolve them (the resolve action is recorded with your name)
- **Submit your verdict** (if you're an assigned reviewer) — Pass / Conditional / Fail + summary
- **Close review** (final verdict + summary) or **Cancel review** — only the proposal manager (or an admin) can close or cancel; the action is stamped with their name and a timestamp

![Reviews tab](docs/images/proposal-reviews.png)

Verdicts roll up: any **Fail** → Fail; any **Conditional** → Conditional; else **Pass**. Once a review is closed, the per-reviewer verdicts and the comment thread become read-only history. Open it any time later to see who voted what, what comments were raised, and which were resolved before close.

This is where the responsibility split shows up clearly: the **proposal manager** runs the meeting and closes it; **reviewers** cast individual verdicts; **authors** address comments on their sections; **pricing leads** speak to cost questions. Every one of those actions writes its own row.

#### Compliance

Section L/M traceability matrix. Every shall-statement from the RFP gets a row:

![Compliance matrix](docs/images/proposal-compliance.png)

- **Category** — Section L, M, C, FAR clause, or Other
- **Number** — the RFP reference (e.g., "L.3.2")
- **Requirement text** — the shall statement
- **Volume** — proposal volume this lives in
- **RFP page / Proposal page** — traceability
- **Mapped section** — which proposal section addresses this
- **Status** — Not addressed / Partial / Complete / N/A
- **Owner** — who's responsible

**Rollup panel** shows weighted completion (`complete = 1.0, partial = 0.5, N/A excluded`). **Bulk paste** mode parses one shall statement per line and auto-extracts leading numbers like `L.3.1` or `M-1`.

Each compliance item has its own **owner** field — the person responsible for making sure the proposal addresses that requirement. Status changes are stamped with the editor's user id and updated_at, so you can see at a glance which rows have moved and who moved them. Use this view in pre-submission checks: filter by status = Not addressed, look at owner, walk down the list. Nothing falls through the cracks.

---

## 7. Companies

Per-org directory of customers, primes, subs, competitors, teaming partners, and watchlist targets. Companies are visible to every member of the org. Editing (add / edit / sync / delete) is reserved for Capture, Proposal, and Admin roles — Authors, Reviewers, Pricing, and Viewers see the directory read-only.

### 7.1 List view

![Companies list](docs/images/companies-list.png)

Filter by relationship type. Search by name / UEI / CAGE / NAICS / location / SBA certs.

### 7.2 Search SAM.gov

Click **Search SAM.gov**.

![SAM.gov entity search](docs/images/companies-search.png)

Form prefilled with your org's primary NAICS. Chip row shows all your configured NAICS — click any to swap it into the NAICS field. Filter by company name, UEI, CAGE, state. Pick a **Tag imports as** default (Competitor / Prime / Teaming partner / etc.).

Click **Search SAM.gov**. Results show each match's name, UEI, CAGE, NAICS, location, SBA certifications. Click **Import** on each row to pull its full profile into your directory.

### 7.3 Add manually

Click **+ Add company** on the list view. Same full SAM.gov-aligned form without requiring a UEI.

### 7.4 Company detail

Click any company row.

![Company detail](docs/images/company-detail.png)

Edit any field, change relationship, add notes. **Sync from SAM.gov** button refreshes the profile from the live API (requires a UEI). **Delete** removes it from your directory.

---

## 8. Knowledge base

The Knowledge base is the corpus the FORGE Brain reads when it drafts sections, answers RFP questions, or proposes capabilities. Think of it as your company's institutional memory in a form the AI can actually use.

Two surfaces live here:

- **`/knowledge-base`** — curated **knowledge entries**: hand-authored or AI-promoted capabilities, past performance, named personnel, and boilerplate text that the Brain ranks and quotes from when drafting.
- **`/knowledge-base/import`** — the **corpus**: raw uploaded artifacts (old proposals, RFPs, contracts, debriefs, capability briefs, resumes, brochures, whitepapers, etc.) that the Brain reads to extract knowledge candidates from.

### 8.1 Drop anything in the corpus

Go to **Knowledge base → Import corpus**. Drag files onto the dropzone or click to pick. Up to 50 MB per file. Accepted: PDF, DOCX, XLSX, PPTX, TXT/MD, images. Each file becomes a **knowledge artifact** with a kind tag (proposal, rfp, contract, etc.), file metadata, and indexed plain text.

**AI-assisted kind classification (auto-detect)**: leave the default "Auto-detect" kind selected. After text extraction completes, the Brain reads the document and classifies it into one of the 15 kinds. High-confidence classifications (≥ 60%) overwrite the heuristic kind directly. Lower-confidence suggestions appear as a violet **AI suggests: <kind>** pill on the row, with an **Accept** button and a tooltip showing the AI's reasoning. Click Accept to apply, or leave it alone if you disagree.

**Backfill old uploads**: if you have artifacts uploaded before AI classification existed (they sit at `kind="other"`), the **AI classification backfill** panel appears with a Reclassify button. Each click processes up to 50 candidates. Run it until the panel disappears.

### 8.2 Group the corpus by kind

The corpus list has a **Group by: Flat / By kind** toggle:

- **Flat** (default) — newest-first list, every artifact in one stream.
- **By kind** — artifacts bucket under collapsible kind headers, largest bucket first. Useful when reviewing a single document type at a time ("show me all our debriefs") without manually filtering.

The toggle is per-session and resets on reload.

### 8.3 Open / archive / delete from a row

Each artifact row has three actions:

- **Open** — drill into the artifact's extraction queue: the Brain has already pulled candidate knowledge entries out; you review them and promote the ones worth keeping into real `/knowledge-base` entries.
- **Archive** / **Restore** — hide from the active list without deleting. Useful for keeping a historical record without cluttering the day-to-day view.
- **Delete** — permanent. The file is removed from storage and the row from the DB. Use Archive instead unless the artifact was uploaded by mistake.

### 8.4 Knowledge entries — the curated layer

`/knowledge-base` shows entries by kind:

- **Capabilities** — what your company does. Used when the Brain needs to answer "do we have experience in X?".
- **Past performance** — specific contract / project references with dates, customer, value, outcome. The strongest grounding the Brain can quote.
- **Personnel** — named people with roles, certifications, clearances. Surfaced when the proposal needs key-personnel narratives or resume cross-references.
- **Boilerplate** — reusable language: company overview, security posture statements, compliance affirmations. Anything you find yourself pasting into every proposal.

Click any entry to open the editor.

### 8.5 Entry quality score

The editor shows a **Quality score** panel (violet-bordered) with a tone-coded percentage:

- **Emerald ≥ 70%** — strong asset, Brain will surface it confidently.
- **Amber 40–69%** — usable but light on signals; the Brain will quote it with less weight.
- **Rose < 40%** — bare-minimum row; consider adding content or archiving.

Below the percentage is the **per-factor breakdown**:

| Factor | What it measures |
|---|---|
| Body length | Long enough to be reusable (curve: 200 chars = 0.3, 1000 = 0.7, 4000+ = 1.0) |
| Body structure | Paragraph breaks, bullets, headings |
| Title | Non-trivial title length (5–128 chars sweet spot) |
| Tags | At least one tag attached |
| Metadata | Structured metadata fields (e.g., year, agency, value) |
| Kind-specific signals | Kind-aware bonus: dates + agency for past performance; deliverables / outcomes for capability; certifications / experience for personnel |

The score re-computes on every save. Low scores aren't a verdict on the entry — they're a hint about what to add. An entry can be excellent at any score; the percentage just reflects how many signals the Brain can pin down.

**Org admin only**: there's a **Score unscored** button in the `/knowledge-base` header that retroactively scores entries that predate the quality-scoring feature (i.e., `quality_scored_at IS NULL`). Same idempotent backfill pattern as "Embed missing". Click as many times as needed; processes 100 entries per click.

### 8.6 Tips for getting the most out of the Knowledge base

- **Upload everything**. The Brain ranks by relevance, not recency. Old contracts from five years ago still ground the Brain when you're pursuing a similar deal today.
- **Don't fight the AI suggestion**. The classifier is conservative; high-confidence suggestions are usually right. If you disagree, just don't click Accept — your manually-set kind stays.
- **Fill in metadata for past performance**. Year, agency, customer, value — each adds a measurable bump to the quality score AND gives the Brain something concrete to quote. A past-performance entry without dates is a paragraph, not a reference.
- **Tag liberally**. Tags are how you (and the Brain) find entries again. NAICS codes, set-aside types, technology stacks, agency abbreviations — all useful tags.
- **Archive rather than delete**. The Brain learns from outcome patterns; deleting an entry erases that signal. Archive keeps the history while removing the entry from active recommendations.

---

## 9. What FORGE records (the audit trail)

FORGE has two complementary trails. **Feature-level activity** lives next to the record it describes — stage changes on the opportunity's Activity timeline, review verdicts inside the review, compliance status next to the line. **`/audit-log`** is the unified org-wide stream that records every mutating action (and sensitive reads like PDF exports and share-link loads). Each entry stamps the actor, the action verb, the resource, IP, user-agent, structured metadata, and a timestamp.

The two trails answer different questions. For "what happened to *this* deal?", read the timeline on the record. For "what did our team do this week?" or "did anyone outside the org load our share-link?", filter `/audit-log`.

The inventory below covers the feature-level trails. `/audit-log` is described in §9.12.

### 9.1 Stage history on opportunities

Every stage change writes a row to the **opportunity Activity** timeline (§5.4). The row includes the actor, the prior stage, the new stage, the reasoning note, and a timestamp. You cannot delete or edit these rows. If a deal moved Identified → Capture → Submitted → Lost, you will see four entries in order with the rationale for each.

### 9.2 Gate decisions

No-bid and lost decisions are required to carry a reasoning note (§5.4 Evaluation tab). Like stage history, they live on the Activity timeline and cannot be edited or removed. This is the single most useful trail when leadership asks "why did we walk away?".

### 9.3 Evaluation saves

Saving the qualification scorecard writes a system-attributed entry recording the new rollup score and the rationale field. Re-scoring later writes another entry — you can read the timeline to see how your assessment of the deal evolved.

### 9.4 Competitor changes

Adding or removing a competitor on an opportunity writes a row. The competitor record itself carries a created_at and updated_at, so you can tell when a competitor was first identified and when their notes were last revised.

### 9.5 Manual notes, meetings, actions

Anyone with edit access can post Note / Meeting / Action entries on an opportunity. They show the author, kind, body, and timestamp. The author can delete their own entries; nobody (not even an admin) can edit them after posting. If something needs correcting, post a follow-up.

### 9.6 Proposal review history

Reviews are first-class records. For each one FORGE keeps:

- The color (Pink / Red / Gold / White Gloves), schedule date, and who started it
- The full assigned reviewer list
- Each reviewer's verdict (Pass / Conditional / Fail), summary text, and submission timestamp
- Every comment, the section it was anchored to, who posted it, and whether/when it was resolved
- The closing verdict, summary, and who closed (or cancelled) the review

Closed reviews are read-only. You can open a closed review months later and replay exactly how the team voted and what changed between rounds.

### 9.7 Section status changes

Every proposal section carries `status`, `author`, `updatedAt`, and a free-text body. Updates to any of those bump `updatedAt` and stamp the editor; the previous body is overwritten in place (FORGE doesn't yet keep prior versions of section text — that's planned). For "who has touched this section recently?" use the updatedAt + author. For substantive content history, use review comments and verdicts.

### 9.8 Compliance matrix history

Each compliance item carries an owner, status, mapped section, and updatedAt. Status flips are stamped with the editor. The Rollup panel always reflects the current state; the per-row updated_at lets you see how recently each shall statement moved.

### 9.9 Organization profile

Saving the **Settings** page updates `organization.updatedAt`. The previous values are not retained as a separate history (intentional — most edits are corrections, not policy changes), but every save is gated to admins, so the set of people who *could* have changed a field is bounded by who carries the Admin role.

### 9.10 Membership changes

Inviting, role-changing, disabling, or removing a member updates the membership row, stamps `updated_at`, and (for invites) sends an email that becomes a record in your Resend dashboard. The audit picture is: who was a member, with what role, between when and when. Disabled rows are kept rather than deleted so the historical record stays intact.

### 9.11 What's *not* recorded yet

Be honest about the limits:

- We don't keep prior versions of section prose, organization-profile fields, or compliance text.
- We don't keep a history of org-profile field edits — only the current value.

Where these are needed, ask in the next planning round and we'll add them.

### 9.12 `/audit-log` — the unified stream

Open **Operations Management → Audit Log** from the sidebar. The page shows every recorded action across your tenant, newest first, with filters for:

- Free-text search (action verb, resource type/id, actor email)
- Actor (any member who appears in the log)
- Resource type (Opportunities, Proposals, Solicitations, Knowledge, Users, Settings, Templates, Companies, Notifications, **Authorization (denied)**)
- Date range
- CSV export of the filtered set (for offline analysis or external audit; capped at 50,000 rows per export)

Each row carries the actor, what they did, the resource id, IP address, user-agent, and a free-form metadata object that captures useful fields like the new value of an updated field or the count of imported items. Click **Detail** on a row to inspect the metadata JSON.

Retention defaults to 365 days; admins can adjust this between 90 and 3,650 days under **Settings → Audit log retention**. A nightly job prunes rows older than your window.

Sensitive reads (PDF / DOCX render, downloads of a render, share-link loads, USAspending lookups) are recorded too — they carry a `read` chip next to the action so you can distinguish them from mutations at a glance.

### 9.13 How to use the trail

Three habits make the audit trail actually work:

1. **Write meaningful reason notes.** "Moved to Lost" is a wasted note; "Lost — incumbent's price came in 18% below our floor; debrief scheduled 5/12" is a useful one.
2. **Don't hand off informally.** If you're handing an opportunity to a different owner, change the owner field on the record (not just in chat). The change is reflected on the Activity timeline.
3. **Read the timeline before status meetings.** It's faster than re-asking the team where things stand, and it forces the team to keep the record current.

---

## 10. Notifications inbox

Click the **bell icon** in the top-right of any page to open the notifications panel, or navigate to `/notifications` from the sidebar's **Operations Management** group.

What lands in your inbox:

- **Color-team reviews you've been assigned to** (pending) and **reviews you participated in** (completed)
- **@-mentions** in review comments — when a teammate writes `@you` in a comment thread, FORGE notifies you with a deep link to the exact comment
- **Opportunity bid/no-bid review responses** (when you sent the opportunity out for an external bid/no-bid recommendation, and the reviewer submits theirs)
- **Solicitation role assignments** — when a teammate assigns you to a role on a solicitation (e.g., Pricing lead, Capture lead)
- Anything else covered by your tenant's notification rules (see ADMIN_MANUAL §5)

Each row shows who triggered it, when it happened, a short subject, and (when present) a click-through link to the record. Acknowledge a notification by opening it — the inbox tracks which rows you've read and which are still new (a numeric badge on the bell icon shows the unread count).

Notifications are kept indefinitely; there's no auto-prune. If you want to clear visual clutter, mark a row as read by opening it.

### 10.1 Frequency and digest

Your tenant admin decides whether each kind of notification arrives **immediately**, in a **daily digest** (one row per recipient per day rolling up all matching events), or a **weekly digest** (one row per recipient per Sunday rolling up the week). Defaults are immediate for everything; admins can tune this under `/notifications/rules`. If you're getting too many or too few, that's where to ask them to adjust.

### 10.2 Test sends

A `[Test send]` prefix on the subject means an admin fired a test from the rule editor to verify the rule's recipient + channel wiring. The body explains who fired it and that the event is synthetic — you can safely ignore the contents.

---

## 11. Signing out and switching orgs

### 11.1 Sign out

Click your avatar at the top-right → **Sign out**.

### 11.2 Switching organizations

If you belong to multiple organizations, your active org is the first one you joined. (Multi-org switching ships in a future release.) If you need to change orgs right now, ask your admin to adjust your membership directly.

---

## Getting help

If something's not working as described here, capture a screenshot and send it to your admin. They can see Vercel logs and Neon data directly; most issues are env-var or permission misconfiguration we can fix quickly.

For the in-app version of this manual, click **Help** in the sidebar — the markdown is rendered there with the same content you're reading here, so updates ship together with the code that changes the UI.

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

Click **Forgot password?** below the sign-in form. Enter your email — you'll get a reset link (valid for 1 hour). This works for every account, including one you created with **Continue with Google / Microsoft** (it simply sets a password on it) and one where you were invited but never finished creating a password. If no email arrives, contact your administrator: they can issue the reset link from the admin portal and send it to you directly.

### 1.5 Accepting an invitation

If a teammate invited you, your email has a link that looks like:
```
https://www.sysgov.com/sign-up?invite=...&id=...
```

Clicking it lands you on a sign-up page pre-filled with your email (you can't change it). Enter your name + password and click **Accept and create account**. You'll be signed in immediately and placed in your teammate's organization with the role they assigned you.

If your organization uses SSO, you can instead go to the sign-in page and use **Continue with Google / Microsoft** with the invited email address: the invitation is matched to that address and accepted automatically. Your admin may also hand you the invite link directly (for example in chat) — it is the same link the email carries.

By default you can only join the organization that owns your email domain. If you were invited to an organization from a different domain, the invitation is held until a platform administrator approves it: you will not receive the email until then, and a link that lands on **Invitation awaiting approval** means exactly that. Once approved, the invitation arrives as described above.

---

## 2. The app layout

After signing in you'll see the main **app shell**:

![App shell](docs/images/app-shell.png)

- **Left sidebar** — collapsible navigation with a wide mode (full labels + group headers) and an icon-rail mode (icons only, hover to see labels). Click the chevron at the top to toggle. Groups: Command Center, Operations, Opportunities, Platform Intelligence, Help, and Platform Administration (superadmin only). Operations + sub-pages are gated to org admins. Sub-items render with tree-connector lines so the hierarchy stays visually obvious. See §2.2 for the full nav structure.
- **Top bar** — the mobile hamburger, the **⌘K search box** (find a page or a record, or ask the Brain — see §2.1.1), live session clock, Settings shortcut, and your avatar
- **Content area** — changes with the page you're on
- **User identity card** — pinned at the bottom of the sidebar. Shows your name, email, and active org. Click your avatar in the top bar (or the identity card directly) to open the user menu.

The top-right avatar is your **user menu**. Click it to see your name/email and sign out.

### 2.1 Sidebar navigation — three workspaces

The sidebar shows one **workspace** at a time, scoped to the hat you are wearing (BL-NAV-WORKSPACES). People who wear more than one see a **Workspace** switcher under the FORGE mark (three segments: Workspace · Company admin · Platform admin; lettered squares W · C · P when the sidebar is collapsed); everyone else sees only their own.

| Workspace | Who | What it contains |
|---|---|---|
| **Workspace** (subtitle "Proposal Ops") | every member | Command Center; Opportunities (Dashboard, Pipeline, Scout, New Opportunity, Import from SAM.gov, Paste from eBuy, Paste GSA email, Solicitations, New Solicitation, In-flight Proposals, New Proposals); Platform Intelligence (Company Search, Add company, FORGE Brain, Loss intelligence, Awards & recompetes, 8(a) firms, Watchlist, Saved searches, Knowledge, Knowledge import, USAspending import, New knowledge entry); Operations Management (Settings, Integrations, AI Engine — read-only for non-admins — and Notifications); **Administration — org admins only** (Users & Roles, Billing, Templates, Notification rules, Audit Log); Help (User guide, Admin guide for admins, FAQ) |
| **Company admin** | org admins | People (Users & Roles); Organization (Settings, Billing, Templates, Integrations, AI Engine); Governance (Notification rules, Audit Log); Admin guide |
| **Platform admin** | platform superadmins | Tenants & users (Tenants, Platform users, Overview, Source requests); Commercial (Subscription tiers, AI usage & costs, Promo codes); Operations (Background jobs, Production errors, Database migrations, SBA 8(a) registry, cross-tenant Audit Log); Admin guide |

The everyday Workspace is the complete map of the product: everything a member can open is listed there, and an admin also sees the Administration group in the same tree, so administering the organization never requires switching (BL-NAV-RESTORE). Regular members never see the Administration group or the Admin guide.

The workspace you pick with the switcher sticks: it stays while you open pages it lists (an admin opening Users & Roles from the everyday tree stays in it), and only changes when you open a page it does not list — a platform-admin URL opens the platform workspace, a bookmark opens the workspace that lists it. A superadmin with no tenant membership lands in Platform admin, which has no tenant pages at all; to work inside a tenant they use **Assume identity** on the tenant's page.

#### 2.1.1 ⌘K — find anything, ask the Brain

Press **⌘K** (Ctrl+K on Windows) anywhere in the app, or click the search box in the top bar, to open the command palette. One box does three things as you type:

- **Go to** — every page your sidebar lists, ranked by how well its name matches ("scout", "ai eng", "new prop"). You only ever see pages you can open: members never see the Administration or Platform admin pages here.
- **In your workspace** — opportunities (by title, agency or solicitation number), proposals, solicitations, companies (by name or UEI) and knowledge entries of your organization, a few per kind, most recently touched first.
- **Ask the Brain** — type a question ("What did we do for NAVSEA?", "Do we hold a CMMI appraisal?") and press Enter on the *Ask the Brain* row (it sits first when your text reads as a question, last otherwise; any text of six characters or more can be asked). The answer is written **only from your own Brain** — knowledge entries and imported documents — in a few sentences that cite their sources by number, with the cited sources listed underneath as links; a source marked *won* comes from a winning proposal. When the Brain has nothing that answers, it says so and suggests what to add. **Confidence** is how completely the sources answered. If AI is not enabled for your plan, or the monthly AI request quota is spent, the row explains why instead.

↑/↓ move, Enter opens the highlighted page or record (or asks), Esc closes (or, on an answer, goes back to the box). Brain questions are recorded in the Audit Log as `brain.answer`.

The older single-tree description below is kept for reference; the group-visibility rules are unchanged (admin-only children still hide from members).

Each group is collapsible — click the group header (or its chevron) to fold its children. Group visibility depends on your role: Operations Management only shows for org admins; Platform Administration only shows for superadmins.

| Group | Children | Who sees it |
|---|---|---|
| **Command Center** | (none — direct link to `/`) | Everyone |
| **Operations Management** | Audit Log, Notification rules, Users | Org admins |
| **Opportunities** | Opportunities Dashboard, In-flight Proposals, New Proposals, Pipeline, Companies | Everyone |
| **Platform Intelligence** | Knowledge base, Watchlist, Firms, Awards, Solicitations | Everyone |
| **Brain** | (direct link) | Everyone |
| **Help** | User Guide, Admin Guide, FAQ | Everyone (admin guide only for admins) |
| **Platform Administration** | SuperAdmin portal, Audit log (cross-tenant), Tiers, Promo codes | Superadmins |

**Collapse to icons.** The chevron at the top of the sidebar toggles between **wide mode** (full labels) and **icon-rail mode** (icons only). Icon mode is what you want when you need a wider content area — the labels still appear on hover. Your preference persists across reloads.

**Tree-connector lines** render under sub-items so the hierarchy stays obvious at a glance, even in icon-rail mode.

**User identity card** at the bottom of the sidebar shows your name, email, and active org. It replaces the older FORGE Brain promo card — direct way to confirm "am I in the right tenant?" before you click anything destructive.

### 2.2 Command Center vs. Opportunities Dashboard

The default landing page after sign-in is the **Command Center** (`/`). It's the at-a-glance home — a 10-tile stage grid for opportunities (count + value range + due hint per stage), a "Next deadline" panel highlighting the soonest non-past-due opportunity, and a "Proposal stages" breakdown. Clicking any tile **navigates** to the Opportunities Dashboard pre-filtered to that stage.

Two panels appear only when there is something to say. **Needs attention** lists open work that looks like a recompete of a pursuit you already decided. **PWin movers** (BL-AIP-7b) lists the live pursuits whose calibrated PWin moved most over the last seven days — from → to, the stage, the model's confidence, and the one or two factor changes behind the move (an evaluation that was scored, an incumbent that appeared, a proposal whose readiness changed). Every night FORGE freezes the model's estimate for each live opportunity when it changed, so a move is always explained by something that happened in your pipeline. The same panel, longer, is on **FORGE Brain** (`/intelligence`).

The **Opportunities Dashboard** (`/opportunities`) is the same tile grid plus an editable filter + search + the per-opportunity list. Clicking a tile here **filters in place** rather than navigating.

Both pages source from the same `getOrganizationSnapshot()` aggregate, so the numbers can't disagree. Mutations on either page (creating an opportunity, advancing a stage, closing a review, etc.) refresh the Command Center on the next nav with no manual reload.

#### 2.2.1 Getting started from your UEI (org admins)

Until your organization has a UEI, its NAICS codes, scout keywords and a capability statement, org admins see a **Getting started** panel at the top of the Command Center (members never see it, and it disappears on its own once the four are in place):

1. **Your SAM.gov registration** — enter your 12-character Unique Entity ID and click **Pull from SAM.gov**. FORGE fills in the company profile (name, address, CAGE, NAICS codes, set-asides) exactly as **Settings → Sync from SAM.gov** would. If the panel says SAM.gov lookups are not configured, ask your platform administrator, or fill the profile by hand under Settings.
2. **A starting setup, proposed by the AI** — click **Propose a starting setup**. From the registration alone the AI drafts a **capability statement** (bracketed placeholders such as `[contract number]` mark facts only you can supply — it never invents contracts, customers or staff), picks **scout keywords**, suggests **extra NAICS to watch** and names **target agencies** with a reason each. Edit the text, remove or add keywords (Enter adds one), remove codes or agencies, then **Save to FORGE**: the keywords and extra NAICS go to the Scout profile (added to anything already there), the statement becomes a knowledge entry tagged `onboarding` that the Brain can cite, and the target agencies are kept with it. Tick **Run the scout now** to get the first overnight-style finds immediately. **Propose again** asks for a fresh proposal.

If AI is not enabled for your plan the second step explains why; when the platform runs without a live AI provider the proposal is built from the registration only and says so.

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

### 4.12 AI Engine — budget, routing and draft quality (admins)

**Settings → AI Engine** opens with the control panel (BL-AIP-7c). **Monthly AI budget** shows this month's tokens and requests against your cap — the lower of your tier's cap and a budget you set here — with the pace so far, the projected month-end total, the day the cap would be reached at that pace, and tokens per day as bars. An org admin can set a token and a request budget; a budget can only lower the tier cap (a value at or above it clears it), and once the lower of the two is reached the AI refuses further calls this month until the 1st. **Model routing by feature** lists every AI feature with its default model class (fast, standard or strong), the model it will actually request and this month's calls, tokens and errors; an org admin can move a feature to another class from the row — for example run section drafting on the fast class during a crunch, or opportunity triage on the strong class — and the change applies on the next call. A feature whose model was pinned by a platform admin shows "pinned by platform" and cannot be changed here. Below the panel are the configured providers and the **golden eval** (BL-AIP-5b): every section of a proposal you marked **won** with at least 150 words is a benchmark case. **Run eval (3 cases)** asks the AI drafter to write those sections again from the solicitation context alone (the saved text is withheld) and scores each draft against the text that won — shared vocabulary (45%), length fit (20%), specificity of numbers and names (20%) and placeholder-free prose (15%), plus win-theme coverage when the proposal has themes. Each run is one row keyed by the drafter's prompt version and the model, so after a prompt change you can see whether the drafter moved closer to what wins for you. Three AI requests per run; org admins only. Treat the score as an upper bound: the Brain may already hold the winning text, so the drafter can be helped by fragments of the answer.

### 4.13 Save / Reset

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

### 5.2.1 The nightly scout

**Opportunities → Scout** (`/opportunities/scout`) is the import page run for you every night (BL-AIP-7b). At 09:00 UTC the scout re-runs your organization's NAICS codes and up to three keywords against SAM.gov for notices posted in the last few days, turns any award on your **Watchlist** whose period of performance ends within six months into a recompete candidate, and drops anything you already imported or already saw. Each find is scored 0–100 with the reasons shown as chips — your primary NAICS, a set-aside you qualify for (or do not), a likely recompete of a pursuit you won or lost, your record at that agency, a keyword hit, a due date that is too close — and the ten best are triaged by the AI as **Pursue**, **Watch** or **Skip** with a short rationale and next steps.

Work the list from the top. **Import as opportunity** creates the opportunity (stage Identified, or Sources sought for RFIs and sources-sought notices) and links to it; **Dismiss** remembers the find so it is not shown again. Every decision grades the scout — an import confirms a Pursue and refutes a Skip, a dismiss does the reverse — and the newest decisions are shown to the next night's run so it learns your taste; the header shows the scout's accuracy. Org admins set the keywords, extra NAICS codes and the look-back window at the top of the page, can pause the nightly run, and can **Run scout now**. A find marked "Scored · not triaged" was found after the run's AI budget was spent (or while the AI provider is in stub mode); its score and signals still stand.

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

**AI pursuit brief (BL-AIP-7a).** The panel on the right gives a **Pursue / Watch / Consider no-bid** call with a confidence, a 5–8 sentence brief, the signals that drove the call and next actions. It is grounded in what FORGE already knows: the calibrated PWin and its factors (and how well that model has predicted your past outcomes), past bids that look like this one with what the team wrote down afterwards, your record at this agency and who beat you there, the patterns you have lost on, and matching passages from your own corpus. Briefs are kept — the last one shows when you open the page — and a new one is only written when something that matters has changed (or you click **Regenerate**). Answer **Was this useful?** to record feedback. When the pursuit closes (gate decision or proposal outcome), every brief that made a call on it is graded against the result; the panel's eyebrow shows the running track ("3 right, 1 wrong · 75%"). A "Watch" call is a hedge and is never counted right or wrong.

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

### 5.5 Pipeline brief (FORGE Brain page)

**Intelligence → Pipeline brief** writes a 4–7 sentence take on your whole portfolio — what to chase, what to abandon, what is at risk this week — with **Priorities this week** and **Risks** listed underneath. Since BL-AIP-7a it is grounded in the PWin model's track record and your loss intelligence (the patterns and competitors you keep losing to), it is stored (the last one shows on load; a new one is written when the pipeline changes or you click **Regenerate**), and you can mark it useful or not.

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

**Outline from Section L (BL-AIP-5b).** When the opportunity has a parsed solicitation with instructions to offerors, the form offers **Build the outline from the solicitation's Section L** (on by default). The AI reads Section L, Section M, the extracted requirements and key dates and replaces the template's list with the sections the instructions actually ask for — in their order, with each section's page cap and a short brief of what it must contain — sets the opportunity's due date when it was blank, and proposes one to three win themes grounded in the evaluation factors (only when the proposal has none). It costs one AI request; if it fails, the template is used and the overview says why. The brief travels with the section: the AI drafter treats it as that section's contract.

### 6.3 Proposal detail — tabs

![Proposal detail header](docs/images/proposal-detail-header.png)

#### Overview

Edit title, roles, notes. Right-side **Workflow** panel shows:
- Color-team progression bar with your current stage highlighted
- **Advance to next stage** button
- Close-out buttons (Submitted, Awarded, Lost, No Bid, Archived)

Quick section rollup below shows which sections are Not started / In progress / Draft complete / In review / Approved.

**Outline from Section L** panel shows what the AI read in the instructions — each section with its page cap, source clause and brief, the due date, the proposed themes and any formatting notes — and offers **Build outline** / **Rebuild outline** for proposals created before this or after a solicitation was re-parsed. A rebuild never deletes a section that has text: it refreshes the page cap and brief of matching sections, adds missing ones, removes only empty ones the instructions do not ask for, and orders the rest after the instructed sections.

#### Sections

![Proposal sections](docs/images/proposal-sections.png)

Click any section to expand and edit:
- **Title**, **Status**, **Page cap**, **Author**
- Large textarea for prose with live word count

Add custom sections with **+ Add** at the top (specify kind — Technical / Management / etc.). Remove sections from inside the editor.

**AI edits arrive as tracked changes (BL-AIP-6).** When a section already has text, the AI assistant's **Improve**, **Tighten** and **Draft** results, the chat's **Apply**, and the Brain's **Insert** no longer replace the section. They land as tracked changes authored **FORGE AI** — the same green insertions and red strikethroughs a teammate leaves in Suggest mode — and the Track changes panel opens so you accept or reject each change. Tables, lists, links and formatting outside the edited words are untouched, and pending suggestions from teammates are settled to their original text first so there is one consistent set to review. Every accept or reject is recorded against the AI author, which is how the Draft Insights panel and the drafter itself learn what this team keeps. **Replace section** is still there as the secondary button when you really do want the whole thing swapped.

**Research while you write.** Under the editor, the **Research while you write** rail refreshes a couple of seconds after you pause: Brain passages for the paragraph your cursor is in (winning proposals first — click into another paragraph and, after the same pause, the passages follow it), requirements mapped to this section that the draft does not cover yet (with the missing terms named), win themes it does not reinforce, and any contradiction the last health scan raised between this section and another. **Insert as suggestion** drops a passage in as a tracked FORGE AI insertion. The rail uses one embedding lookup per refresh and no drafting calls, and is rate-limited per user.

**Open review comments in the editor.** When a colour-team review — or the FORGE AI pre-review that runs as a review starts — has left comments on a section, the section row shows a ✎ count and the expanded section lists them above the AI panel: the review colour, the reviewer (or **FORGE AI** with the finding's severity), the text, **Resolve**, and a link to the review. Resolving here is the same as resolving on the review page and is recorded in the Audit Log; a resolved comment also stops appearing in what the drafter reads as open feedback for that section.

**Their words.** Evaluators respond to hearing their own language. Once a solicitation is parsed, FORGE reads the agency's own phrases out of it — the evaluation language of Section M first, then the recurring phrases of the requirements and the mission words of the opportunity — and the rail's **Their words** group shows how many of them this section already echoes and which it does not yet (hover a phrase to see the sentence it came from). With **echo in AI drafts** on (the default, per section), Draft, Improve, Tighten and the section chat say the same thing in the customer's words where a paragraph is about the same topic; they never force a phrase into an unrelated paragraph or quote the solicitation at length. Untick it for sections where you want your own vocabulary only.

**Documents in the chat.** Under the chat thread, 📎 **Attach a document** takes a PDF, Word, Excel, PowerPoint or text file (up to 20 MB, five per section). FORGE extracts its text and keeps it with this section's conversation only: the AI reads it as a reference for your next messages ("model my Technical Approach on this structure", "use the terminology from the attached SOW"), quoting at most short phrases and never presenting the document's facts as yours. Each attachment shows as a chip with its size; **Save to Knowledge** turns it into a Knowledge artifact the Brain can search (the chip then links to it), and × removes it. **Clear chat** removes the attachments with the thread.

**Pages against the cap, as you type.** When a section has a page cap, its header and the line above the editor show a small ring with the live estimate — "1.8 / 3 pages" — at 350 words per page, the density Draft, Tighten and the health scan assume. The ring is grey while the section is still thin, green within the cap, amber from 90% of it and red once over ("4.2 / 3 pages · over by 1.2"); hover it for the words of room left or the overrun. It follows the cap field as you change it, before you save. Nothing interrupts your typing; when you are over, **Tighten** is the way back.

**Tone.** Under the editor, the **Tone** line checks the section in your browser as you type (no AI call): marketing language that claims without evidence ("world-class", "leverage", "seamless" and about thirty more, with technical uses such as "unique identifier" left alone), the share of sentences in the passive voice, and the reading level as a Flesch-Kincaid grade against the federal evaluator standard of grade 14 (college sophomore). The line is green when nothing is flagged, amber or red otherwise; open it for the three rows — the grade and average sentence length, the passive sentences with examples, and each flagged phrase with what to write instead. **✨ Fix with AI** opens the AI panel on **Improve** with those findings as its guidance — replace these phrases, recast the passive sentences, bring the grade down, change no facts — and the result arrives as tracked changes you accept or reject. The reading level needs about 40 words and the passive share five sentences before they are judged; the heuristics are approximate (an adjective such as "is experienced" counts as passive), so treat the panel as a second reader, not a gate.

**The thread is the team's.** Every section's chat is one thread for everyone on the proposal: the AI exchanges show who asked, and **Note** beside **Send** posts a message to your teammates without asking the AI (it shows in its own colour as "Ana · note to team" and the AI never reads it). Type `@` in the chat box to mention a teammate by name or email (arrow keys, Tab or Enter pick one); anyone you mention in a note or a question gets a notification, in-app and by email under the default rules, that opens the editor on that section with the chat showing. Use it where you used to open a Slack thread about a section: the conversation stays with the work.

**Side by side.** **⇆ Side by side** in the AI panel's header (or next to the word count) puts the chat on the left and the draft on the right, so you talk to the AI while you watch the section. When a reply reads as a rewrite of the draft — it keeps or edits at least one of your paragraphs — the right pane switches to **Edits preview** as the reply streams in: each paragraph is marked kept, new, removed or edited, with the changed words highlighted. Untick the paragraphs you do not want and **Apply n of m as tracked changes**; the ones you took land as FORGE AI tracked changes in the editor, the rest stay exactly as you wrote them, and you accept or reject each change in Track changes as usual. A reply that answers a question rather than rewriting leaves the editor in view; **Preview as edits →** on any reply opens the preview anyway. **Draft** returns to the editor, **⇆ Stacked** returns to one column, and the choice is remembered on this browser.

**Slash commands.** Type `/` in the chat box and the commands appear; arrow keys, Tab or Enter pick one, and the chips under the box start one with a click. `/win-theme` rewrites the draft to reinforce every win theme (or `/win-theme 2`, `/win-theme Zero trust by default` for one); `/shrink-by 30%` cuts it by a share, or by `200 words` or `1 page`, keeping every fact, number, marker and requirement reference; `/add-citation` marks every concrete claim with its source or `[NEEDS CITATION]`; `/check-compliance` lists each requirement mapped to the section as addressed, partly or missing with the sentence that answers it, then the gaps to close first, without rewriting; `/voc` rewrites in the customer's own words where the topic matches. The thread shows the command you typed with its meaning beneath; the AI receives the full instruction behind it. A command without what it needs ("/shrink-by" alone) is explained in place, with your text left to fix, and costs nothing.

**Dictate.** The 🎙 button beside **Send** turns speech into text in the chat box: click it, talk, click ■ to stop. In Chrome, Edge and Safari the browser itself does the transcription, so nothing leaves your device, the words you are saying show under the box as they are heard, and finished phrases drop into the box as prose (a new sentence starts with a capital; a slash command you dictated stays a command). Other browsers record a clip of up to two minutes and send it to be transcribed, which works only when your organization's server has a transcription provider configured; without one the button is disabled and its tooltip says why. The first use asks for microphone permission. Dictated text is ordinary text: edit it, add a slash command, then **Send**.

**Graphics.** Evaluators remember a good diagram longer than a paragraph. Under the editor, **Graphics → Suggest graphics** reads the section and proposes up to three diagrams drawn only from what you have written: a notional architecture when the text names components (users, portal, API, database, cloud), a process flow when it walks through steps, an organization chart when it names roles, a timeline when it names periods or milestones. Each arrives with one sentence on what the evaluator gains and a preview. **Insert into section** adds it at the end as an image — drag it where it belongs, then save; it prints in the PDF export, is not a tracked change, and the Word export does not carry images yet. **Copy Mermaid** gives the same diagram as text for other drawing tools; **Download SVG** saves the file for a designer to finish. The suggestions are starters: check every box against the facts, since the AI only arranges what the section says, and a sparse section yields nothing.

**The drafter and the chat write in the author's voice.** When a section has an author (the owner picked in the editor) and that author has built a voice profile, the AI writes it the way they write: sentence length and rhythm, active or passive, plain or technical words, "we" or "you", contractions, numbers, lists, their typical openers and phrases. Build yours under **Settings → My writing voice**: it reads the sections you own in this organization (120+ words each) plus anything you paste there (an email thread, a white paper), shows the traits it found and exactly what the AI is told, and takes your own notes ("never say leverage"). Switch it off any time; voice changes how things are said, never the facts.

**The drafter and the chat read what the team has learned.** Open reviewer comments on the section, weaknesses the agency cited in past debriefs, gaps found against past winners (same agency first) and how much of past AI drafts this team kept now reach the AI, with instructions to resolve comments in the text and answer criticisms with evidence rather than mention them.

#### Reviews

Run formal color-team reviews. **Start review** panel:
- Pick color team (Pink / Red / Gold / White Gloves / Green — the price-volume review)
- Due date (optional) and **instructions to reviewers** — what this round should concentrate on
- Check reviewers, and for each one tick the sections they read (no ticks = the whole proposal)
- **Checklist** — the colour's template of what to check, which you can trim or extend; the round keeps its own copy
- **Carry open comments from** — when an earlier round closed with comments still open, pick it here and they reopen on the new round (marked "from Pink Team") and close on the old one, so nothing raised at Pink is lost by Red

When you click Start, the review is in progress and reviewers get access. Clicking into a review shows:
- **Section coverage** — a sections × reviewers grid; sections nobody covers are flagged, and the lead can re-scope anyone while the round is open
- **Reviewer checklist** — assigned reviewers tick their own copy and can leave a note per line; everyone sees each reviewer's progress
- **Reviewer list** with each person's verdict badge and submission state
- **Comments panel** — add section-scoped or general comments, resolve them (the resolve action is recorded with your name)
- **Consolidated comments** — every reviewer's comments folded into one per-section summary (open / resolved, who said what) with **Copy report**: the Markdown hand-off the writers work from after the round
- **Round debrief** — **Summarise this round** reads every comment, verdict and checklist tick and writes the debrief: a headline, themes that cut across reviewers, the must-fix list, strengths to keep and the lead's next steps. It is stored on the round and copies as Markdown; it counts one AI request and needs AI drafting on your tier. Without a live model it is built from the comments themselves.

**Reviewers are nudged the day before.** If a round has a due date, the reviewers who have not yet submitted a verdict get a reminder (in-app and email by default) the day before it is due, or once if it is already overdue. Admins can change or switch off the "Color-team review due soon" rule under notification rules.
- **Submit your verdict** (if you're an assigned reviewer) — Pass / Conditional / Fail + summary
- **Close review** (final verdict + summary) or **Cancel review** — only the proposal manager (or an admin) can close or cancel; the action is stamped with their name and a timestamp

![Reviews tab](docs/images/proposal-reviews.png)

**FORGE AI reviews first.** When you start a review, the AI reads each drafted section (up to eight) against its mapped requirements and the win themes for that colour — pink for structure and compliance shape, red as the evaluator scoring against Section M, gold for polish and consistency — and leaves up to three findings and a verdict per section as comments authored **FORGE AI**. Human reviewers open the review to findings rather than a blank thread; resolve a comment once it is addressed, because open ones are fed to the section's drafter and chat. This needs AI drafting enabled on your tier and counts one AI request per review.

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

**Answers from the contracting officer (BL-FB-SOL-QA).** When the agency answers industry questions, the answers often change what a requirement means. On the solicitation page, **Q&A from the contracting officer** collects them: FORGE checks the SAM.gov notice once a day for new "Questions and Answers" attachments (and Q&A written into the notice itself) when the solicitation has a notice ID, and **Check SAM.gov now** reads it on demand; **Paste Q&A** takes answers you received by email, in the usual `Q1:` / `A1:`, `Question:` / `Answer:` or `Government Response:` forms. Each answer shows its source and date and the requirements it refines — matched by the section reference it names (`L.5.2.1`, `PWS 3.2`) or by the words it shares with the clause — and the requirement list marks those clauses **amended by Q&A**. In the compliance matrix, the matching rows of your proposals on that opportunity carry the answer with a link back, so nobody writes to the original wording after the agency has changed it. The team assigned to the solicitation is notified when new answers land. An answer is stored once even if the same document is read again.

**The matrix starts full (BL-AIP-5).** When you create a proposal on an opportunity whose solicitation has been parsed, every requirement the intake pipeline extracted becomes a row automatically, categorised from its reference (`L.…` → Section L, `M-…` → Section M, `C.…` / `PWS` / `SOW` → Section C, `FAR …` → FAR clause), and the rows are mapped to your seeded sections in the background where the AI is confident. Intake itself now reads the **whole** document in windows rather than the first 80,000 characters and a "top 25" sample, and merges the clauses from companion PWS / SOW / attachment uploads, so a requirement on page 140 reaches the matrix. For proposals created before this, or when a solicitation was parsed later, click **Seed from solicitation** (it skips rows that already exist) and then **Auto-map**. Deleting a companion document removes its clauses on the next merge; re-parsing the main RFP keeps them.

**Parses finish, or say why not (BL-AIP-4c).** Each solicitation or companion-document parse (and each harvest of a submitted or won proposal into the Brain) is recorded as a background job the moment you upload. If the server instance running it dies mid-way, the platform retries it automatically within a few minutes from the stored file (up to three attempts); the solicitation page shows the state next to **Parse** — "retry at 14:05 UTC (attempt 2 of 3)", "stuck (awaiting recovery)", or "failed after 3 attempts" with the reason. **Re-parse** always starts a fresh job.

**Requirements follow you into the editor.** The rows mapped to a section are handed to the AI drafter and the section chat verbatim as that section's contract ("address every one; reference its number inline"), ahead of the general requirement list, and the health scan judges compliance against the full list rather than a 20-clause sample.

**Citations are on by default.** In the AI assistant, **Cite sources** is checked unless you turn it off, including Auto-draft. Supported claims carry `[S#]` markers; a verifier pass then checks every cited sentence against its source excerpt, turns any marker that names no listed source into `[NEEDS CITATION]`, and does the same to sentences the source does not support. A draft that hit the model's output limit is labelled as cut short so you tighten it rather than ship half a section.

**The export gate is real.** Generate PDF / Word / Word→PDF refuses while any row is *Not addressed* or *Partial*, or while any section still contains `[NEEDS CITATION]` (the Export panel names the sections). There is no "force export" checkbox any more: an **org admin or the proposal manager** can override by writing a reason of at least ten characters, and the override is recorded in the audit log with the counts it waved through.

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

### 7.5 Customer contacts (CRM)

**Platform Intelligence → Customer contacts** (`/contacts`) is the capture-side address book: the contracting officers, CORs, program managers and executives you know at each agency, grouped by agency and ordered by how warm the relationship is.

- **Add contact** — agency and office, name, title, role, email, phone, who on your side owns the relationship, an optional next-touch date, and notes. The agency is normalised behind the scenes so "Department of the Navy", "Navy" and "U.S. Dept. of the Navy" group together.
- **Warmth** — a 0–100 score from how recently and how often you have been in touch, weighted by the contact's role (hot ≥ 70, warm ≥ 40, cool ≥ 15). It is only as good as the touches you log.
- **Log a touch** — on the contact page: meeting, call, email, industry day or note, with the date, what was said, the opportunity it served and the follow-up you agreed. The newest touch sets "last touch"; the agreed follow-up becomes the next touch and shows as **due** the week before and **overdue** after.
- **Follow-up owed** — the page header counts overdue and due-this-week follow-ups; the filter shows only those.
- **On the opportunity** — the overview's **Who we know at <agency>** panel lists the matched contacts warmest first, or offers to add the first one when nobody is known. Check it before a bid decision: a warm name is pre-RFP intelligence.

Every add, edit, delete and touch is recorded in the audit log.

## 8. Knowledge base

The Knowledge base is the corpus the FORGE Brain reads when it drafts sections, answers RFP questions, or proposes capabilities. Think of it as your company's institutional memory in a form the AI can actually use.

Two surfaces live here:

- **`/knowledge-base`** — curated **knowledge entries**: hand-authored or AI-promoted capabilities, past performance, named personnel, and boilerplate text that the Brain ranks and quotes from when drafting.
- **`/knowledge-base/import`** — the **corpus**: raw uploaded artifacts (old proposals, RFPs, contracts, debriefs, capability briefs, resumes, brochures, whitepapers, etc.) that the Brain reads to extract knowledge candidates from.

### 8.1 Drop anything in the corpus

Go to **Knowledge base → Import corpus**. Drag files onto the dropzone or click to pick. Up to 50 MB per file. Accepted: PDF, DOCX, XLSX, PPTX, TXT/MD, images. Each file becomes a **knowledge artifact** with a kind tag (proposal, rfp, contract, etc.), file metadata, and indexed plain text.

**Outcome.** For past proposals and debriefs, pick how the pursuit ended (won / lost / no-bid / withdrawn) in the **Outcome** field before uploading, or change it later from the dropdown on the artifact row. The Brain favours content from won pursuits when it drafts and slightly demotes lost ones, so labelling your history is the fastest way to make its suggestions sound like your winners. Knowledge entries promoted from a labelled artifact inherit the label; you can also set it in the entry editor.

You don't have to press anything for the Brain to learn from an upload: a background indexer runs every few hours, embeds anything new, and mines candidate knowledge entries into the review queue on **Knowledge base → Import → artifact**. Uploads still index immediately on their own; the background pass catches whatever was missed. The same pass harvests any submitted or won proposal that never made it into the corpus, so a win is in the Brain even if nobody clicked **Harvest now**.

**Searching the Brain matches words as well as meaning.** Suggest from Brain, the drafter's cited sources and the research rail search two ways at once — by meaning (embeddings) and by the exact terms in your query — and merge the rankings. Ask for "FA8-123" or "CMMC Level 2" and the passage that literally contains it ranks first; ask for "how we handled surge staffing" and the semantically closest passages still come up. Hits from won pursuits keep their boost.

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

### 8.5.1 Content blocks and version history

**Boilerplate entries are your content blocks.** Anything the team used to copy out of a shared "boilerplate.docx" — the company overview, the security posture statement, the transition risk methodology — belongs here as a **Boilerplate** entry with tags. In the section editor, **▣ Insert a content block** lists every live boilerplate entry with its version and how often it has been used; filter by a tag chip or by typing part of the title, a tag or the text, then **Insert**. The block arrives as a tracked suggestion by FORGE AI, so you accept or edit it in Track changes before saving, and the entry's **Used N times** counter goes up. **History** opens the entry.

**Every entry keeps a version history.** Each save that changes the title, body or tags becomes a new version; the optional **What changed?** line on the editor is the changelog note. The **Version history** panel under the editor lists versions newest first — number, date, author, words added and removed, the note — and **Show** reveals the full text of any version. **Restore** writes an older version back (the current text is kept as a version too, and the restore shows up as "Restored v2"). Entries created before version history start theirs on the next edit, with the pre-edit text kept as v1.

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

Every proposal section carries `status`, `author`, `updatedAt`, and a free-text body. Updates to any of those bump `updatedAt` and stamp the editor. Prior versions of the body live in the editor's **Snapshots** sidebar: take one manually, or let FORGE capture one automatically when the section crosses a status milestone; every create, restore and delete is audited, and any snapshot can be diffed against the current text.

Tracked changes leave a trail too. When a section owner accepts or rejects a suggestion (one at a time or with Accept all / Reject all), FORGE records each decision — what was inserted or deleted, who suggested it, who resolved it — and writes an audit entry for the batch (`proposal_section.changes_resolved`). The Brain reads those decisions: phrasing owners keep becomes the register the AI drafter matches for your team, struck text becomes what it avoids. The proposal overview's **AI Draft Insights** panel shows how many decisions have been recorded and how often insertions and deletions are kept.

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

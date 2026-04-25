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
8. [What FORGE records (the audit trail)](#8-what-forge-records-the-audit-trail)
9. [Signing out and switching orgs](#9-signing-out-and-switching-orgs)

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

- **Left sidebar** — navigation, grouped into Operations, Intelligence, Administration (admin only), and Platform (superadmin only)
- **Top bar** — the mobile hamburger, live session clock, Settings shortcut, and your avatar
- **Content area** — changes with the page you're on

The top-right avatar is your **user menu**. Click it to see your name/email and sign out.

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

- **Stat tiles** at the top: Total / In capture / In proposal / Won
- **Stage filter chips** — click any to filter (All, Identified, Sources Sought, Qualification, Capture, Pre-Proposal, Writing, Submitted, Won, Lost, No Bid)
- **Search** — title, agency, owner, solicitation number
- **+ New opportunity** — manual create
- **Import from SAM.gov** — live SAM.gov search

Click any row to open its detail page.

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

Go to **Proposals** in the sidebar.

### 6.1 List view

![Proposals list](docs/images/proposals-list.png)

- Stage filter chips (Draft / Pink / Red / Gold / White / Submitted / Awarded / Lost / No Bid / Archived)
- Search by title, agency, PM
- Stat tiles: Total / Draft / In review / Submitted

### 6.2 Create a proposal

Click **+ New proposal**.

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

## 8. What FORGE records (the audit trail)

FORGE doesn't have a single "audit log" page — instead, the trail is woven into each feature so the record lives next to the thing it describes. Here's the full inventory of what gets recorded today, where to find it, and what you can rely on it for.

### 8.1 Stage history on opportunities

Every stage change writes a row to the **opportunity Activity** timeline (§5.4). The row includes the actor, the prior stage, the new stage, the reasoning note, and a timestamp. You cannot delete or edit these rows. If a deal moved Identified → Capture → Submitted → Lost, you will see four entries in order with the rationale for each.

### 8.2 Gate decisions

No-bid and lost decisions are required to carry a reasoning note (§5.4 Evaluation tab). Like stage history, they live on the Activity timeline and cannot be edited or removed. This is the single most useful trail when leadership asks "why did we walk away?".

### 8.3 Evaluation saves

Saving the qualification scorecard writes a system-attributed entry recording the new rollup score and the rationale field. Re-scoring later writes another entry — you can read the timeline to see how your assessment of the deal evolved.

### 8.4 Competitor changes

Adding or removing a competitor on an opportunity writes a row. The competitor record itself carries a created_at and updated_at, so you can tell when a competitor was first identified and when their notes were last revised.

### 8.5 Manual notes, meetings, actions

Anyone with edit access can post Note / Meeting / Action entries on an opportunity. They show the author, kind, body, and timestamp. The author can delete their own entries; nobody (not even an admin) can edit them after posting. If something needs correcting, post a follow-up.

### 8.6 Proposal review history

Reviews are first-class records. For each one FORGE keeps:

- The color (Pink / Red / Gold / White Gloves), schedule date, and who started it
- The full assigned reviewer list
- Each reviewer's verdict (Pass / Conditional / Fail), summary text, and submission timestamp
- Every comment, the section it was anchored to, who posted it, and whether/when it was resolved
- The closing verdict, summary, and who closed (or cancelled) the review

Closed reviews are read-only. You can open a closed review months later and replay exactly how the team voted and what changed between rounds.

### 8.7 Section status changes

Every proposal section carries `status`, `author`, `updatedAt`, and a free-text body. Updates to any of those bump `updatedAt` and stamp the editor; the previous body is overwritten in place (FORGE doesn't yet keep prior versions of section text — that's planned). For "who has touched this section recently?" use the updatedAt + author. For substantive content history, use review comments and verdicts.

### 8.8 Compliance matrix history

Each compliance item carries an owner, status, mapped section, and updatedAt. Status flips are stamped with the editor. The Rollup panel always reflects the current state; the per-row updated_at lets you see how recently each shall statement moved.

### 8.9 Organization profile

Saving the **Settings** page updates `organization.updatedAt`. The previous values are not retained as a separate history (intentional — most edits are corrections, not policy changes), but every save is gated to admins, so the set of people who *could* have changed a field is bounded by who carries the Admin role.

### 8.10 Membership changes

Inviting, role-changing, disabling, or removing a member updates the membership row, stamps `updated_at`, and (for invites) sends an email that becomes a record in your Resend dashboard. The audit picture is: who was a member, with what role, between when and when. Disabled rows are kept rather than deleted so the historical record stays intact.

### 8.11 What's *not* recorded yet

Be honest about the limits:

- We don't keep prior versions of section prose, organization-profile fields, or compliance text.
- We don't have a unified "everything that happened in the org this week" stream — the trails live on individual records.
- We don't surface IP addresses or user-agent strings on activity entries (they're in Vercel access logs if you ever need them).

Where these are needed, ask in the next planning round and we'll add them.

### 8.12 How to use the trail

Three habits make the audit trail actually work:

1. **Write meaningful reason notes.** "Moved to Lost" is a wasted note; "Lost — incumbent's price came in 18% below our floor; debrief scheduled 5/12" is a useful one.
2. **Don't hand off informally.** If you're handing an opportunity to a different owner, change the owner field on the record (not just in chat). The change is reflected on the Activity timeline.
3. **Read the timeline before status meetings.** It's faster than re-asking the team where things stand, and it forces the team to keep the record current.

---

## 9. Signing out and switching orgs

### 9.1 Sign out

Click your avatar at the top-right → **Sign out**.

### 9.2 Switching organizations

If you belong to multiple organizations, your active org is the first one you joined. (Multi-org switching ships in a future release.) If you need to change orgs right now, ask your admin to adjust your membership directly.

---

## Getting help

If something's not working as described here, capture a screenshot and send it to your admin. They can see Vercel logs and Neon data directly; most issues are env-var or permission misconfiguration we can fix quickly.

For the in-app version of this manual, click **Help** in the sidebar — the markdown is rendered there with the same content you're reading here, so updates ship together with the code that changes the UI.

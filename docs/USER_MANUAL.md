# FORGE — User Manual

*Framework for Optimized Response Generation & Execution*

A step-by-step guide for day-to-day users. For admin tasks (inviting teammates, managing roles, platform admin), see **ADMIN_MANUAL.md**.

> This manual reflects the current shipped state of FORGE. Screenshot placeholders live under `docs/images/`. When the UI changes, update both the text and the screenshot in the same PR.

---

## Contents

1. [Getting started](#1-getting-started)
2. [The app layout](#2-the-app-layout)
3. [Organization settings](#3-organization-settings)
4. [Opportunities](#4-opportunities)
5. [Proposals](#5-proposals)
6. [Companies](#6-companies)
7. [Signing out and switching orgs](#7-signing-out-and-switching-orgs)

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

## 3. Organization settings

Go to **Settings** in the sidebar (or click Settings in the top-right).

Only organization admins can edit these fields. Everyone else sees them read-only.

![Organization settings page](docs/images/settings-org.png)

The page has four tabs. Right now only **Organization** is active.

### 3.1 Entity banner

At the top: your organization's name, UEI, CAGE code, data source (Manual / SAM.gov), and last sync time.

### 3.2 SAM.gov sync (admin only)

Paste a **UEI** and click **Sync from SAM.gov**. We pull the registered entity's name, address, registration IDs, primary NAICS, NAICS list, socio-economic certifications, and contact POC — then overwrite those fields in your org profile.

![SAM.gov sync](docs/images/settings-samgov-sync.png)

A success message confirms which entity was imported.

### 3.3 Identity & Primary contact

Legal name, website, and primary point-of-contact (name, title, phone, email). Phone and email are validated — bad formats show a red error and block Save.

### 3.4 Address

Line 1, Line 2, City, State, ZIP, Country. For US addresses State must be a 2-letter code (auto-uppercased). ZIP is 5 digits or 5+4.

### 3.5 Registration IDs

UEI (12 alphanumeric), CAGE code (5 alphanumeric), DUNS (9 digits — optional, SAM.gov is deprecating this field).

### 3.6 Security & compliance

Company and employee **security clearance level** (None / Confidential / Secret / Top Secret / TS/SCI) and **DCAA compliant** toggle.

### 3.7 Classification

- **Primary NAICS** — 6-digit code
- **NAICS list** — additional NAICS codes your org pursues
- **PSC codes** — Product/Service Codes

Used to filter SAM.gov opportunity and entity search, so keep them accurate.

### 3.8 Socio-economic

SBA 8(a), Small Business, SDB, WOSB, SDVOSB, HUBZone checkboxes.

### 3.9 Contracting vehicles

Chip selector pre-populated with civilian (GSA MAS, CIO-SP4, etc.) and DoD (SEWP, ITES-3S, SeaPort-NxG, etc.) vehicles. Add custom ones.

### 3.10 Past performance

Add rows with customer, contract name, value, period start/end, description. Used as evidence in proposals.

### 3.11 Search keywords

Tag-based editor for terms that describe your core competencies. (Future phases will use these for opportunity matching.)

### 3.12 Save / Reset

Changes only persist when you click **Save changes** at the top-right. **Reset** reverts unsaved changes. The Save button is disabled if any field has validation errors.

---

## 4. Opportunities

**Opportunities** are pursuits you're tracking — from identification through submission.

Go to **Opportunities** in the sidebar.

### 4.1 List view

![Opportunities list](docs/images/opportunities-list.png)

- **Stat tiles** at the top: Total / In capture / In proposal / Won
- **Stage filter chips** — click any to filter (All, Identified, Sources Sought, Qualification, Capture, Pre-Proposal, Writing, Submitted, Won, Lost, No Bid)
- **Search** — title, agency, owner, solicitation number
- **+ New opportunity** — manual create
- **Import from SAM.gov** — live SAM.gov search

Click any row to open its detail page.

### 4.2 Import from SAM.gov

Click **Import from SAM.gov**.

![SAM.gov import](docs/images/opportunities-import.png)

The page prefills your org's NAICS codes and returns active solicitations from the last 30 days. Adjust:
- **NAICS codes** — comma-separated
- **Keyword** — optional search term
- **Posted in last** — 7 / 14 / 30 / 60 / 90 days

Click **Search**. Results show title, agency, solicitation number, NAICS, set-aside, place of performance, description preview, due date, and a link to the SAM.gov page. Checkboxes let you multi-select; **Select all** picks every un-imported result. Click **Import N selected** to pull them into your opportunities list.

Already-imported notices are flagged and disabled so you don't duplicate.

### 4.3 Creating an opportunity manually

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

### 4.4 Opportunity detail — tabs

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

A live **Rollup score** with a verdict label — **Strong pursue** (≥70), **Watch** (50–69), or **Consider no-bid** (<50). Add a rationale and click **Save evaluation**.

Right-side **Gate decision** panel lets you:
- **Advance stage** to any non-closed stage
- **Declare no-bid** (stage → No Bid)
- **Record as lost** (stage → Lost)

Each requires a reasoning note and is logged on the Activity timeline.

#### Competitors

Track competitors (including incumbent). Per competitor: name, incumbent flag, past performance, strengths, weaknesses, notes.

![Competitors tab](docs/images/opportunity-competitors.png)

#### Activity

Reverse-chronological timeline. Auto-logs stage changes, gate decisions, evaluation updates, and competitor changes. You can also manually add **Note**, **Meeting**, or **Action** entries. Delete your own entries with the Delete link.

![Activity timeline](docs/images/opportunity-activity.png)

---

## 5. Proposals

A **Proposal** is tied to an opportunity and tracks the color-team review lifecycle.

Go to **Proposals** in the sidebar.

### 5.1 List view

![Proposals list](docs/images/proposals-list.png)

- Stage filter chips (Draft / Pink / Red / Gold / White / Submitted / Awarded / Lost / No Bid / Archived)
- Search by title, agency, PM
- Stat tiles: Total / Draft / In review / Submitted

### 5.2 Create a proposal

Click **+ New proposal**.

![New proposal form](docs/images/proposal-new.png)

Pick an **Opportunity** (dropdown of your org's opportunities), optionally override the **Title**, and assign **Proposal manager**, **Capture manager**, **Pricing lead**. Click **Create proposal**. The app seeds six default sections:
- Executive Summary
- Technical Approach
- Management Approach
- Past Performance
- Price Volume
- Compliance Matrix

### 5.3 Proposal detail — tabs

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
- **Comments panel** — add section-scoped or general comments, resolve them
- **Submit your verdict** (if you're an assigned reviewer) — Pass / Conditional / Fail + summary
- **Close review** (final verdict + summary) or **Cancel review**

![Reviews tab](docs/images/proposal-reviews.png)

Verdicts roll up: any **Fail** → Fail; any **Conditional** → Conditional; else **Pass**.

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

---

## 6. Companies

Per-org directory of customers, primes, subs, competitors, teaming partners, and watchlist targets.

### 6.1 List view

![Companies list](docs/images/companies-list.png)

Filter by relationship type. Search by name / UEI / CAGE / NAICS / location / SBA certs.

### 6.2 Search SAM.gov

Click **Search SAM.gov**.

![SAM.gov entity search](docs/images/companies-search.png)

Form prefilled with your org's primary NAICS. Chip row shows all your configured NAICS — click any to swap it into the NAICS field. Filter by company name, UEI, CAGE, state. Pick a **Tag imports as** default (Competitor / Prime / Teaming partner / etc.).

Click **Search SAM.gov**. Results show each match's name, UEI, CAGE, NAICS, location, SBA certifications. Click **Import** on each row to pull its full profile into your directory.

### 6.3 Add manually

Click **+ Add company** on the list view. Same full SAM.gov-aligned form without requiring a UEI.

### 6.4 Company detail

Click any company row.

![Company detail](docs/images/company-detail.png)

Edit any field, change relationship, add notes. **Sync from SAM.gov** button refreshes the profile from the live API (requires a UEI). **Delete** removes it from your directory.

---

## 7. Signing out and switching orgs

### 7.1 Sign out

Click your avatar at the top-right → **Sign out**.

### 7.2 Switching organizations

If you belong to multiple organizations, your active org is the first one you joined. (Multi-org switching ships in a future release.) If you need to change orgs right now, ask your admin to adjust your membership directly.

---

## Getting help

If something's not working as described here, capture a screenshot and send it to your admin. They can see Vercel logs and Neon data directly; most issues are env-var or permission misconfiguration we can fix quickly.

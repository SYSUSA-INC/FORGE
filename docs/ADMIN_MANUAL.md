# FORGE — Administrator Manual

*For organization admins and platform superadmins*

This manual covers admin-only tasks. For day-to-day user tasks see **USER_MANUAL.md**.

> Screenshot placeholders live under `docs/images/`. When the UI changes, update both text and screenshots in the same PR.

Admins in FORGE are the people who decide who has access, what their access lets them do, and how the audit trail will read in three months when somebody asks "who approved this?". The platform's job is to make those decisions explicit, recorded, and easy to undo. Your job is to use the tools deliberately:

- **Roles are how FORGE expresses responsibility.** Don't hand out Admin to dodge a permission warning — the role is the audit story. If three people made a decision, the right answer is to give the responsible person the right role and have them do it themselves.
- **The trail is only as good as the notes.** Every gate decision, every review close, every disable / enable carries a note field. Filling it in is a thirty-second investment that saves an hour of "who, when, why" archaeology later.
- **Disabling beats deleting.** FORGE keeps disabled rows so the historical record stays intact. Reach for Delete only when the row was created in error.

---

## Contents

1. [Roles overview](#1-roles-overview)
2. [Organization admin](#2-organization-admin)
3. [Super administrator (platform)](#3-super-administrator-platform)
4. [Audit & accountability](#4-audit--accountability)
5. [Troubleshooting](#5-troubleshooting)

---

## 1. Roles overview

FORGE has two kinds of privileged users:

### Organization admin

- Assigned to a user *within a specific organization* via the **Users** page
- Can invite/remove members, change their roles, disable members, edit org profile
- Access limited to **their own organization's data** (other orgs are invisible)

### Super administrator (platform)

- A *platform-wide* flag on the user record (`is_superadmin = true`)
- Can see all organizations and users across the platform
- Creates new organizations, disables orgs/users globally, forces password resets, grants/revokes superadmin on other users
- Identified in the UI by a **Superadmin** pill on their user row

A user can be an org admin *and* a superadmin. Superadmin supersedes org scope: a superadmin can effectively access every org's data (via the platform admin portal, not by being a member).

### 1.3 The seven member roles you assign

Beyond Admin, FORGE has six functional roles you'll assign to people on the **Users** page. Get this matrix in your head before you start inviting:

| Role | What this person is responsible for |
|---|---|
| **Admin** | Org configuration, member roster, role changes, every page in the org |
| **Capture** | Identifying and qualifying opportunities; running the gate decisions (advance / no-bid / lost) |
| **Proposal** | Owning a proposal: scheduling color-team reviews, advancing the lifecycle stage, closing reviews |
| **Author** | Writing assigned proposal sections; addressing review comments on those sections |
| **Reviewer** | Casting a verdict (Pass / Conditional / Fail) on color-team reviews they're invited to |
| **Pricing** | Owning the Price volume and any cost-narrative sections; speaking to cost questions in reviews |
| **Viewer** | Read-only — for executives, auditors, observers |

Practical guidance for assignments:

- **Default to the lowest sufficient role.** A subject-matter expert who only writes one technical section should be **Author**, not **Capture**. They can still read everything else.
- **Reviewers don't need to be Authors.** Reviewer is a separate role precisely so you can pull in a senior person for a Red Team without giving them edit rights to section text.
- **Don't fire-and-forget Admin.** Admin is the only role that can change other people's roles. Two admins is healthy redundancy; ten is sloppy. Audit your admin roster quarterly.
- **Pricing should usually be exactly one person per proposal.** It's an accountability role, not a club. If you need multiple people in the cost workbook, give them Author and put them on the Pricing-kind sections.
- **Viewer is your audit tier.** When a CFO or VP says "give me read-only access," that's Viewer. They'll see everything; they'll change nothing.

---

## 2. Organization admin

### 2.1 Access

Sign in. The left sidebar shows an **Administration** group with a **Users** link (only visible to org admins and superadmins).

![Users page](docs/images/users-page.png)

### 2.2 Invite a team member

On `/users`, use the **Invite a user** panel:

![Invite a user panel](docs/images/users-invite.png)

- **Email** — teammate's work email
- **Role** — one of:
  - **Admin** — full access, including managing other users
  - **Capture** — qualifies opportunities
  - **Proposal** — runs proposal response
  - **Author** — writes sections
  - **Reviewer** — reviews drafts
  - **Pricing** — owns cost volume
  - **Viewer** — read-only
- **Title** (optional) — their organizational title

Click **Send invitation**. The recipient gets an email with an invite link. Clicking it takes them to a pre-filled sign-up page where they set a password and land straight in your organization.

Invites expire after **7 days**.

### 2.3 Manage pending invitations

The **Pending invitations** panel lists invites not yet accepted. For each:

- **Resend** — issues a fresh token and re-sends the email (old link stops working)
- **Revoke** — cancels the invite; the link returns "Invitation not found"

### 2.4 Manage members

The **Members** panel lists all active and disabled members of your org:

![Members panel](docs/images/users-members.png)

Per row:
- **Avatar + name + email + title**
- **Role** dropdown — change on the fly; change is immediate
- **Status** pill — active or disabled
- **Disable / Enable** — toggles `membership.status`. Disabled members lose access to your org immediately (they stay signed in until their JWT refreshes, which happens on next request)
- **Remove** — deletes the membership (hard delete). Their user account isn't deleted; they can still sign in, they just lose access to this org

You can't change your own role, status, or membership — use another admin. This is intentional: there must always be a second person in the loop when admin power changes hands.

### 2.5 What changes the Members panel records

Every action on the Members panel updates the membership row in the database:

- **Role change** — the new role takes effect on the user's next request; the prior role is overwritten in place. The `updated_at` timestamp moves. There's no per-edit history of role changes today (planned for a future pass), so if you need a paper trail of "who was Admin between when and when," capture that in your own meeting notes when you make the change.
- **Disable / Enable** — flips `membership.status`. Disabled members keep their row, their role, and their account; they just can't access this org. This preserves history — if you disable someone for a quarter and re-enable them later, the record of their work is intact.
- **Remove** — hard-deletes the membership. The user's account and their authored content (notes, sections, comments) remain — only the org link is severed. Use this for people who genuinely never should have been a member; otherwise prefer Disable.

If your org gets audited (internal or external), the questions you'll need to answer are usually: who was a member as of date X, with what role, and who changed them? FORGE today gives you the *current* answer plus all timestamps; the *historical* answer comes from your own change-management notes. Make a habit of writing role changes into a shared doc with the date and the reason.

### 2.6 Edit the organization profile

Go to **Settings** in the sidebar. The fields are described in the User Manual §4. All fields (including SAM.gov sync) are write-gated by `requireOrgAdmin`, so only admins see editable controls — regular members see the org profile read-only.

A few responsibilities that rest on the admin specifically:

- **Keep registration IDs accurate.** UEI / CAGE / DUNS feed proposal cover sheets and SAM.gov syncs. Stale values lead to embarrassments downstream.
- **Keep the primary POC current.** Everything FORGE auto-sends (verification emails, password resets, invitations) goes from `EMAIL_FROM` (a no-reply), but downstream proposal artifacts pull the POC from your settings.
- **Re-sync from SAM.gov after every NAICS change or registration renewal.** The sync overwrites the relevant fields with the SAM.gov source of truth.
- **Document your contracting-vehicle list.** If you add a new vehicle (e.g., a new IDIQ award), reflect it in Settings the same day. Capture and Proposal users rely on this list to flag teaming opportunities.

---

## 3. Super administrator (platform)

### 3.1 Becoming a superadmin

There's no UI toggle for your *first* superadmin — it has to be flipped directly in the database. Use the included script:

```
node scripts/grant-superadmin.mjs you@company.com
```

Output: `Granted superadmin: { id: '...', email: '...', is_superadmin: true }`

Sign out and sign in again to refresh your session JWT. The sidebar will now show a **Platform** group with a **Platform admin** link.

### 3.2 The SuperAdmin portal

Go to **Platform admin** in the sidebar. Three tabs.

![SuperAdmin portal](docs/images/admin-portal.png)

#### Overview

Platform-wide stats: total orgs, active orgs, total users, active users, pending admin invites.

#### Organizations

![Organizations tab](docs/images/admin-organizations.png)

Left: **Onboard a new organization** panel.
- **Organization name**
- **Initial admin email**
- **Admin title** (optional)

Click **Create organization**. This creates the organization row and sends an invitation to the initial admin. When they accept, they land inside the new org with admin role.

Right: **All organizations** — searchable list with member count, created date, disabled status, and pending admin invite if any.

Per-row actions:
- **Disable** — sets `organization.disabled_at`. All members lose access immediately until you re-enable.
- **Enable** — clears `disabled_at`.
- **Delete** — hard-removes the organization and cascades all its data (opportunities, proposals, companies). **You cannot delete an org you're a member of** — remove yourself from it first or ask another superadmin.
- **Resend** (shown when a pending admin invite exists) — re-sends the invitation email.

#### Platform users

![Platform users tab](docs/images/admin-users.png)

Every user on the platform with their org memberships + role in each org. Search by name, email, or org name. Per-row actions:

- **Reset password** — sends a password-reset email to the user. They click the link and choose a new password. Use this any time someone reports a stuck sign-in; it's safer than ad-hoc password resets in chat.
- **Make / Revoke superadmin** — toggles `user.is_superadmin`. Requires confirmation when granting. You can't revoke your own superadmin (so a single superadmin can't accidentally lock the platform out of its highest privilege).
- **Disable / Enable** — toggles `user.disabled_at`. Disabled users cannot sign in via **any** provider (Credentials, Google, Microsoft). You can't disable yourself.

Operational rules of thumb for the platform tab:

- **Match the action to the problem.** Forgotten password → Reset password. Account compromised → Disable, then Reset, then Enable. Person left the company → Disable (don't delete; their authored content stays attributed). Granted access in error → Disable first, then go investigate before deleting.
- **Keep the superadmin roster small.** Superadmin sees every org. Two or three people platform-wide is usually right. Audit it monthly.
- **Confirm grants in writing.** Granting superadmin is a privileged action; the UI requires a confirm click but doesn't write the rationale anywhere. Capture the reason in your shared admin doc the same day.

### 3.3 Onboarding playbook

When a new customer signs up or a new internal team needs its own workspace:

1. Portal → Organizations tab → **Onboard a new organization**
2. Enter org name + their admin's email
3. They get an invitation email and sign up
4. They take over from there — invite their own team, configure SAM.gov sync, etc.

You can stay out of their org's data completely; tenancy is firewalled server-side by `requireCurrentOrg` on every data-access path.

---

## 4. Audit & accountability

This is the section to read before your first quarterly review. It tells you exactly where each kind of change lives so you can answer the "who, when, why" questions confidently.

### 4.1 The model

FORGE uses three patterns to record what happened:

1. **Activity timelines** — append-only, system + manual entries, attributed to a user, on a single record. Used on opportunities (and, in narrower form, on proposal reviews).
2. **First-class records with state** — the review, the verdict, the comment, the compliance item. Each row carries who created it, who last edited it, and when. State changes update timestamps in place.
3. **Per-row stamps** — every table has `created_at` and `updated_at`. Every record that needs attribution carries `created_by_user_id`. Reading these together gives you a forensic snapshot.

### 4.2 Where to look for each kind of question

| Question | Where to look |
|---|---|
| Why was this opportunity moved to No Bid? | Opportunity → Activity tab → look for the gate-decision row, read the reason |
| Who scored this opportunity at 42 last week? | Opportunity → Activity tab → look for the "Evaluation saved" entry |
| Who closed this Red Team review and with what verdict? | Proposal → Reviews tab → open the review → the close row at the bottom |
| Who voted Fail on Pink Team? | Proposal → Reviews tab → open the review → reviewer list with verdicts |
| Who last touched this section? | Proposal → Sections tab → expand the section → see author + updated time |
| Who marked compliance item L.3.2 Complete? | Proposal → Compliance → row's updated-by stamp |
| When did this org's CAGE change? | Settings → entity banner → updated_at on the org row (no per-field history yet) |
| When did this user become a member? | Users → Members panel → membership created_at |
| Did this person ever have admin? | Membership row's current role plus your own change-management notes |

### 4.3 What's permanent vs editable

| Record kind | After it's written, can it be edited? |
|---|---|
| Opportunity stage-change entry | No — append-only |
| Gate decision (no-bid / lost) | No |
| Evaluation save entry | No |
| Manual note / meeting / action | Author can delete; nobody can edit |
| Review verdict (per reviewer) | No once submitted |
| Review close / cancel row | No |
| Review comment | Author can edit until resolved |
| Section body | Editable; only the latest version is kept |
| Compliance item status | Editable; only the latest is kept |
| Org profile field | Editable; only the latest is kept |

The shape of this table is deliberate: the *decisions* (stage moves, gate calls, review verdicts) are permanent; the *artifacts* (section text, profile fields, compliance status) are working documents.

### 4.4 Operating practices that make the trail worth reading

- **Reason notes are not optional.** A two-word note ("Lost — incumbent") is barely better than no note. Write what you would want to read in three months.
- **Hand-offs go through the record, not chat.** New owner on an opportunity? Change the owner field on the record. New proposal manager? Change it on the proposal. Chat messages don't survive context windows; the records do.
- **Use Disable rather than Delete by default.** Removing rows breaks the trail.
- **Run a monthly admin audit.** Five minutes per month: open the Users page, scan for stale Admin assignments; open the Platform users tab (if you're superadmin), scan the superadmin list.
- **Keep a paper trail for the things FORGE doesn't store yet.** Org-profile field history, role-change history, section text history — write these into your own admin doc when they happen. We'll close those gaps in future releases; for now, your notes are the trail.

### 4.5 Limits to be honest about

The trail is good but not complete. Specifically:

- No per-field history on org profile or compliance items.
- No prior-version archive on section text (the current body overwrites the prior body).
- No unified org-wide "what happened today" feed — you'd have to look per-record.
- No IP / user-agent capture in the in-app trail (Vercel access logs cover that if you ever truly need it for an investigation).

When any of these matter for your operating cadence, raise it and we'll prioritize.

---

## 5. Troubleshooting

### 5.1 A user says they didn't get their verification / invite / reset email

1. Check **Resend** dashboard at https://resend.com/emails — was the email sent?
2. Check the user's spam folder
3. Check the domain is verified at https://resend.com/domains (sysgov.com should show green SPF/DKIM/DMARC)
4. Check Vercel env vars: `RESEND_API_KEY` and `EMAIL_FROM` are set on Production, Preview, and Development

### 5.2 A user's password doesn't work

From the SuperAdmin portal → Platform users → their row → **Reset password**. They'll get a fresh reset link.

### 5.3 Someone can't sign in at all

Common causes:
- Their email isn't verified yet — they need to click the verification link sent to them on sign-up
- They're disabled at the user level — check the "Disabled" pill in the Platform users tab
- Their org is disabled — check the Organizations tab for a "Disabled" pill next to their org
- Their membership was set to `disabled` — open the org's `/users` page as an org admin and re-enable them

### 5.4 Data isolation

You (as superadmin) cannot see another org's data from the regular app pages — for example, you can't open `/opportunities` and browse another org's opportunities. To look at cross-org data you'd need a separate admin UI (not yet built; coming in a later phase).

For now, superadmin actions are limited to:
- Platform-wide user + org listings
- Org / user lifecycle (create, disable, delete)
- Password resets

### 5.5 Running database migrations

When we ship new features that add DB tables or columns, you need to apply the migration to your Neon database.

In a Codespaces terminal on the repo:
```
git pull
node scripts/apply-schema.mjs
```

The script is idempotent — it skips anything already applied and only runs new migrations.

### 5.6 Rotating Neon password

Vercel → `forge` → Storage → your Neon database → Settings → **Rotate Secrets**. Vercel auto-updates `DATABASE_URL` in env vars. Copy the new value into your local `.env.local` so migration scripts keep working.

### 5.7 Seeing Vercel logs

Vercel → `forge` → **Logs** tab. Filter by path (e.g., `/api/register`) to find server-side errors. Red entries have stack traces.

### 5.8 Quick reference: common admin tasks at a glance

- **Onboard a new internal team:** Platform admin → Organizations → Onboard a new organization → email lead admin.
- **Bring on a new teammate to your org:** Users → Invite a user → pick role → Send invitation.
- **Change someone's role:** Users → Members → Role dropdown → done. Note the change in your shared admin doc.
- **Park someone temporarily:** Users → Members → Disable. Re-enable when they return.
- **Help a stuck signer-in:** Platform admin → Platform users → row → Reset password.
- **Apply a schema change:** in Codespaces, `git pull && node scripts/apply-schema.mjs`.
- **Rotate the DB password:** Vercel Storage → Rotate Secrets → copy new value into local `.env.local`.

Vercel → `forge` → **Logs** tab. Filter by path (e.g., `/api/register`) to find server-side errors. Red entries have stack traces.

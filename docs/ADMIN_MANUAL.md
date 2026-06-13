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
5. [Notification rules](#5-notification-rules)
6. [Subscription tiers and quotas](#6-subscription-tiers-and-quotas)
7. [Troubleshooting](#7-troubleshooting)

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

### 3.4 Per-tenant detail page

Click **Details →** on any row of the Organizations tab to open the tenant detail page at `/admin/orgs/<id>`. Lifecycle controls (Disable / Enable / Delete) stay on the parent list; the detail page is mostly read-only with two mutating dropdowns (tier assignment and ownership transfer).

What it shows:

- **Top metrics**: active member count, total opportunities, total proposals, audit-log rows in the last 30 days.
- **Identity panel**: org id, slug, status (Active / Disabled with the disabled-at timestamp), created date, contact name / email / phone, website, and **Primary admin** (the user the platform considers the owner — used by billing correspondence and the transfer-ownership flow described in §3.5).
- **Subscription tier panel**: current tier name + status + effective quotas + override status. Dropdown to **change tier** (see §6.5).
- **Storage & config**: knowledge artifact count + total bytes used (formatted B / KB / MB / GB / TB), notification rule count.
- **Most active operators (last 30d)**: top five actors by audit-row count, with a deep link into `/platform/audit-log?orgId=<id>` for the full trail.

Loading this page is itself a sensitive cross-tenant read, so every visit writes a `tenant.view_summary` row into the *target* tenant's audit log. The tenant's own org-admin can see in `/audit-log` when platform support looked at their workspace.

Use the detail page for operational triage — "is this tenant healthy?", "how much storage are they consuming?", "who's actively driving the work?" — without crossing into any of their record content.

### 3.5 Transferring tenant ownership

Every tenant has a designated **primary admin** — the person platform support emails about subscription changes, contract renewals, and outage notifications. The pointer is just informational today (no behavioral gate yet), but it's the single source of truth for "who do we talk to?".

Below the Identity panel on `/admin/orgs/<id>`, the **Change primary admin** dropdown lists every active admin of that tenant. To transfer:

1. Pick the new primary admin from the dropdown.
2. Click **Transfer**.
3. Confirm in the browser dialog.

The new primary must already be an active admin of that tenant — the transfer flow doesn't promote anyone. If the right person isn't an admin yet, ask the tenant's existing admin to invite them with the Admin role first, then come back to transfer.

Every transfer writes a `tenant.transfer_ownership` audit row into the **target tenant's** log with `{ fromUserId, toUserId, toEmail, toName }`. The tenant's own org admins see the change in their `/audit-log`.

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

- No per-field history on org profile or compliance items — only the current value.
- No prior-version archive on section text (the current body overwrites the prior body).

When any of these matter for your operating cadence, raise it and we'll prioritize.

### 4.6 `/audit-log` (per-tenant) and `/platform/audit-log` (super-admin)

The unified audit stream addresses the previous "no org-wide feed" and "no IP / user-agent capture" gaps. Two surfaces:

**Operations Management → Audit Log** (`/audit-log`) — tenant-scoped. Every mutating server action and sensitive read in your org writes a row with actor, action verb, resource type + id, IP, user-agent, structured metadata, and timestamp. Filter by actor, resource type (Opportunities / Proposals / Solicitations / Knowledge / Users / Settings / Templates / Companies / Notifications / **Authorization (denied)**), date range, or free-text. CSV export available.

**Platform Administration → Audit Log** (`/platform/audit-log`) — **super-admin only**. Cross-tenant view of the same rows; adds a tenant filter dropdown, a category filter (Mutations / Reads), and an "Events by tenant" panel that highlights top-20 tenants by volume — useful for spotting an unusually quiet (suspicious) or unusually loud (potential abuse) tenant. CSV export includes tenant + slug columns.

**Authorization denials** (BL-20) are recorded as `auth_denied` rows with a reason code (`not_member`, `not_org_admin`, `not_superadmin`). They surface in the "Authorization (denied)" filter chip on both viewers. Useful for spotting probing or stuck users.

**Retention** is configurable per tenant under **Settings → Audit log retention** (90–3,650 days, default 365). A nightly cron prunes rows older than each tenant's configured window.

### 4.7 Where the trail still lives next to the record

`/audit-log` is the unified feed; the feature-level trails described in §4.2 still exist and remain the right place for "what happened to *this* opportunity / review / compliance item?" questions. Use the unified feed for cross-record queries; use the per-record trails for drill-in.

---

## 5. Notification rules

Open **Operations Management → Notification rules** (`/notifications/rules`). The page lists every active and inactive rule in your tenant. Admin-only — non-admins are redirected.

A **notification rule** answers four questions: *what triggers it*, *who hears about it*, *through which channels*, and *how often*. Optionally a fifth: *what's the SLA, and who gets escalated to if it's not acknowledged in time*?

### 5.1 Anatomy of a rule

Click **+ New rule** (or any existing row) to open the editor.

**Identity** — name and description. The description shows in the rule list; a sentence about *why* the rule exists is much more useful than the name alone.

**Trigger event kind** — picks one event from a fixed list. The list expands as more product features add new triggers. Today: opportunity stage changes (advanced / won / lost / no-bid / due soon), proposal lifecycle (created / advanced / section overdue), color-team reviews (pending / completed), comment mentions, opportunity bid/no-bid reviews submitted, solicitation role assignments, compliance overdue, audit anomalies, membership invited / disabled.

**Match filter** — a JSON object. Empty (`{}`) matches every event of the kind. Non-empty matches only events whose payload contains every key/value in the filter. Use this to narrow by stage, color, etc. — for example, `{"color": "red"}` on a `review_completed` rule fires only for Red Team reviews.

**Recipients** — four strategies:

- **Specific users**: pick the exact list of teammates.
- **By role**: every active member with one of the chosen roles (Admin / Capture / Proposal / Author / Reviewer / Pricing / Viewer).
- **By relationship to the record** (formula): the proposal manager, opportunity owner, capture lead, pricing lead, section author, or **color-team review assignees** (resolved from the triggering event's `reviewId`).
- **Users mentioned in the event payload**: events like @-mentions in review comments and role assignments tag the relevant users in their payload. This strategy fans out to whoever the event tagged — no static list to maintain.

**Delivery** — channels and frequency. Channels: in-app (always available), email (always available), Slack and Teams (coming soon — selectable as a placeholder but not yet delivered). Frequency: Immediate (delivery row created at trigger time), Daily digest, or Weekly digest (collapsed into a single inbox row per recipient per cadence by the materialization cron).

**SLA & escalation** — optional. Set SLA hours (0 = no SLA, max 30 days). If a recipient hasn't acknowledged their delivery within the window, the SLA-breach cron marks the row breached. If an **escalation strategy** is set (same four shapes as the primary recipient), it then fires a fresh delivery to the fallback recipients.

**Status** — Active or Inactive. Inactive rules don't fire. Activating mid-day takes effect on the next trigger.

### 5.2 Default rules every tenant gets

On migration, FORGE seeds six default rules per tenant so the rules engine matches the legacy hardcoded behavior. They're named `Default: <human label>` and noted as auto-seeded in their description. If you already had a rule for one of these trigger kinds, the seed skipped that kind — your custom rule wins.

| Default rule | Recipients | Channels |
|---|---|---|
| Color-team review completed (reviewers) | Review assignees | In-app + Email |
| Color-team review completed (proposal manager) | Proposal manager | In-app + Email |
| Color-team review request pending | Review assignees | In-app + Email |
| Review comment mention | The @-mentioned user(s) | In-app + Email |
| Opportunity bid/no-bid review submitted | Opportunity owner | In-app |
| Solicitation role assigned | The newly-assigned user | In-app |

Edit or delete defaults the same way you'd edit a custom rule. Disabling a default doesn't break the legacy hardcoded notification (it still fires in parallel until that legacy path is retired in a future release — duplicate inbox rows are the accepted cost during the parity window).

### 5.3 Test send

On any active rule's edit page, click **Test send** to dispatch a sample event for that rule's trigger kind. The recipients receive an in-app (and email, if the rule's channels include email) notification prefixed with `[Test send]`, with a body identifying you as the sender and noting the event is synthetic.

Test sends use an empty payload (other than `testSend: true`), so any rule with a non-empty match filter that requires specific payload keys won't match against a test. Exercise filter logic by triggering a real event. The button is disabled when the rule is Inactive; activate first.

Every test send writes a `notification_rule.test_send` row to your audit log so the use can be tracked.

### 5.4 Operating practices

- **Read the audit trail before tuning recipients.** `/audit-log` filtered by Resource type → Notifications shows who's being delivered to and when. If recipients are complaining about volume, look there first; the answer is usually a rule that's too broad (empty match filter, or `role_based` over too many roles).
- **Prefer formula strategies over specific_users for "people who own this work" rules.** A rule that targets the proposal manager via formula stays correct when the manager changes. A `specific_users` rule with hard-coded IDs goes stale silently.
- **SLA + escalation should mirror your real off-hours rotation.** A 2-hour SLA with no escalation is just a louder alarm; a 2-hour SLA escalating to the on-call admin role is an SLA that actually gets work done.
- **Disable, don't delete, while debugging.** If you suspect a rule is misbehaving, deactivate it for a day and watch the audit trail. Deletion erases the rule's history; deactivation keeps the audit context.

---

## 6. Subscription tiers and quotas

FORGE bundles platform features into tiers — Bronze / Silver / Gold / Platinum / Custom — each with its own feature toggles and monthly quotas. Tiers are platform-scoped (not per-tenant data), and every organization is assigned to exactly one tier at any given time.

This section is **superadmin-only**. Org admins see the *consequences* of their tier (some features may return upgrade-prompt errors) but can't view or change tier definitions.

### 6.1 Default tiers

When the platform was first seeded, five tiers were created with placeholder pricing. Sales tunes these in production via the editor (§6.4); the defaults below are starting points only:

| Tier | Monthly | Features (defaults) | Quotas (defaults) |
|---|---|---|---|
| **Bronze** | $99 | Compliance matrix only | AI reqs 100/mo · Seats 5 · Storage 10 GB · Proposals 5/mo |
| **Silver** | $249 | + Winner analysis + Bulk export | AI reqs 500/mo · Seats 15 · Storage 50 GB · Proposals 20/mo |
| **Gold** | $499 | All 6 features | AI reqs 2000/mo · Seats 50 · Storage 200 GB · Proposals 100/mo |
| **Platinum** | $999 | All 6 features | All quotas **unlimited** (0 = unlimited semantics) |
| **Custom** | $0 | All 6 features | Unlimited (negotiated per-tenant via overrides) |

**Backfill behavior**: when the tier model first shipped, every existing organization was assigned the **Platinum** tier so runtime behavior didn't change. New organizations created today still default to Platinum at the application layer — superadmins move them to the correct tier as part of onboarding.

### 6.2 What each feature flag gates

Feature flags gate specific actions in the app. When the flag is `false` for a tenant's effective tier, the action returns a clean upgrade-prompt error instead of running:

| Flag | Gated action | Where it's enforced |
|---|---|---|
| `aiAutoDraft` | AI section draft / improve / tighten | `generateSectionDraftAction` |
| `winnerAnalysis` | Proposal-vs-winner analysis | `runWinnerAnalysisAction` |
| `complianceMatrix` | AI compliance preflight | `runCompliancePreflightAction` |
| `bulkExport` | Audit-log CSV download | `exportAuditLogCsvAction` |
| `apiAccess` | Token-based API endpoints | (reserved; no endpoint yet) |
| `customTemplates` | Custom proposal template editing | (reserved) |

### 6.3 How quotas work

Two quota mechanics depending on the key:

**Counter-backed quotas** track usage in a per-tenant per-month counter row (`tenant_usage_counter`). Every relevant action atomically increments the counter; when usage exceeds the limit, the next call returns a clean error.

| Quota | What increments it | Reset |
|---|---|---|
| `aiRequestsPerMonth` | Each AI-using action (winner analysis, AI draft, compliance preflight) | Monthly, UTC. New month → new counter row. |
| `proposalsPerMonth` | Each `createProposalAction` call | Monthly, UTC. |

**Live-measured quotas** compute usage on every check from the source table — no counter rows. Removing a user or deleting an artifact frees the quota immediately.

| Quota | What it measures | Where it's enforced |
|---|---|---|
| `seatsIncluded` | `COUNT(*) FROM membership WHERE status='active'` | `inviteUserAction` refuses new invites when full |
| `storageGb` | `SUM(knowledge_artifact.file_size)` for the tenant | `uploadKnowledgeArtifactAction` refuses uploads that would push over |

**Quota value of 0 = unlimited** (Platinum semantics). The helpers short-circuit to allow without writing counter rows, keeping the hot path cheap.

**Failed attempts still count** (for counter quotas). A network-failed AI call still bumps the counter. Net effect: a tenant on the edge of their limit may hit the cap slightly earlier than a strict success-only counter would suggest. Tradeoff documented; refund semantics are queued (Phase B-3d) if accuracy ever matters.

### 6.4 Editing tier definitions

Go to **Platform admin → Tiers** (`/admin/tiers`). The list shows every tier with current pricing, feature summary, quota summary, and the count of tenants currently on each tier.

![Tiers list](docs/images/admin-tiers.png)

Click **Edit →** on any tier to open the editor at `/admin/tiers/<id>`. You can change:

- **Name** (slug stays read-only — it's referenced by seed data and future billing integrations)
- **Description**
- **Monthly + yearly prices** (entered as USD dollars, stored as cents)
- **Feature flags** — 6 checkboxes
- **Quotas** — 4 number inputs; `0` means unlimited
- **Sort order** — lower numbers appear first in the list
- **Active** — uncheck to retire the tier (refused server-side if any tenant is still on it)

Every edit writes a `subscription_tier.update` audit row.

### 6.5 Moving a tenant to a different tier

On `/admin/orgs/<id>` (the per-tenant detail page), the **Subscription tier** panel shows the tenant's current tier, status, and effective quotas. The dropdown below lets you reassign:

1. Pick the target tier (retired tiers are hidden — you can't assign anyone to a retired tier).
2. Click **Change tier**.
3. Confirm in the browser dialog.
4. The change applies immediately. Feature access and quotas update on the next gated action call.

Every change writes a `tenant.tier_change` audit row into the **target tenant's** audit log with `fromTier` and `toTier` metadata, so the tenant's own org admin sees the change in their `/audit-log`.

### 6.6 Per-tenant overrides (custom_overrides)

The `tenant_subscription.custom_overrides` JSONB column lets sales bump a single feature or quota for one tenant without moving them to a higher tier. Schema:

```json
{
  "featureFlags": { "winnerAnalysis": true },
  "quotas": { "aiRequestsPerMonth": 5000 }
}
```

The tier's defaults form the base; overrides apply on top. The runtime gate reads the merged shape.

No UI for editing `custom_overrides` yet — for now, sales updates the row directly via SQL when negotiating a Custom-tier contract. A UI is queued under the Custom-tier playbook in future BL-16 work.

### 6.7 Retiring a tier (safe deletion)

You cannot retire a tier (set `active=false`) while any tenant is on it. The editor refuses with a count: `Cannot retire "Silver" — 3 tenant(s) are on it. Move them to a different tier first.`

To retire:
1. Reassign every tenant off the tier (via the `/admin/orgs/<id>` dropdown).
2. Open the tier editor and uncheck **Active**.
3. Save.

Retired tiers stay in the list (greyed with a **Retired** pill) so historical references remain readable; they just don't accept new tenant assignments.

### 6.8 Promotional codes

Open **Platform admin → Promo codes** (`/admin/promo-codes`). The list shows every code with status pills (**Active** / **Inactive** / **Expired** / **Maxed out** / **Usable**), description, validity window, redemption counter, and created date.

Click any row to edit, or **+ New code** to create. Fields:

- **Code** — the redeemable string. Letters / digits / underscore / hyphen only, 3–64 chars. **Case-sensitive** — generate in CAPS by convention to avoid the L/I/0/O ambiguity at checkout.
- **Discount percent** — 0 to 100. `100` is a free-month code.
- **Description** — internal note ("Spring 2026 launch promo — 25% off Bronze annual"). Customers don't see it.
- **Valid from / Valid until** — optional date bounds. Leave blank for "effective immediately / never expires".
- **Max uses** — `0` means unlimited; `> 0` is an absolute cap. The `times_used` counter increments at redemption.
- **Active** — manual kill switch independent of the date window.

A code becomes **Usable** only when all of:
- `active = true`
- current time is between `valid_from` and `valid_until` (if set)
- `times_used < max_uses` (or `max_uses = 0`)

Each create/update writes a `promo_code.create` / `promo_code.update` audit row.

**Note on redemption**: Phase C-4 ships CRUD only. The actual redemption flow (applying a code to a `tenant_subscription` to discount the next period) pairs with **BL-17** (external billing integration). For now, codes exist in the DB ready for that wiring; nothing changes when a tenant types one in.

### 6.9 Operating practices

- **Tier edits are platform-wide and immediate**. Flipping Bronze's `aiAutoDraft` from `false` to `true` unlocks the feature for every Bronze tenant the moment the gate's next read fires. No deploy needed. Audit the change in your shared ops doc the same day.
- **Custom tier is the right place for sales-negotiated terms**. Don't edit Bronze/Silver/Gold/Platinum prices ad-hoc for one customer — that affects everyone. Move them to Custom and use `custom_overrides`.
- **Watch the audit log on tier changes**. `subscription_tier.update` (from §6.4) and `tenant.tier_change` (from §6.5) are both in `/audit-log` / `/platform/audit-log`. Filter by resource type to spot patterns (e.g., a flurry of tier downgrades right before a payment is due usually means dunning).
- **Promo code hygiene**. Set a `valid_until` on every launch / event code so they auto-expire even if you forget to deactivate. Set `max_uses` for high-discount codes to cap exposure. The status pills on the list view make stale codes obvious at a glance.

---

## 7. Troubleshooting

### 7.1 A user says they didn't get their verification / invite / reset email

1. Check **Resend** dashboard at https://resend.com/emails — was the email sent?
2. Check the user's spam folder
3. Check the domain is verified at https://resend.com/domains (sysgov.com should show green SPF/DKIM/DMARC)
4. Check Vercel env vars: `RESEND_API_KEY` and `EMAIL_FROM` are set on Production, Preview, and Development

### 7.2 A user's password doesn't work

From the SuperAdmin portal → Platform users → their row → **Reset password**. They'll get a fresh reset link.

### 7.3 Someone can't sign in at all

Common causes:
- Their email isn't verified yet — they need to click the verification link sent to them on sign-up
- They're disabled at the user level — check the "Disabled" pill in the Platform users tab
- Their org is disabled — check the Organizations tab for a "Disabled" pill next to their org
- Their membership was set to `disabled` — open the org's `/users` page as an org admin and re-enable them

### 7.4 Data isolation

FORGE enforces multi-tenant data isolation at three layers:

1. **At the route.** Every page under `(app)/` calls an auth gate (`requireAuth` / `requireCurrentOrg` / `requireOrgAdmin` / `requireOrgMember` / `requireSuperadmin`). A user can't reach a page they don't have a role for, and per-org pages refuse to render rows that don't carry the caller's `organizationId`.
2. **At the query.** Every Drizzle query against a tenant-scoped table includes an `eq(table.organizationId, organizationId)` clause. The **Multi-tenant isolation check** CI gate (BL-19 Phase 1) walks every `"use server"` file and asserts each exported async function that touches a tenant-scoped table either calls an auth gate *and* references `organizationId`, or is on the explicit allow list (`.isolation-allow.json`) with a documented reason (public token-scoped surfaces, etc.). A PR that introduces a server action that queries a scoped table without scoping is blocked from merging into `main`.
3. **At the audit.** Authorization denials (a user trying to access another tenant's data, a non-admin invoking an admin-only action) write an `auth_denied` audit row with a reason code (`not_member`, `not_org_admin`, `not_superadmin`). Filter `/audit-log` to **Authorization (denied)** to spot probing or stuck users.

Superadmin override is real but bounded: a superadmin can see every tenant's audit rows via `/platform/audit-log` and manage tenants under `/admin`, but **cannot** open another tenant's `/opportunities` or `/proposals` UI as if they were a member — every page query still scopes by `organizationId`, which for a superadmin reads from their primary membership.

If you ever suspect cross-tenant leakage:
1. Filter `/platform/audit-log` by tenant to confirm the actor's org context on each row.
2. Run `npm run check:isolation` locally on the latest `main` — it errors out if any server action violates the contract, which is exactly the bug pattern that would let a tenant-A user read tenant-B data.
3. Check Vercel logs for the path in question — `requireOrgMember` redirects produce a visible status code, and the `auth_denied` row in `/audit-log` will carry the offending user's IP.

A planned BL-19 Phase 2 will add runtime tests: spin up two tenants, exercise every server action with cross-tenant ids, and fail loudly on any leak the static check missed. That work blocks on a test framework landing.

### 7.5 Running database migrations

When we ship new features that add DB tables or columns, you need to apply the migration to your Neon database.

In a Codespaces terminal on the repo:
```
git pull
node scripts/apply-schema.mjs
```

The script is idempotent — it skips anything already applied and only runs new migrations.

### 7.6 Rotating Neon password

Vercel → `forge` → Storage → your Neon database → Settings → **Rotate Secrets**. Vercel auto-updates `DATABASE_URL` in env vars. Copy the new value into your local `.env.local` so migration scripts keep working.

### 7.7 Seeing Vercel logs

Vercel → `forge` → **Logs** tab. Filter by path (e.g., `/api/register`) to find server-side errors. Red entries have stack traces.

### 7.8 Quick reference: common admin tasks at a glance

- **Onboard a new internal team:** Platform admin → Organizations → Onboard a new organization → email lead admin.
- **Bring on a new teammate to your org:** Users → Invite a user → pick role → Send invitation.
- **Change someone's role:** Users → Members → Role dropdown → done. Note the change in your shared admin doc.
- **Park someone temporarily:** Users → Members → Disable. Re-enable when they return.
- **Help a stuck signer-in:** Platform admin → Platform users → row → Reset password.
- **Apply a schema change:** in Codespaces, `git pull && node scripts/apply-schema.mjs`.
- **Rotate the DB password:** Vercel Storage → Rotate Secrets → copy new value into local `.env.local`.

Vercel → `forge` → **Logs** tab. Filter by path (e.g., `/api/register`) to find server-side errors. Red entries have stack traces.

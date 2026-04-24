# FORGE — Administrator Manual

*For organization admins and platform superadmins*

This manual covers admin-only tasks. For day-to-day user tasks see **USER_MANUAL.md**.

> Screenshot placeholders live under `docs/images/`. When the UI changes, update both text and screenshots in the same PR.

---

## Contents

1. [Roles overview](#1-roles-overview)
2. [Organization admin](#2-organization-admin)
3. [Super administrator (platform)](#3-super-administrator-platform)
4. [Troubleshooting](#4-troubleshooting)

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

You can't change your own role, status, or membership — use another admin.

### 2.5 Edit the organization profile

Go to **Settings** in the sidebar. The fields are described in the User Manual §3. All fields (including SAM.gov sync) are write-gated by `requireOrgAdmin`, so only admins see editable controls — regular members see the org profile read-only.

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

- **Reset password** — sends a password-reset email to the user. They click the link and choose a new password.
- **Make / Revoke superadmin** — toggles `user.is_superadmin`. Requires confirmation when granting. You can't revoke your own superadmin.
- **Disable / Enable** — toggles `user.disabled_at`. Disabled users cannot sign in via **any** provider (Credentials, Google, Microsoft). You can't disable yourself.

### 3.3 Onboarding playbook

When a new customer signs up or a new internal team needs its own workspace:

1. Portal → Organizations tab → **Onboard a new organization**
2. Enter org name + their admin's email
3. They get an invitation email and sign up
4. They take over from there — invite their own team, configure SAM.gov sync, etc.

You can stay out of their org's data completely; tenancy is firewalled server-side by `requireCurrentOrg` on every data-access path.

---

## 4. Troubleshooting

### 4.1 A user says they didn't get their verification / invite / reset email

1. Check **Resend** dashboard at https://resend.com/emails — was the email sent?
2. Check the user's spam folder
3. Check the domain is verified at https://resend.com/domains (sysgov.com should show green SPF/DKIM/DMARC)
4. Check Vercel env vars: `RESEND_API_KEY` and `EMAIL_FROM` are set on Production, Preview, and Development

### 4.2 A user's password doesn't work

From the SuperAdmin portal → Platform users → their row → **Reset password**. They'll get a fresh reset link.

### 4.3 Someone can't sign in at all

Common causes:
- Their email isn't verified yet — they need to click the verification link sent to them on sign-up
- They're disabled at the user level — check the "Disabled" pill in the Platform users tab
- Their org is disabled — check the Organizations tab for a "Disabled" pill next to their org
- Their membership was set to `disabled` — open the org's `/users` page as an org admin and re-enable them

### 4.4 Data isolation

You (as superadmin) cannot see another org's data from the regular app pages — for example, you can't open `/opportunities` and browse another org's opportunities. To look at cross-org data you'd need a separate admin UI (not yet built; coming in a later phase).

For now, superadmin actions are limited to:
- Platform-wide user + org listings
- Org / user lifecycle (create, disable, delete)
- Password resets

### 4.5 Running database migrations

When we ship new features that add DB tables or columns, you need to apply the migration to your Neon database.

In a Codespaces terminal on the repo:
```
git pull
node scripts/apply-schema.mjs
```

The script is idempotent — it skips anything already applied and only runs new migrations.

### 4.6 Rotating Neon password

Vercel → `forge` → Storage → your Neon database → Settings → **Rotate Secrets**. Vercel auto-updates `DATABASE_URL` in env vars. Copy the new value into your local `.env.local` so migration scripts keep working.

### 4.7 Seeing Vercel logs

Vercel → `forge` → **Logs** tab. Filter by path (e.g., `/api/register`) to find server-side errors. Red entries have stack traces.

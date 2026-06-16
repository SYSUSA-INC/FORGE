# FORGE — Secrets Rotation Schedule

**Cadence:** Quarterly for all routine secrets; immediate for any suspected leak.
**Last updated:** 2026-06-16
**Owner:** Engineering lead

Secrets that don't get rotated are secrets that get leaked. This document is the checklist; the schedule lives in the founder's calendar.

---

## 1. Quarterly checklist

Every quarter, work through this list. Estimated time: 60-90 minutes total. Schedule it during low-traffic hours (recommend Sunday morning, before any customer is using the app).

### Step 1: Rotate the routine secrets (45 min)

| Secret | Where to rotate | Where to update | Restart required |
|---|---|---|---|
| `AUTH_SECRET` (NextAuth JWT signing) | generate fresh: `openssl rand -base64 32` | Vercel env (Production scope) | yes — every signed-in user will be forced to re-login |
| `DATABASE_URL` | Neon console → role's reset password | Vercel env | yes |
| `RESEND_API_KEY` | Resend dashboard → API Keys → generate new | Vercel env | yes |
| `ANTHROPIC_API_KEY` | Anthropic console → API Keys → generate new | Vercel env | yes |
| `CRON_SECRET` | generate: `openssl rand -base64 32` | Vercel env | yes (cron stops firing until redeploy) |
| `NEON_API_KEY` (when configured) | Neon console → Account settings → API keys | Vercel env | yes |
| `SAMGOV_API_KEY` (if used) | sam.gov account | Vercel env | yes |

**Process per secret:**
1. Generate the new value in the source console (or via `openssl rand`)
2. Add the new value as a **new** Vercel env var temporarily (e.g. `AUTH_SECRET_NEW`)
3. Deploy and verify the new value works
4. Replace `AUTH_SECRET` with the new value
5. Redeploy
6. Revoke the old value in the source console
7. Delete the temporary `AUTH_SECRET_NEW`

For `AUTH_SECRET` specifically, this two-step process avoids a logout storm: the app accepts tokens signed by either secret during the rollover.

### Step 2: Audit the audit log (10 min)

1. `/admin/errors` → filter for the last 90 days
2. Look for any spike in 401 / 403 / `unauthorized` errors
3. Cross-reference with `audit_log` for the same window
4. Anomalies → escalate to incident playbook (`docs/RUNBOOK.md`)

### Step 3: Audit account access (15 min)

1. GitHub: https://github.com/orgs/sysusa-inc/people → confirm everyone listed is still active. Remove leavers.
2. Vercel: project Settings → Team → remove leavers
3. Neon: project → Settings → Members → remove leavers
4. Anthropic: console → Settings → Members → remove leavers
5. Resend: Settings → Team → remove leavers

### Step 4: MFA spot-check (10 min)

See `docs/MFA_SETUP.md` section 6.

### Step 5: Update this document (5 min)

Bump the "Last updated" date. Record the rotation in `docs/incidents/YYYY-MM-DD-secrets-rotation.md` (one-line entry is fine).

---

## 2. Emergency rotation (suspected leak)

**Triggers:**
- Secret accidentally committed to a public repo
- Laptop with secrets cached gets stolen / lost
- Team member departure (especially involuntary)
- Customer reports an authenticated request they didn't initiate
- Vercel / Neon / Anthropic notify of a platform breach

**Process:** same as the quarterly checklist, but compressed into the next 30 minutes. Skip step 2-5 for now; do them as part of the postmortem.

**Communication during emergency rotation:**
- If `AUTH_SECRET` is rotated, every signed-in user will be force-logged-out. Post an in-app banner: "Session refresh required — please sign in again. (Reason: routine security maintenance.)"
- If `CRON_SECRET` is rotated, scheduled tasks will pause until next deploy. No customer-visible impact short-term.

---

## 3. Secrets we do NOT rotate routinely

| Secret | Why we don't rotate |
|---|---|
| Customer OAuth tokens (Google, Microsoft) | Lifecycle controlled by the provider; rotating their tokens would force user re-auth |
| `production_error_log` data | Not a secret; an internal log |
| Migration ledger | Append-only, not a secret |

---

## 4. Future-proofing

**When we migrate to AWS (Trigger D from `docs/architecture/aws-deployment-roadmap.md`):**

- Move secrets from Vercel env to **AWS Secrets Manager**
- Enable **automatic rotation** for the DB password (AWS Secrets Manager → enable rotation)
- Application code reads from Secrets Manager at startup (cached for the process lifetime)
- Manual rotation steps above become obsolete for the DB; quarterly review still covers API keys

This is a Trigger D deliverable, not a Trigger A one. Today we live with the manual checklist.

---

## 5. Recording rotations

Track the rotation history in `docs/incidents/secrets-rotation-log.md` (one entry per quarter). This is what an auditor will ask for during SOC 2 prep.

Template entry:

```markdown
## 2026-06-16 — Q2 2026 quarterly rotation

**Performed by:** <name>
**Duration:** <minutes>
**Secrets rotated:** AUTH_SECRET, DATABASE_URL, RESEND_API_KEY, ANTHROPIC_API_KEY, CRON_SECRET

**Issues encountered:** none
**Follow-up:** none
```

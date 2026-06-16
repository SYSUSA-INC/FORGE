# FORGE — Operations Runbook

**Last updated:** 2026-06-16

This runbook is for on-call. When something is broken in production, find the symptom below and follow the steps. Update this file every time we hit a new failure class — the goal is that the next person never debugs the same thing twice.

---

## 1. On-call basics

### Who is on-call

| Day | Primary | Secondary |
|---|---|---|
| Mon-Fri 9-5 ET | Founder | Engineering lead |
| After hours | Founder | Engineering lead |
| Weekend | Founder | Engineering lead |

Until we have a team, founder is always primary. When we hire, we update this table and add PagerDuty rotation.

### Tools you need access to

1. **Vercel dashboard** — https://vercel.com (logs, redeploy, env vars)
2. **Neon console** — https://console.neon.tech (DB metrics, point-in-time restore)
3. **GitHub** — https://github.com/sysusa-inc/forge (revert PRs, hotfix branches)
4. **Anthropic console** — https://console.anthropic.com (API usage, rate-limit visibility)
5. **Resend dashboard** — https://resend.com/emails (email delivery status)

Every account above must have **MFA enabled**. See `docs/MFA_SETUP.md`.

### Communication during an incident

1. Open a ticket: GitHub issue tagged `incident`.
2. Update the issue every 15 minutes with current status.
3. After resolution, write a one-page postmortem under `docs/incidents/YYYY-MM-DD-<slug>.md`.

---

## 2. Top failure modes (with playbooks)

### A. Site is down (Vercel returning 5xx everywhere)

**Detection:** uptime monitor (when we have one), customer reports, or `/admin/errors` showing a spike.

**Diagnosis:**
1. Check Vercel dashboard → Deployments tab → look for failed builds at the top.
2. Check `/admin/migrations` if available → drift detector or a failed auto-apply will be visible.
3. Check Neon console → DB CPU / connection count / error rate.

**Recovery:**
1. **If a recent deploy is the cause:** revert by clicking "Redeploy" on the previous-known-good deploy in Vercel. Recovery time: ~2 minutes.
2. **If a migration is the cause:** the destructive-blocker should have prevented this, but if a non-destructive migration has bad SQL → roll back via Neon PITR to the moment before the migration ran. See section 3 below.
3. **If Neon is the cause:** check https://neon.tech/status. If it's a Neon outage, there's nothing we can do but wait + post status to customers.

**Common causes we've seen:**
- ❶ RSC boundary bug (PR #115 era). The `next build` CI gate now blocks these.
- ❷ Migration applied a table that the code references but the migration ledger said was already applied (2026-06-15 incident). Drift detector now catches this on every cold start.
- ❸ AUTH_SECRET rotated without a redeploy. See section 5.

---

### B. `/admin/migrations` shows ledger drift

**Detection:** red panel on the admin page.

**Diagnosis:**
1. Read the listed missing tables. Cross-reference against `drizzle/` migration files.
2. If a later migration renamed those tables, this is a **false positive** — the drift detector now handles renames (PR #206), so this should be rare. If it happens, file a bug.
3. If the tables are genuinely missing, write a repair migration mirroring `drizzle/0052_repair_false_applied_ledger.sql`.

**Recovery:**
- Write `drizzle/<next>_repair_<purpose>.sql` with `CREATE TABLE IF NOT EXISTS` for each missing table.
- PR + merge. Auto-apply runs on cold start.

---

### C. Customer reports they can see another tenant's data

**SEVERITY: CRITICAL — this is an existential threat.**

**Detection:** customer email, support ticket, audit log surfaced anomaly.

**Diagnosis:**
1. **First thing:** record exactly what they saw (screenshot URL if possible). Time-bound the issue.
2. Check `audit_log` for the affected user's session: which queries ran, which tables touched, what IDs returned.
3. Identify the leaking query — almost always a server action that touched a tenant-scoped table without `organizationId` in the WHERE clause.

**Immediate recovery:**
1. **Disable the affected code path** via a feature flag if possible, or revert the introducing PR.
2. Notify both tenants (the one whose data leaked and the one who saw it).
3. Audit log: dump everything that user saw, preserve for post-mortem.

**Long-term:**
1. Add a fuzz test that would have caught the issue.
2. Postmortem within 48 hours. Document in `docs/incidents/`.
3. **Add the regression class to `scripts/check-isolation.mjs`** so static analysis catches it next time.

**Prevention measures already in place:**
- `npm run check:isolation` static analysis on every PR (blocks merge if violations found)
- `isolation-allow.json` requires every exception to have a documented reason
- Every server action calls `requireCurrentOrg` (or one of the `requireOrg*` siblings) and scopes by the returned `organizationId`

---

### D. AI API costs are spiking

**Detection:** Anthropic console showing usage above expected, monthly bill anomaly.

**Diagnosis:**
1. Check `production_error_log` for retry loops calling AI endpoints.
2. Check the AI gateway code (`src/lib/ai-gateway.ts`) — is there a runaway prompt?
3. Check which tenant: is one customer burning through tokens? (See `tenant_usage_counter` for per-tenant AI call counts.)

**Recovery:**
1. Rate-limit the offending endpoint via `rate_limit_counter` table.
2. If a tenant is over their tier's quota, disable AI features for that tenant until they upgrade (BL-PACKAGES — coming).
3. If a runaway loop, ship a hotfix.

**Prevention measures:**
- Per-tenant rate limiting via `rate_limit_counter`
- Per-package token caps (coming in BL-PACKAGES)
- AI gateway logs every request with token count + tenant — see `audit_log`

---

### E. Cron job stopped firing

**Detection:** `/admin/errors` shows no production_error rows for a scheduled task that should have run.

**Diagnosis:**
1. Check Vercel cron logs → Settings → Cron Jobs.
2. Confirm `CRON_SECRET` env var is set in Vercel (Production scope).
3. Try hitting the cron endpoint manually with `Authorization: Bearer ${CRON_SECRET}` — if it works, cron config is broken, not code.

**Recovery:**
- If `CRON_SECRET` is wrong: rotate it (see `docs/SECRETS_ROTATION.md`) and redeploy.
- If a cron handler is broken: revert or hotfix.

---

### F. Email delivery failing (Resend)

**Detection:** users report not getting password reset / notification emails.

**Diagnosis:**
1. Check Resend dashboard → look for failed sends, bounce rate.
2. Check `RESEND_API_KEY` env var still valid.
3. Check sender domain SPF/DKIM records still resolving.

**Recovery:**
- API key issue: rotate in Resend → update Vercel env → redeploy.
- Domain issue: re-verify domain in Resend dashboard.

---

## 3. Database recovery via Neon PITR

Neon has 7-day point-in-time recovery (24 hours on free tier; check current tier).

**To restore the prod DB to a moment before a bad migration:**
1. Neon console → FORGE project → Branches → "Create branch from time"
2. Select the timestamp **just before** the bad event (e.g. 1 minute before the migration ran)
3. Neon creates a new branch — note its connection string
4. Test the data on the new branch
5. If good: update `DATABASE_URL` in Vercel to point to the new branch
6. Redeploy
7. **Communicate to customers** — any writes between the restore point and now are lost; customers may need to re-enter recent data

**Caveat:** PITR works at the branch level, not table level. If only one table is corrupted, consider pg_dump from the restored branch and selectively restore the affected rows.

---

## 4. Postmortem template

After every incident, write a postmortem at `docs/incidents/YYYY-MM-DD-<slug>.md` with this structure:

```markdown
# Incident: <one-line summary>

**Date:** <ISO date>
**Duration:** <e.g. 14 min>
**Severity:** <P0/P1/P2>
**Customer impact:** <quantify if possible>

## What happened (timeline)
- HH:MM — first symptom observed
- HH:MM — diagnosis started
- HH:MM — root cause identified
- HH:MM — fix applied
- HH:MM — resolved

## Root cause
<technical explanation>

## What worked
<what helped us recover quickly>

## What didn't work
<what slowed us down>

## Action items
- [ ] <prevention measure 1> — assigned to: <name>, due: <date>
- [ ] <prevention measure 2>
- [ ] <add to runbook>
```

---

## 5. Secrets rotation

See `docs/SECRETS_ROTATION.md` for the full quarterly rotation checklist.

**Emergency rotation (if a secret is leaked):**
1. Generate new secret in source console (e.g. Anthropic, Vercel)
2. Update Vercel env var (Production scope)
3. **Redeploy immediately** — env var changes don't take effect until next deploy
4. Revoke the old secret in source console
5. Audit any usage of the old secret in `audit_log`
6. Postmortem

---

## 6. Maintenance windows

We do not currently have a published maintenance window. When we have customers, the proposal:

- **Default window:** Sunday 2 AM ET → 4 AM ET (lowest traffic across US time zones)
- **Notification:** 7 days advance via email + in-app banner
- **Emergency window:** any time, with as-much-advance-notice-as-possible (minimum 2 hours)

---

## 7. Escalation

If the on-call cannot resolve within:

- **30 minutes for a P0 (site down, data leak)** → escalate to secondary on-call
- **2 hours for a P1 (partial degradation)** → escalate to secondary on-call
- **4 hours for a P2 (cosmetic / single-tenant issue)** → continue working, escalate next business day

Currently, primary = secondary = founder, so this is a no-op. Update when team grows.

---

## 8. After-action follow-up

For every incident:
1. Postmortem within 48 hours (template in section 4)
2. Update this runbook if a new failure mode was discovered
3. Open backlog items for every "action item" listed in the postmortem
4. Review during the monthly compliance-readiness meeting (see `docs/COMPLIANCE_REVIEW_TEMPLATE.md`)

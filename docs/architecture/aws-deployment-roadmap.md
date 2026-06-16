# FORGE Production Deployment & Scaling Roadmap

**Document version:** 1.0
**Date:** 2026-06-16
**Author:** Engineering
**Audience:** Founders, CTO, future investors, future compliance auditors
**Status:** Proposal — awaiting founder sign-off

---

## Executive Summary

FORGE is a multi-tenant SaaS for US government contractors. Our market — federal, state, and DoD — requires increasingly stringent compliance (SOC 2, CMMC 2.0 Level 2 mandatory Nov 2026, FedRAMP Moderate for federal direct work). However, **we are pre-revenue**. Spending capital on premature infrastructure or compliance certifications before customers demand them would be a strategic error.

This document lays out a **trigger-based scaling roadmap** that:

1. **Keeps spend at ~$20-40/month right now** by staying on our current Vercel + Neon stack.
2. **Maps a clean migration path to AWS** for when revenue justifies it (recommended trigger: $20K MRR or first customer who requires SOC 2 attestation in writing).
3. **Reserves all FedRAMP / CMMC / GovCloud spend for the moment a federal or DoD customer signs a contract**, not before.
4. **Applies SDLC best practices NOW** without infrastructure change so engineering velocity doesn't suffer.

The principle: *every dollar of infrastructure or compliance spend should be tied to a specific revenue event or customer demand.* No speculative spend.

---

## 1. Today's Stack (and Why It's the Right Choice for Now)

### Current production architecture

- **Frontend + API:** Next.js 14 on Vercel (serverless functions)
- **Database:** Neon Postgres (serverless, scale-to-zero)
- **Auth:** NextAuth (self-hosted in the Next app)
- **Email:** Resend
- **AI:** Anthropic Claude (via the Anthropic API)
- **Collab (in development):** Hocuspocus self-hosted (BL-9)

### Cost today

| Service | Tier | Monthly cost |
|---|---|---|
| Vercel | Pro | $20 |
| Neon | Free or Launch | $0-20 |
| Resend | Free tier | $0 |
| Anthropic API | Pay-per-use | $5-20 |
| **Total** | | **$25-60/mo** |

### What we already get for "free"

| Capability | Source | Notes |
|---|---|---|
| TLS everywhere | Vercel + Neon | Automatic |
| DDoS protection | Vercel edge | Automatic |
| Automated backups | Neon PITR | 7-day window |
| SOC 2 Type II infrastructure | Vercel + Neon | Both providers are SOC 2 certified at the infra level |
| HIPAA-eligible infrastructure | Vercel + Neon | BAAs available when we need them |
| Auto-scaling | Vercel + Neon | Both scale to zero at idle |
| Multi-region edge | Vercel | Free on Pro tier |
| CDN | Vercel | Free on Pro tier |

### Why we keep this stack pre-revenue

1. **Cost.** $25-60/mo is roughly the cost of one mid-tier SaaS subscription. AWS commercial would put us at $300-500/mo immediately for similar capability. Pre-revenue, that's 6-12x the burn.
2. **Engineering velocity.** Vercel handles deploys, rollbacks, preview environments, edge caching, monitoring, and observability — all without us writing Terraform or operating ECS. Engineering time spent on infra is engineering time not spent on features.
3. **Compliance posture.** Vercel and Neon are already SOC 2 Type II. As we go through OUR SOC 2 audit, we inherit a lot of their controls. Moving to self-managed AWS *adds* to our compliance scope.
4. **No customer demand to leave.** Until a customer asks "where is my data hosted?" and the answer must be "AWS GovCloud," we have no business reason to move.

### What we are NOT getting today (and when it matters)

| Capability | Available on current stack? | When does this become a blocker? |
|---|---|---|
| US data residency | Yes (Vercel US regions, Neon `us-east-1`) | Now — already met |
| GovCloud (FedRAMP) | No | When first federal-direct customer signs |
| AWS Marketplace listing | No (Vercel isn't AWS) | When customers procure via AWS Marketplace |
| Customer-managed encryption keys (CMK) | No | When an enterprise customer demands BYOK |
| ITAR-compliant access controls | Partial (need US-persons-only tagging in app) | When first ITAR proposal lands |

---

## 2. Three-Environment SDLC Model (apply NOW, no infrastructure change)

Best practice is a three-environment promotion pipeline. We can implement this **today on Vercel** without touching infra.

| Environment | URL | Branch | Trigger | Approval |
|---|---|---|---|---|
| **dev** | localhost | feature branches | `npm run dev` per developer | none |
| **staging** | `staging.forge.app` | `main` | every merge to `main` auto-deploys | none — that's the point of staging |
| **prod** | `app.forge.app` | `release` | manual: cherry-pick from `main` or merge `main` → `release` | **manual approval gate** in GitHub environment protection |

### How this works on Vercel today

Vercel supports multiple "environments" per project. We configure:

1. **Production branch** = `release` (currently it's `main`)
2. **Preview deploys** for every PR on every branch (already enabled)
3. **`main`** auto-deploys to a separate Vercel project (`forge-staging`) bound to `staging.forge.app`
4. **`release`** auto-deploys to the production Vercel project bound to `app.forge.app`
5. **GitHub environment protection rule** on `production` requires a manual approval before any merge-to-`release` workflow runs

### Promotion ritual

```
1. Developer merges feature PR to `main`
2. Staging auto-deploys; CI runs full suite on the staging deploy
3. QA / founder smoke-tests staging
4. When ready, open a PR: `main` → `release`
5. Required reviewer approves (founder or designated lead)
6. PR merges; production Vercel deploys
7. Tag a release in GitHub for changelog tracking
```

This gives us a real promotion gate with full audit trail, **at zero infrastructure cost**.

### Migration safety we already have

- **Auto-migrate on cold start** (PR #194)
- **Destructive operation blockers** that refuse to auto-apply DROP statements
- **Pre-apply Neon branch snapshots** (PR #194 + env vars when configured)
- **Ledger drift detector** on every cold start (PR #203 + PR #206)
- **Pre-push self-review CI gate** that blocks PRs missing the safety checklist

We are already running a more disciplined migration pipeline than most early-stage SaaS companies. This is portable to AWS unchanged.

---

## 3. Growth Triggers (When We Spend, and on What)

Each trigger below corresponds to a specific event. We do NOT spend the money or take the action until the trigger fires.

### Trigger A — *Right now: pre-revenue*

**Spend cap: $100/month.** Stay on Vercel + Neon. Apply SDLC discipline (Section 2). Do not engage compliance vendors.

### Trigger B — *First paying customer signs*

**New spend:** SOC 2 Type II audit contract. ~$15-25K one-time + $10-15K annual. Vendors: Vanta, Drata, or Secureframe (they handle most of the controls automation).

**Why now:** Most enterprise B2B customers ask for SOC 2 in their vendor questionnaire. The audit has a **12-month observation window** — if we don't start the clock now, we can't hand a customer a current SOC 2 report when they ask in 9 months.

**What it changes for engineering:**
- Enable MFA on every admin account (GitHub, Vercel, Neon, Resend, Anthropic, AWS root)
- Document the existing access-review cadence (we already do this informally)
- Add SOC 2-mandated audit-log retention (we already capture audit_log; retention is just a policy decision)
- Add documented incident response runbook (mostly write-up of what we'd do anyway)

### Trigger C — *5-10 paying customers OR $5K MRR*

**New spend:** Production observability. PagerDuty ($21/user/mo) + Datadog or Sentry Pro ($25-100/mo). **Total: ~$75-150/mo.**

**Why now:** With real customers we need real on-call. Free Vercel monitoring is fine for pre-revenue; insufficient when downtime costs us a customer.

**What it changes for engineering:**
- Set up alert routing
- Define SLOs (e.g. 99.5% uptime for v1)
- Document runbooks for the top 5 failure modes

### Trigger D — *$20K MRR OR first customer requires SOC 2 in writing*

**New spend:** Migrate to AWS commercial. ~$300-500/mo recurring + ~3-4 weeks of focused engineering work (one-time).

**Why now:** At $20K MRR we can afford the $400/mo delta. At the SOC 2-in-writing threshold, having our own AWS account with documented controls is easier to audit than a shared Vercel project. **This is the migration moment.**

**Decision** (defer to Section 5): commercial AWS in `us-east-1`, single region.

### Trigger E — *First customer asks "Do you have FedRAMP?"*

**New spend:** FedRAMP 20x Moderate submission. $100-300K one-time via Coalfire / Knox / Workstreet + $50-100K/year ConMon (continuous monitoring). 2-3 month timeline.

**Why now:** FedRAMP 20x Moderate openings target Q3 2026. Until a customer asks, we don't apply.

**Pre-requisite:** must be already on AWS commercial (Trigger D); GovCloud lift comes with FedRAMP submission.

### Trigger F — *First DoD customer signs or first contract requires CUI handling*

**New spend:** AWS GovCloud lift + CMMC 2.0 Level 2 assessment. ~$50-100K + assessor fees. ~2x AWS cost multiplier going forward.

**Why now:** CMMC 2.0 Level 2 is **mandatory November 2026** for any DoD prime/sub handling CUI. ITAR-controlled proposals also force GovCloud or equivalent.

---

## 4. Compliance Roadmap (Mapped, Not Committed)

This is a complete reference for what we'll need to address as we grow. None of it requires action today except SOC 2 (Trigger B).

| Framework | When required | Estimated cost | Timeline | Engineering impact |
|---|---|---|---|---|
| **SOC 2 Type II** | Most enterprise B2B contracts | $15-25K one-time + $10-15K/yr | 12 months observation + 2 months audit | Document existing controls; minor process changes |
| **HIPAA BAA** | If any customer's proposal touches PHI | Free with Vercel / Neon (sign existing BAA template) | 1 month legal review | None — controls already in place |
| **ITAR** | If proposal handles export-controlled defense tech | $0 cert, but process required | 1-2 months | US-persons-only access tags on tenants + audit log surface |
| **CMMC 2.0 Level 2** | **Mandatory Nov 2026 for any DoD contractor handling CUI** | $50-100K + C3PAO assessor | 3-6 months | Major: SP 800-171 controls, FIPS-validated crypto, GovCloud or equivalent |
| **FedRAMP Moderate** (via 20x) | Federal-direct sales | $100-300K + $50-100K/yr | ~2 months (20x), Q3 2026 broader openings | Major: AWS GovCloud, full IaC, continuous monitoring |
| **FedRAMP High** | Highly sensitive federal workloads | $400K-1M+ | 12-18 months | Unlikely target for FORGE; mention only |
| **DoD IL2** | Reciprocal with FedRAMP Moderate | $0 extra if FedRAMP Mod | n/a | Inherited |
| **DoD IL4** | Reachable from FedRAMP Moderate with modest extra assessment | $20-50K extra | 1-2 months extra | Inherited |
| **DoD IL5** | Requires separate authorization even from FedRAMP High | $100K+ | 6 months | Not a target |

### Recommended sequencing

```
Year 0 (now)       : Apply SDLC discipline. No compliance spend.
Year 1 (first sale): Start SOC 2 audit clock. Sign HIPAA BAAs.
Year 2 ($20K MRR) : Move to AWS. Renew SOC 2. ITAR controls in code.
Year 3 (fed lead) : FedRAMP 20x Moderate submission.
Year 4 (DoD lead) : GovCloud lift + CMMC Level 2.
```

---

## 5. AWS Target Architecture (executed when Trigger D fires)

This section is the blueprint for the migration when revenue justifies it. **No work happens here until the trigger fires.**

### Account structure

- **Single AWS Organization** with multiple member accounts.
- **management account** — billing, AWS Organizations, no workloads
- **prod-commercial** — production workload, commercial AWS
- **prod-gov** — created when GovCloud lift is needed (Trigger F)
- **shared-services** — Route 53, ACM, IAM Identity Center, central CloudTrail
- **audit-log** — write-only sink for org-wide CloudTrail logs

### Production architecture (commercial AWS, single region, `us-east-1`)

```
                       Route 53  (app.forge.app)
                              │
                       CloudFront (WAF attached)
                              │
                             ALB
                              │
                ┌─────────────┴─────────────┐
                │                           │
                ▼                           ▼
         ECS Fargate                   ECS Fargate
         (Next.js app)                 (Hocuspocus collab)
                │                           │
                └─────────────┬─────────────┘
                              ▼
                Aurora Serverless v2 PostgreSQL
                (Multi-AZ, automated backups)
                              │
                              ▼
                      Secrets Manager
                          (rotating)
                              │
                              ▼
                  KMS CMK (per-environment)
                              │
                              ▼
               S3 (user uploads, exports, PDFs)
                              │
                              ▼
                    CloudWatch (logs + metrics)
```

### Why these choices

| Component | Why |
|---|---|
| ECS Fargate | Containers without managing nodes. Cheaper than EKS at our scale. More predictable than App Runner. |
| Aurora Serverless v2 | Real PostgreSQL (no compatibility risk vs RDS). Scales to ~zero at idle. FedRAMP-eligible. |
| ALB + CloudFront + WAF | Standard pattern. WAF gives us rate limits, OWASP rules, geo-blocking for ITAR. |
| Secrets Manager | Automatic password rotation for RDS. Better than env vars in a config file. |
| KMS CMK | Customer-managed keys enable a BYOK story for enterprise customers later. |
| Terraform | Best-known IaC tool by gov contractors' DevOps; large community for compliance modules. |

### Estimated monthly cost (commercial AWS, single region)

| Component | Cost |
|---|---|
| ECS Fargate × 2 tasks (Next.js) | $25 |
| ECS Fargate × 1 task (Hocuspocus) | $15 |
| Aurora Serverless v2 (0.5 ACU min) | $60-100 |
| ALB + CloudFront + Route 53 | $40 |
| S3 + CloudFront egress | $15 |
| Secrets Manager + KMS + ECR + CloudWatch | $30 |
| WAF | $10 |
| NAT Gateway (×3 AZs) | $95 |
| **Subtotal commercial AWS** | **~$290-330/month** |

**GovCloud premium when we lift:** ~2-3x → **$700-1000/month** at the same scale.

### Scaling math

| Active orgs | Vercel + Neon | AWS commercial | AWS GovCloud |
|---|---|---|---|
| 1-10 | $25-60/mo | n/a (don't move yet) | n/a |
| 10-50 | $50-150/mo | $300-450/mo | $700-1200/mo |
| 50-200 | $150-400/mo | $400-700/mo | $1000-2000/mo |
| 200-500 | $400-800/mo | $700-1500/mo | $2000-4500/mo |

**Reading this:** at every scale up to ~500 active orgs, Vercel + Neon is cheaper than AWS by ~2-5x. The reason to move is *not* cost — it's compliance, customer demand, or operational control.

---

## 6. Migration Playbook (when Trigger D fires)

When we decide to move to AWS commercial, the work breaks down as follows. Total: **~3-4 weeks of focused engineering work**, executed against the live staging environment first.

| Phase | Scope | Effort | PRs | Risk |
|---|---|---|---|---|
| 0 | This planning doc (already done) | hours | 1 | none |
| 1 | AWS org + account setup; IAM Identity Center; KMS CMKs; ECR repositories | 2-3 days | 1 | low |
| 2 | Terraform skeleton: VPC, subnets, security groups, NAT, ALB | 3-4 days | 1-2 | low |
| 3 | Containerize Next.js: Dockerfile, healthcheck endpoint, ECR push pipeline | 2 days | 1 | low |
| 4 | Aurora Serverless v2 provision + run all Drizzle migrations against empty prod DB | 1 day | 1 | low |
| 5 | ECS service + ALB target group + Route 53 record for `app.forge.app` | 3-4 days | 1 | medium |
| 6 | Hocuspocus service deployed to ECS as second Fargate task | 2 days | 1 | low |
| 7 | Synthetic smoke test (Playwright) against the AWS URL with dummy traffic | 2-3 days | 1 | low |
| 8 | Data migration: pg_dump from Neon, restore to Aurora; ~15 min downtime window during off-hours | runbook + ops | n/a | **medium-high** |
| 9 | DNS cutover: `app.forge.app` → AWS ALB; freeze Vercel prod to read-only for rollback safety | DNS change + runbook | n/a | medium |
| 10 | Vercel demoted to staging-only; cron jobs migrated to EventBridge | 1 PR | 1 | low |

### Rollback plan

At every phase, rollback is via:
- **DNS revert:** `app.forge.app` points back to Vercel within 5 minutes
- **Data:** Aurora PITR to the cutover moment OR re-restore from Neon's last backup
- **Total recovery time objective:** 30 minutes

We never delete the Vercel deployment during the migration window. It stays warm and ready until we have 1-2 weeks of clean AWS prod runs.

---

## 7. Action Items (apply this week, regardless of triggers)

These are the items we can and should do **now** with zero infrastructure spend. They make the company more bid-able the moment a customer questionnaire lands.

| # | Action | Owner | Cost | Effort |
|---|---|---|---|---|
| 1 | Enable MFA enforcement on every account: GitHub, Vercel, Neon, Anthropic, Resend, AWS root | Founder | $0 | 1 hour |
| 2 | Document the existing incident response process in `docs/RUNBOOK.md` | Engineering | $0 | 1 day |
| 3 | Set up GitHub environment protection rule for production releases (Section 2) | Engineering | $0 | 2 hours |
| 4 | Pick a SOC 2 audit vendor (Vanta / Drata / Secureframe) and schedule discovery call — start audit clock when first paying customer signs | Founder | $0 now, ~$15K Trigger B | 1 week of discovery calls |
| 5 | Sign HIPAA BAAs with Vercel and Neon if not already signed | Founder | $0 | 1 hour |
| 6 | Add ITAR-readiness tagging to the org model: `tenant.itarRestricted` boolean + UI to mark US-persons-only access (defer code work until first ITAR proposal) | Engineering | $0 | tracked in backlog |
| 7 | Establish a monthly "compliance readiness" review: 30 min, check status of triggers, action items, customer requests | Founder | $0 | 30 min/mo |
| 8 | Quarterly secrets rotation reminder (AUTH_SECRET, DATABASE_URL credentials, API keys) | Engineering | $0 | 1 hour/quarter |

---

## 8. Decisions to Confirm (for the record)

These are the architectural decisions implicit in this plan. We document them now even though we don't act on them until a trigger fires. This gives auditors a clean trail later.

| # | Decision | Rationale |
|---|---|---|
| 1 | Stay on Vercel + Neon until Trigger D ($20K MRR or SOC 2 in writing) | Pre-revenue cash discipline. Lower engineering burden. Compliance posture is acceptable. |
| 2 | When migrating, go to AWS commercial first, GovCloud only when CUI customer signs | Commercial AWS is 1/2 to 1/3 the cost. GovCloud lift is mechanical with Terraform. |
| 3 | ECS Fargate (not EKS, not App Runner) | Right-sized for our scale; standard pattern for compliance audits. |
| 4 | Aurora Serverless v2 (not RDS, not keep Neon) | Real PostgreSQL, scales to zero, FedRAMP-eligible. |
| 5 | Terraform (not CDK, not Pulumi) | Largest community for FedRAMP-compliant modules (Coalfire publishes Terraform). |
| 6 | Single region (us-east-1) for v1 of prod | Multi-region adds cost and complexity; defer until customer SLA demands it. |
| 7 | SOC 2 audit clock starts at first paying customer, not pre-revenue | 12-month observation window means we need to start when we have something to attest. |
| 8 | FedRAMP / CMMC spend deferred until a federal/DoD customer is in pipeline | $100K+ outlay must be tied to a revenue event. |

---

## 9. Open Questions for the Founder

Before this plan is final, please confirm:

1. **Trigger D threshold:** is $20K MRR the right move-to-AWS threshold, or should we move earlier on a customer-demand signal?
2. **SOC 2 vendor preference:** Vanta, Drata, or Secureframe? All three are within $5K of each other; Vanta is best-known by enterprise procurement.
3. **Founder approval for production deploys:** who is the named approver on the GitHub environment protection rule? Recommend: founder + one designated lead.
4. **Off-hours maintenance window for the eventual AWS cutover:** what time zone / day do we want the 15-min downtime to land? Recommend: Sunday 2 AM ET.
5. **Multi-tenant data residency:** any customer requirement we know about today that pushes us to specific AWS regions?

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **Trigger** | A specific revenue or customer-demand event that authorizes infra/compliance spend |
| **MRR** | Monthly recurring revenue |
| **SOC 2** | Service Organization Control 2 — security/availability/confidentiality audit |
| **FedRAMP** | Federal Risk and Authorization Management Program — federal cloud auth |
| **20x** | FedRAMP's new automated pathway, faster + cheaper than legacy FedRAMP |
| **CMMC** | Cybersecurity Maturity Model Certification — DoD's framework |
| **CUI** | Controlled Unclassified Information — DoD's sensitive-but-not-classified tier |
| **ITAR** | International Traffic in Arms Regulations — defense export controls |
| **GovCloud** | AWS's FedRAMP High / DoD-authorized cloud regions |
| **IaC** | Infrastructure as Code (Terraform, CDK, Pulumi) |
| **IL2/4/5** | DoD Impact Levels — cloud authorization tiers |
| **PITR** | Point-in-time recovery |
| **CMK** | Customer-managed encryption key |
| **WAF** | Web Application Firewall |

---

## Appendix A — Vendor Cost Comparison Snapshot (2026-06)

| Vendor | Monthly cost at our scale | SOC 2 Type II | HIPAA BAA | FedRAMP Moderate | Lock-in risk |
|---|---|---|---|---|---|
| Vercel + Neon (today) | $25-60 | yes (infra) | yes | no | low |
| Vercel + Supabase | $50-100 | yes (infra) | yes (Team+) | no | low |
| AWS commercial | $300-500 | self-attest | self-attest | self-attest | low |
| AWS GovCloud | $700-1000 | self-attest | self-attest | yes (process required) | low |
| Azure Gov + GCC High | $700-1200 | yes | yes | yes | medium |
| Atlassian Gov Cloud (irrelevant — not an infra vendor) | n/a | n/a | n/a | yes | n/a |

---

## Appendix B — One-Page Founder Summary

**Where we are:** Pre-revenue SaaS for US gov contractors on Vercel + Neon. ~$40/mo total infra.

**Where we go:** Same stack until $20K MRR or first SOC-2-in-writing customer. Then AWS commercial. Then AWS GovCloud + FedRAMP when first federal customer signs.

**What we spend now:** $0 on infra changes. $0 on compliance. The discipline goes into code (which we already have) and process (which is one week of write-up).

**What we do NOT do:** Build out AWS, sign SOC 2 contracts, write Terraform, hire a compliance consultant. All of those are deferred to specific revenue triggers.

**Total spend through Year 1, conservative estimate:**

| Year | Trigger reached | Infra | Compliance | Total |
|---|---|---|---|---|
| Year 0 | None (today) | $500 | $0 | $500 |
| Year 1 | First paying customer | $1,000 | $15,000 SOC 2 audit | $16,000 |
| Year 2 | $20K MRR + 25 customers | $6,000 AWS commercial | $25,000 SOC 2 annual + ITAR controls | $31,000 |
| Year 3 | First federal customer | $12,000 AWS commercial scaled | $150,000 FedRAMP 20x submission + ConMon | $162,000 |
| Year 4 | First DoD/CUI customer | $25,000 AWS GovCloud | $75,000 CMMC L2 assessment | $100,000 |

**Annual recurring after Year 4 (steady-state with federal + DoD customers):** ~$250-400K combined infra + compliance, against a customer base that should be generating $1M+ ARR at that scale.

---

**End of document.**

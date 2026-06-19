# ADR-001: Payment provider — Stripe over Paddle

**Status:** Accepted
**Date:** 2026-06-17
**BL ref:** BL-17 Slice 1
**Decision owner:** Founder
**Authors:** Engineering (research) + Founder (decision)

---

## Context

FORGE's public pricing page shipped in PR #215 (BL-PACKAGES Slice 4). The CTAs currently route to `/sign-up?tier=<slug>` but no actual payment processing happens — that's blocked on this provider decision. We need to pick a payment provider before BL-17 Slice 2 (schema + webhook plumbing) can begin.

### Customer profile that drives the decision

- **Primary:** US government contractors (small-to-mid businesses) bidding on federal RFPs
- **Customer size:** $5K–$25K ARR per customer in Year 1, climbing to $50K+ at enterprise tier
- **Geographic mix:** ~90% US, ~10% Five-Eyes allies
- **Payment workflows:** mix of credit card (SMB), ACH (mid-market), wire + invoice + PO + Net-30 (enterprise / federal direct)

### Candidates evaluated

1. **Stripe** (Stripe Payments + Stripe Billing + Stripe Tax + Stripe Invoicing)
2. **Paddle** (merchant-of-record, single bundled pricing)

Both have mature SaaS-subscription products with TypeScript SDKs and webhook-based reconciliation. Both reach US business customers. The economic + workflow profile is what separates them.

---

## Decision

**Adopt Stripe** (Payments + Billing + Tax + Invoicing).

---

## Rationale (4 reasons, in priority order)

### 1. Native enterprise invoicing is non-negotiable for our customer base

US government contractors and primes pay enterprise SaaS subscriptions by **wire transfer against a PO-referenced invoice with Net-30 terms**. Stripe Invoicing was built for this exact flow: each invoice gets a virtual US bank account number, customers wire money to it, Stripe auto-reconciles and fires the `invoice.paid` webhook. Total fee on a $200K wire-paid invoice: **$10** (wire $8 + invoicing $2 cap).

Paddle supports wire transfer through "sales-assisted invoices" but is widely documented as a poor fit for enterprise B2B Net-30 / PO workflows — multiple independent reviews flag this as where Paddle's B2C origins show. On a $200K wire-paid invoice, Paddle's flat 5% + $0.50 fee would cost **$10,000.50** — and you can't negotiate that down.

### 2. Stripe is ~40% cheaper on processing at our customer profile

Blended cost per $20K customer (80% card / 20% wire-invoice, 30% in taxed states):

| Customers | Annual revenue | Stripe cost | Paddle cost | Paddle premium |
|---|---|---|---|---|
| 10 | $200K | $5,860 | $10,005 | +$4,145/yr |
| 100 | $2.0M | $58,600 | $100,050 | **+$41,450/yr** |
| 1,000 | $20M | $586,000 | $1,000,500 | **+$414,500/yr** |

At 1,000 customers Stripe will negotiate volume discounts further; Paddle's 5% is largely fixed.

Paddle's premium "buys" tax compliance (they file in 200+ jurisdictions as merchant of record). For our 90% US revenue + mostly B2B-with-resale-certificate customer mix, US sales tax is only collected in ~5–20 states. Stripe Tax handles that at +0.5% of taxed volume (~$3K/yr at 100 customers).

### 3. Vercel + Next.js DX is materially better with Stripe

- **Official Vercel template** for Stripe subscriptions on Next.js (`vercel/nextjs-subscription-payments`) — directly applicable to our App Router setup
- **Stripe CLI** for local webhook replay during development
- **`stripe-node` SDK** has exhaustive TypeScript types
- Paddle's SDK is functional but has documented sharp edges with Next.js 14 App Router (raw body parsing for webhook signature verification)

Estimated integration effort:
- Stripe: 24–40 hours single engineer to ship Checkout + webhooks + customer portal
- Paddle: 32–56 hours single engineer (extra time on webhook parsing + sales-assisted invoice quirks)

### 4. Migration asymmetry: picking wrong is more expensive with Paddle

If we pick Stripe and later need Paddle (improbable):
- Cards export to other PCI-L1 processors via PAN migration toolkit
- Realistic switching cost: ~$50–80K + 12–18 months natural runoff
- **Manageable**

If we pick Paddle and later need Stripe (also improbable):
- Paddle is merchant-of-record; **cards do NOT export to non-MoR processors**
- Every customer must re-enter their card at switchover — documented 4+ month migration with churn risk
- **Expensive and customer-facing**

Even absent a decisive Paddle advantage, this asymmetry alone favors Stripe.

---

## Honest tradeoffs we accept

These are the things Paddle would have given us that we're choosing to handle ourselves.

| Tradeoff | Mitigation |
|---|---|
| **We own US sales tax filing** | Stripe Tax calculates + collects; we file. Budget 4–8 hours/quarter of finance time, or pay Anrok/Numeral ~$5K/yr to automate fully when revenue justifies. |
| **Chargebacks are our problem** | $15 + $15 per dispute. For low-fraud B2B, expected chargeback rate <0.1% — immaterial. |
| **International VAT/GST is on us** when foreign customers land | Stripe Tax handles calculation for ~$0.50/invoice for foreign transactions. At 10% non-US revenue this stays negligible until we cross €10K/yr to any EU country. |
| **Smart Retries underperforms Stripe's claim** | Pair with Resend-based dunning sequence (16-hour engineering investment) using existing notification pipeline. |

---

## Things that did NOT influence the decision

**Both vendors lack FedRAMP authorization.** Paddle's "FedRAMP Compliant" claim on a third-party security aggregator does NOT correspond to a FedRAMP Marketplace listing — verified against `marketplace.fedramp.gov`. Stripe has SOC 2 Type II + PCI DSS L1 + ISO 27001 but no FedRAMP. Neither is FedRAMP-authorized.

For now, this is a **non-differentiator**. When FORGE pursues FedRAMP (Trigger E in `docs/architecture/aws-deployment-roadmap.md`), we'll need to either (a) use a sub-merchant pattern with a FedRAMP-authorized partner, or (b) move billing to a FedRAMP-authorized boundary. We'll re-evaluate this ADR at that point.

**Vendor health:**
- Stripe: $159B valuation (Feb 2026 tender), $1.9T 2025 TPV, $2.2B FCF (2024) — stable
- Paddle: $1.4B valuation (Series D, KKR 2024), ~$91M ARR (2024) — smaller but stable

Both are appropriate counterparties for FORGE's scale. Not a tiebreaker.

---

## Implementation plan (BL-17 Slices 2–5)

Pre-requisite (operator): Stripe account creation + business verification (~1-2 business days).

### Slice 2 — Schema + webhook plumbing (1–2 days)

- Add `tenant_subscription.stripe_customer_id` + `.stripe_subscription_id` columns (Drizzle migration)
- New `payment_event` table for webhook idempotency + audit trail
- `/api/webhooks/stripe` route with `stripe.webhooks.constructEvent` signature verification
- Webhook handlers for: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
- Each handler updates `tenant_subscription` and writes an audit log row

### Slice 3 — Checkout flow (2–3 days)

- `/sign-up?tier=<slug>` reads tier slug, creates user + org, redirects to Stripe Checkout
- Success URL → `/settings/billing` with tier provisioned via webhook
- Cancel URL → `/pricing`
- Promo code support at checkout (Stripe Coupons; redeem against `promo_code` table)
- "Get started" CTA on `/pricing` updated to deep-link this flow

### Slice 4 — Customer portal + dunning (1–2 days)

- "Manage subscription" button in `/settings/billing` → `stripe.billingPortal.sessions.create`
- Failed-payment retry via Stripe Smart Retries (default)
- Resend-backed dunning email layer on `invoice.payment_failed` (0/3/7/14-day cadence)
- Downgrade-to-free on dunning failure (configurable threshold)

### Slice 5 — Upgrade / downgrade + enterprise invoicing (1 day)

- Signed-in users on `/pricing` → "Upgrade" button → Stripe customer portal proration flow
- Enterprise threshold ($50K+ deals): `payment_method: 'invoice'` branch using `stripe.invoices.create` with `collection_method: 'send_invoice'` + bank-transfer payment method enabled
- PO# field surfaced in invoice generation flow

### Total effort

7–10 days of focused engineering work, executed against staging first. Each slice is independently shippable behind feature flags.

---

## Operator setup checklist (before Slice 2 starts)

- [ ] Create Stripe account at https://dashboard.stripe.com (founder)
- [ ] Complete business verification (W-9, bank account, ownership) — ~1-2 business days
- [ ] Create Products + Prices in Stripe Dashboard matching the active `subscription_tier` rows
- [ ] Generate API keys (publishable + secret)
- [ ] Add to Vercel env (Production scope, Sensitive flag):
  - `STRIPE_SECRET_KEY` (sk_live_...)
  - `STRIPE_WEBHOOK_SECRET` (whsec_..., from webhook endpoint config)
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_live_...)
- [ ] Configure webhook endpoint in Stripe Dashboard pointing at `https://app.forge.app/api/webhooks/stripe`
- [ ] Sign Stripe's terms; opt into Stripe Tax via Dashboard (start with home state registration)

---

## Sources

Full research report from the deep-research agent backing this ADR is preserved in this session's transcript. Key public sources verified across multiple references:

- [Stripe pricing](https://stripe.com/pricing)
- [Stripe Tax pricing](https://support.stripe.com/questions/understanding-stripe-tax-pricing)
- [Stripe Bank Transfer (Invoicing)](https://docs.stripe.com/invoicing/bank-transfer)
- [Stripe Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)
- [Stripe Customer Portal](https://docs.stripe.com/customer-management)
- [Stripe valuation Feb 2026 (CNBC)](https://www.cnbc.com/2026/02/24/stripe-value-stock-sale-tender-offer.html)
- [Paddle pricing](https://www.paddle.com/pricing)
- [Paddle wire transfers](https://www.paddle.com/help/start/set-up-paddle/wire-transfers:-definition-how-to-use)
- [Paddle sales-assisted invoices](https://developer.paddle.com/concepts/sell/sales-assisted-invoice/)
- [Paddle B2B limitations (independent review)](https://usagetracking.com/posts/review-paddle.html)
- [Stripe vs Paddle migration costs (flowjam)](https://www.flowjam.com/blog/paddle-vs-stripe-billing-2024-complete-comparison-guide-for-saas)
- [Vercel Next.js Stripe template](https://github.com/vercel/nextjs-subscription-payments)
- [FedRAMP Marketplace](https://marketplace.fedramp.gov/) (used to verify neither vendor is authorized)

---

## Revisit triggers

This ADR should be re-evaluated when:

1. **First federal-direct customer signs** — FedRAMP becomes a real requirement; current "neither is FedRAMP-authorized" stops being acceptable
2. **International revenue exceeds 30%** — Paddle's MoR tax handling becomes economically competitive
3. **A customer demands Paddle / SumUp / Adyen specifically** — rare but possible for enterprise procurement preferences
4. **Stripe materially changes pricing** — e.g. doubles the Billing add-on rate

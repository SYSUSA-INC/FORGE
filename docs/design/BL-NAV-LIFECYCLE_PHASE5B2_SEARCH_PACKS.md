# Phase 5b-2 — Prepaid search packs: design for review

**Status:** approved by the owner (2026-11-17, "all recommended") with
every recommended answer in §4. Built: 5b-2a (#499: the balance, the
ledger, the draw) and 5b-2b (buying, the webhook, refunds). One addition
to §2.2: a purchase entry keeps its Stripe payment intent (migration
0174) so a refund finds it. Background: the owner already
chose the model (2026-11-16): **prepaid credit packs through Stripe
Checkout**, not metered card-on-file billing. Searches draw the pack
down, research pauses at zero, no overage, no dunning.
**Requirements:** FORGE II D-2 in `docs/FORGE_II_REQUIREMENTS.md`.
**Plan:** BL-NAV-LIFECYCLE phase 5, after 5b-1a (#496) and 5b-1b (#497).
**Parent design:** `BL-NAV-LIFECYCLE_PHASE5_DEVELOP.md` §2.2.

## 1. What FORGE already has

| Piece | Where today | What it gives packs |
|---|---|---|
| The plan's search allowance | Tier quota `webSearchesPerMonth`, counted in `tenant_usage_counter`; `reserveWebSearches` (one guarded upsert that cannot pass the cap), `releaseWebSearches`, `getWebSearchAllowance` in `src/lib/subscription-gates.ts` | The first thing a run draws from; the pattern for an atomic draw |
| The research run | `src/lib/research-job.ts`: reserve up to five searches before searching, give back the unused | The one caller that draws and gives back |
| Stripe Checkout | `src/app/(app)/settings/billing/actions.ts`: plan and add-on sessions, both `mode: "subscription"`; org admin only; audited | The action shape, the customer handling, the success and cancel pages |
| The webhook | `/api/webhooks/stripe`: signature check, `payment_event` with a unique `stripe_event_id` so a repeated delivery is dropped, the tenant found from the Stripe customer or `client_reference_id` | Crediting that cannot happen twice |
| Add-ons | `tier_addon` / `tenant_addon`: recurring subscriptions that raise a monthly ceiling | Not a fit: an add-on is not a balance that is used up |
| The panel | Settings → AI Engine → AI and Search (`ResearchPanel`): used, left, the tenant's own cap | Where the pack balance shows |

**What is missing:** a one-time payment (every session today is a
subscription), any credit balance or ledger, and a way for the draw to
continue past the plan's allowance.

## 2. The design

### 2.1 What the customer sees

An org admin opens **Settings → Billing** (or follows **Buy more
searches** on the AI and Search panel), picks a pack, pays on Stripe's
page, and comes back. The panel then shows two lines: the plan's
searches used and left this month, and the pack searches left. Research
uses the plan's searches first and the pack only when the plan's are
gone. When both are at zero, research does not run; the Auto-draft
dialog says so and names where to buy a pack, and the drafts go ahead on
the company's own records, as today.

### 2.2 Data (migration 0173)

Three tables, all carrying `organization_id` except the catalogue:

- **`search_pack`** (catalogue, platform-wide): `slug`, `name`,
  `searches`, `price_cents`, `currency`, `active`. Seeded with one pack
  (decision 1). Checkout uses the row's price inline (`price_data`), so
  nothing has to be created in the Stripe dashboard first.
- **`tenant_search_credit`**: `organization_id` (primary key),
  `balance` (integer, `CHECK (balance >= 0)`), `updated_at`. One row per
  tenant: the number a draw is guarded against.
- **`search_credit_entry`** (append-only ledger): `id`,
  `organization_id`, `delta` (signed), `kind` (`purchase`, `draw`,
  `release`, `refund`, `adjust`), `balance_after`, `pack_slug`,
  `stripe_checkout_session_id` (unique where not null),
  `stripe_event_id`, `proposal_id`, `actor_user_id`, `note`,
  `created_at`. Every change to a balance writes one entry in the same
  transaction, so the balance always equals the sum of its entries (a
  test asserts it).

### 2.3 Drawing: plan first, then pack

`reserveWebSearches(organizationId, want)` keeps its meaning and gains a
second step. It returns `{ reserved, fromPlan, fromPack, ... }`.

1. Plan: today's guarded upsert on `tenant_usage_counter`, for as many
   of `want` as the plan's allowance still holds. Unchanged.
2. Pack, only for the rest: one statement,
   `UPDATE tenant_search_credit SET balance = balance - n WHERE
   organization_id = $1 AND balance >= n RETURNING balance`, where `n`
   is the lesser of the rest and the balance just read. If a racing run
   took the balance first, the statement matches no row and this run
   takes nothing from the pack; it never goes below zero (the `CHECK`
   backs the guard). A `draw` ledger entry is written with it.

`releaseWebSearches` takes the reservation back in reverse: unused
searches return to the pack first, then to the plan's counter, so a
customer's paid searches are never spent while included ones were given
back. `research-job.ts` passes the reservation through; nothing else in
it changes. `getWebSearchAllowance` adds `packBalance`, and "can
research run" becomes plan left or pack left.

An ended trial still pauses research (as all AI), pack or no pack. The
stub mode and other-provider rules are unchanged: no search, no draw.

### 2.4 Buying: Checkout and the webhook

- `createSearchPackCheckoutAction({ packSlug })` in the billing actions:
  `requireAuth`, `requireCurrentOrg`, `requireOrgAdmin`; no
  `organizationId` parameter. `mode: "payment"`, card only (so payment
  is settled when the session completes), `client_reference_id` the
  organization, the tenant's Stripe customer or
  `customer_creation: "always"`, metadata `{ kind: "search_pack",
  organizationId, packSlug, searches }`. Audited
  `billing.search_pack.checkout_start`.
- The webhook's `checkout.session.completed` handler gets a branch for
  `metadata.kind === "search_pack"`, ahead of the subscription logic. It
  credits only when `payment_status === "paid"`, and takes the number of
  searches from the catalogue row, not from anything the browser sent.
  Crediting is one transaction: insert the `purchase` entry (unique on
  the Checkout session id, so a second delivery or a replay inserts
  nothing and credits nothing), then add to the balance. This stands on
  top of the existing `payment_event` duplicate check. Audited
  `billing.search_pack.credited`.
- Stripe sends the receipt. FORGE sends no email of its own.

### 2.5 Refunds and corrections

The owner refunds a pack in the Stripe dashboard. The webhook handles
`charge.refunded` for a pack payment: it removes the pack's searches
from the balance, down to zero at the lowest (searches already used are
not clawed back), and writes a `refund` entry. A platform admin can also
correct a balance by hand on the organization's admin page (`adjust`
entry, a required note, audited `admin.search_credit.adjust`).

### 2.6 Delivery

Two PRs, each under the diff cap, strictly one after the other:

1. **5b-2a** — migration 0173, the credit store and ledger, the
   two-step draw and release, the panel's pack line, the platform-admin
   correction. Tests: tenant isolation, racing draws cannot overspend,
   release order, balance equals ledger. No way to buy yet, so nothing
   changes for customers.
2. **5b-2b** — the catalogue on Billing, the Checkout action, the
   webhook branch, the refund handler, the manuals. Tests in
   `tests/stripe/`: credit once on a repeated delivery, unpaid session
   credits nothing, wrong tenant cannot be credited, refund floors at
   zero.

## 3. What this does not do

No overage, no automatic top-up, no card kept on file for searches, no
dunning. No bring-your-own-key (a possible later addition if tenants
ask). No transfer of credits between organizations.

## 4. Decisions for the owner

| # | Decision | Recommended | Why |
|---|---|---|---|
| 1 | Pack size and price | One pack: **500 searches for $25** | Anthropic charges $10 per 1,000 searches, so 500 cost $5, plus the tokens of about 100 research runs. $25 covers both with margin and is a round number. Editable later in the catalogue |
| 2 | Do pack searches expire? | **No expiry** | Simplest to explain and to build (one balance, no dated lots). The cost: unused credits stay on the books as a liability. If accounting wants an end date, 12 months from purchase can be added later |
| 3 | Does the tenant's own monthly cap limit pack searches too? | **No: the cap limits the plan's included searches only** | A pack is already paid for, so there is no runaway cost to brake. The panel will say so next to the cap |
| 4 | Refunds | **Automatic on a Stripe refund**, removing unused searches only, plus the manual correction | Keeps the balance honest without anyone remembering a second step. The alternative is manual only |
| 5 | Who can buy | **Org admins on plans that can auto-draft** (Gold, Platinum, custom with the feature) | Bronze and Silver cannot run Auto-draft, so a pack would buy them nothing |
| 6 | Where the pack price lives | **In FORGE's catalogue table, sent inline to Checkout** | No Stripe dashboard setup per pack, and one place to change a price. The alternative is a Stripe price id per pack, as plans use |

## 5. Risks

- **Double credit.** Guarded twice: `payment_event` drops a repeated
  event, and the ledger's unique session id drops a repeated credit.
- **Credit to the wrong tenant.** The tenant comes from the session
  FORGE created (`client_reference_id` and the customer), never from a
  form field; a session whose customer matches two tenants is left
  uncredited and logged, as the webhook does today.
- **Overspend under load.** The pack draw is one guarded statement and
  the column cannot go negative.
- **A paid pack with the webhook down.** Stripe retries for three days;
  the success page says the searches appear within a minute, and the
  admin correction covers a lost event.

# Frequently asked questions

Quick answers to questions that come up over and over. For deep walkthroughs,
see the [User guide](./USER_MANUAL.md) or [Admin guide](./ADMIN_MANUAL.md).

---

## Getting started

### How do I create my first opportunity?

Three options:

1. **Import from SAM.gov** — paste a SAM.gov notice URL or pick from the synced
   feed under `Opportunities → Import`.
2. **Paste a GSA eBuy RFQ** — under `Opportunities → Import → eBuy paste`. The
   AI extracts title, RFQ number, due date, NAICS, set-aside, and scope.
3. **Manual entry** — `Opportunities → + New`. Use this for anything that
   doesn't come from SAM.gov or eBuy (state contracts, IDIQ task orders, etc.).

### What's the difference between an opportunity and a proposal?

- An **opportunity** is a pursuit. It tracks the customer, the solicitation,
  set-aside, NAICS, value, due date, your PWin, and your competitive
  positioning. It moves through stages: identified → sources_sought →
  qualification → capture → pre_proposal → writing → submitted.
- A **proposal** is what you actually submit. It owns sections (Executive
  Summary, Technical, Management, etc.), color-team reviews, and the
  compliance matrix. Each opportunity can have one proposal at a time.

You don't need a proposal in Identified or Qualification — those stages are
about **deciding** to bid. Once you go to Capture or Pre-proposal, create a
proposal under `Opportunities → [opp] → Create proposal`.

---

## Proposals & sections

### How do color-team reviews work in FORGE?

The default proposal stages mirror the federal proposal industry's
color-team progression:

| Stage | What it means |
|---|---|
| Draft | Initial authoring, themes still emerging |
| Pink team | First review — strategy, themes, outline (~30% complete) |
| Red team | Independent evaluator review against Section M (~80%) |
| Gold team | Executive sign-off, near-final draft |
| White gloves | Final polish, formatting, accessibility, page count |
| Submitted | Sent to the agency |

You move stages from the proposal detail page. Stage moves are recorded as
activity entries.

### Why is my section status "in progress" after I auto-drafted it?

Auto-draft is a starting point, not a finished section. We default new AI
drafts to `in_progress` so reviewers don't accidentally treat them as
ready-for-review. Edit the section, mark complete when you're satisfied, and
the dashboard updates.

### Can I send a section to a teammate for review?

Yes — open a proposal, go to `Reviews`, and assign sections + reviewers. They
get an email and an in-app notification. Reviewers comment on what they see;
you decide what to merge.

For pre-bid opportunity reviews (Bid / No-bid / More info), use
`Opportunities → [opp] → Send for review`. That sends a magic-link email to
anyone — they don't need a FORGE account.

---

## Compliance matrix

### What does compliance pre-flight do?

For each compliance item attached to a section, FORGE asks the AI to read
your draft and judge whether the requirement is **complete**, **partial**,
**not addressed**, or **not applicable** — with a confidence rating, gap
description, and suggestion.

Pre-flight is rate-limited (10 runs per proposal per hour). Treat the output
as a first-pass triage, not a final compliance verdict.

### Why don't I see suggestions for some items?

Pre-flight only looks at items linked to a specific section. Items with no
section assigned aren't graded — there's nothing to grade them against. Map
items to sections first.

---

## Knowledge base & the brain

### What's the difference between Knowledge artifacts and Knowledge entries?

- **Artifacts** are uploads — old proposals, RFP responses, debriefs,
  capability briefs, etc. They live in cloud storage and get indexed for
  semantic search via embeddings.
- **Entries** are curated, atomic facts — past performance citations,
  capability descriptions, key personnel bios, boilerplate paragraphs. The
  brain extraction flow proposes entries from artifacts; you approve what's
  worth keeping.

Search hits both. Auto-draft pulls from both. Brain Suggest in the section
editor pulls from both.

### My semantic search returns "stub mode" — why?

The OpenAI API key isn't configured. Set `OPENAI_API_KEY` on Vercel and
re-deploy. Until then, results are keyword-based and not actually semantic.
Stub mode is a graceful fallback — features keep working, just not as well.

---

## Billing & access

### What's the difference between a member, an admin, and a superadmin?

- **Member** — default role. Can create / edit anything inside their
  organization.
- **Admin** — same as member plus access to org-level settings (users,
  templates, integrations).
- **Superadmin** — platform operator. Sees the `Platform admin` page,
  spans all orgs, can suspend tenants. There are very few of these.

Roles live on `memberships`, not `users` — a single user can be a member
of one org and an admin of another.

### How do I invite a teammate?

`Users → Invite` (admin only). They receive an email with a one-time
sign-up link. Invites expire in 7 days; resend from the same page if needed.

If the invite never arrives, check that `RESEND_API_KEY` is set on Vercel.
Without it, FORGE silently degrades to log-only mode (the email body shows
up in Vercel logs instead of being delivered).

---

## Troubleshooting

### Why does the AI keep returning "stub mode"?

A required provider env var is missing on Vercel. The most common ones:

| Var | Powers |
|---|---|
| `ANTHROPIC_API_KEY` | Section drafting, brief generation, vision OCR |
| `OPENAI_API_KEY` | Embeddings — semantic search, brain suggest |
| `BROWSERLESS_API_KEY` | Real PDF rendering (else HTML download) |
| `CLOUDCONVERT_API_KEY` | DOCX → PDF conversion |
| `RESEND_API_KEY` | Outbound email (review requests, invites, notifications) |

Check the integration status under `Settings → Integrations`.

### The page errors with "relation does not exist"

A migration hasn't run on the deployed database. Run
`node scripts/apply-schema.mjs` from a terminal that has `DATABASE_URL`
set to the production Neon URL. The script is idempotent — safe to re-run.

### My PDF download is just an HTML file

You're in `BROWSERLESS_API_KEY=stub` mode. Live PDFs require Browserless
(or any equivalent headless-Chrome service). Set the key, redeploy, and
new exports will be real PDFs. Existing HTML downloads remain available
under `Recent renders`.

---

## Privacy & data

### Where does my proposal text go?

Two places:
1. **Your Postgres database (Neon).** Sections, compliance items, activity,
   notifications — everything you see in FORGE.
2. **AI providers, when you trigger an AI feature.** Anthropic for drafting
   and extraction; OpenAI for embeddings. Both use FORGE-side API keys; we
   don't share keys across tenants.

Sensitive content (CUI, ITAR, classified) should not be pasted into FORGE
unless your AI provider contracts cover that data classification.

### Are my opportunities visible to other tenants?

No. Every multi-tenant query in FORGE filters by `organization_id`, and
the schema enforces that membership rows control access. The audit pass
in March closed the last cross-tenant UPDATE/DELETE leaks (PR-1).

If you spot anything that looks like cross-org data leakage, report it
immediately — that's a P0.

---

## Still stuck?

- Open the **User guide** (top of this page) — most workflows have a
  step-by-step there
- For platform-level questions, see the **Admin guide** tab
- File an issue on [GitHub](https://github.com/SYSUSA-INC/FORGE/issues)

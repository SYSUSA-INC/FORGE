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

### Can I try FORGE before buying?

Yes. Open **Request a trial** (on the sign-up page, or `/request-trial`)
with your company email. A FORGE admin approves the request and you get an
invitation to your own workspace with a 14-day trial. When the trial ends
nothing is lost and editing carries on — only the AI features pause until
your admin picks a plan under `Settings → Billing`. Personal mailboxes
(Gmail, Outlook…) can't request a trial; if your company is already on
FORGE, ask its admin for an invitation instead.

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

### How do I know if a teammate is editing the same section?

Open the section: if anyone else has it open, its header shows their
initials and "Ana is here" (or "Ana and Ben are here"). It updates every
30 seconds and clears about a minute after they close it.

### Why do two authors' sections read so differently?

Open the proposal's **Voices** tab: it measures how each author writes on
this proposal and, under **Compare two authors**, lists the differences an
evaluator would notice (sentence length, passive voice, "we" vs "you"…).
Settle them with a line in `Settings → House style` — or in **House style
by volume** for one volume only — and the drafter and chat follow it for
everyone.

### Can one review round remind reviewers on a different schedule?

Yes. On the round's page, the **Reminders** panel shows when the next
reminder goes out and to whom; tick **Give this round its own cadence** to
set, say, a week's notice for a big red team. Untick it to follow the
team default from `Settings → Review reminders` again.

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

### What are add-ons and how are they billed?

Add-ons sit on top of any plan: AI token top-ups, extra seats, extra
storage, or a feature your plan doesn't include. Buy them under
`Settings → Billing → Add-ons`. If you already pay for a plan by card they
go on the same invoice, prorated for the rest of the period; changing how
many you hold or removing one is prorated too. The public pricing page
lists them.

### Why can't I create or edit proposal templates?

Building and editing templates is part of some plans (the
`customTemplates` feature). Without it, the templates you already have
still appear when you start a proposal, and admins can still set the
default or archive one — only creating and editing pause. An admin can
add it under `Settings → Billing`.

### Where are the Reports, and why does it say "not in your plan"?

`Platform Intelligence → Reports` (`/reports`) needs the
`advancedReporting` feature — included in Gold, Platinum and Custom, or
as an add-on. It shows win rates, the stage funnel and monthly trends,
each downloadable as CSV.

### How do I connect FORGE to our CRM or BI tool?

An org admin creates a read-only API token under `Settings → API access`
(part of some plans) and gives it to the other system, which calls
`/api/v1/…` with `Authorization: Bearer forge_…`. The token is shown once;
revoke it there when you no longer need it. See USER_MANUAL §4.15 for the
endpoints.

### Can I export our customer contacts?

Yes — **Download CSV** at the top of `Customer contacts` saves the
contacts shown below (after any search or filter), with warmth and
follow-up state. Each download is recorded in the audit log.

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

### Which model answers which AI feature?

Each AI feature belongs to a model class, and the gateway requests the
class model unless the call pins one (BL-AI-ROUTING). The live table,
per class and per feature, is on `/admin/usage` under "Model routing".

| Var | Default | Class |
|---|---|---|
| `ANTHROPIC_MODEL_FAST` | `claude-haiku-4-5-20251001` | fast — classification, image OCR, eBuy and GSA extraction |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | standard — solicitation extraction and review, compliance, chat, briefs |
| `ANTHROPIC_MODEL_STRONG` | same as `ANTHROPIC_MODEL` | strong — section drafts, health scan, winner analysis, protest viability |
| `VLLM_MODEL_FAST` / `VLLM_MODEL` / `VLLM_MODEL_STRONG` | `VLLM_MODEL` | same three classes for a vLLM deployment |
| `VLLM_SUPPORTS_TOOLS` | unset | set to `1` when the served model supports OpenAI-style tool calls (BL-AI-TOOLS) |
| `AI_MODEL_ROUTING` | `on` | set to `off` to send every feature to the provider default |
| `AI_FALLBACK_PROVIDER` | unset | a second configured provider (`anthropic`, `azure`, `vllm`) that takes a call once when the active one is down (BL-AIX Phase 1f) |
| `AZURE_OPENAI_MAX_OUTPUT_TOKENS` / `VLLM_MAX_OUTPUT_TOKENS` | 16k (32k for gpt-4.1 / gpt-5 / o-series) / 8k | the deployment's output ceiling; longer requests are clamped to it |
| `AI_BATCH_NIGHTLY` | on | set to `off` to triage the nightly scout live instead of as a half-price Message Batch (BL-AIX Phase 1g-2) |
| any `ANTHROPIC_MODEL*` value | — | current Claude models (e.g. `claude-sonnet-5-5`, `claude-opus-5-5`) work as-is: the gateway drops forced tool calls and temperature where a model rejects them and makes room for thinking (BL-AIX Phase 1i-1); run the evals on the candidate first (pick it on the accuracy check or the golden eval, BL-AIX Phase 1i-2) |

Azure OpenAI is deployment-pinned and is not routed. A tenant can be
pinned to specific models with `customOverrides.aiModels` on its
subscription row, keyed by feature (`"section_draft"`) or by class
(`"strong"`). Every call records the model requested and the model that
answered in `ai_call_log`, so a change here is measurable per feature.

### The page errors with "relation does not exist"

A migration hasn't run on the deployed database. A platform admin opens
`Platform admin → Operations → Database migrations` (`/admin/migrations`)
and syncs the pending ones — or runs `node scripts/apply-schema.mjs` from a
terminal that has `DATABASE_URL` set to the production Neon URL. Both are
idempotent — safe to re-run. ADMIN_MANUAL §7.5 lists the recent
migrations and which feature each one backs.

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

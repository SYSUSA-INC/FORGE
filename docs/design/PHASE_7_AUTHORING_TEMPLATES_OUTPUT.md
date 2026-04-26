# Phase 7 — Authoring, Templates, and Output

**Status:** v1 MVP scope locked 2026-04-26.

## Decision (locked 2026-04-26)

After review of this doc, the user picked **"v1 MVP"** with **"yes to all recommendations"** on the decision points.

What we're building in Phase 7:

- **PR-7a** — TipTap rich-text section editor (replaces `<textarea>`).
- **PR-7b** — Org-scoped template library (cover / header / footer / branding tokens).
- **PR-7c** — HTML→PDF generation via Browserless. **Download** the PDF from the proposal detail page.

What we're explicitly **deferring** to a follow-on phase (see "Future plan — post-MVP" at the bottom of this doc):

- **PR-7d** — OAuth email-account connection (Gmail + Microsoft Graph).
- **PR-7e** — Outbound proposal send from the user's own email address.
- **PR-7f** — Polish (Word `.docx` import, template versioning, per-template default email bodies).

Locked decision-point recommendations (DP-1 through DP-5):

| # | Question | Decision |
|---|---|---|
| DP-1 | Editor | **TipTap** |
| DP-2 | PDF strategy | **Browserless (HTML → headless Chromium)** |
| DP-3 | Outbound email path | **OAuth-only** *(deferred to post-MVP)* |
| DP-4 | PDF storage | **Cloudflare R2** |
| DP-5 | Attach vs link in send | **Default attach + toggle** *(deferred to post-MVP)* |

**Effort to v1 MVP: ~13 working days** (PR-7a + PR-7b + PR-7c only).

---

## Original framing

This is the design for the chapter the user described as:

> Establish great looking templates or import their templates and develop the entire proposal within the platform — write, edit, review, etc. — then with a click of a button generate a PDF or send an email where the from-field is the sender's email address that they provide.

The full chapter (TipTap → templates → PDF → OAuth email accounts → outbound send) was estimated at 21 working days across 5 PRs. The v1 MVP cuts that to 13 days by deferring the OAuth send chapter — customers download the PDF and email it themselves until the post-MVP work lands.

---

## Goal

A FORGE customer should be able to:

1. Pick (or upload) a branded template — cover, header/footer, fonts, palette, section structure.
2. Author every section in-platform with rich text (formatting, lists, tables, references, mentions).
3. Run color-team reviews against that rich text (already shipped, just needs to consume the new format).
4. Click **Generate PDF** and get a fully branded, paginated PDF.
5. Click **Send to customer**, pick a connected email account (their own Gmail or Microsoft 365), and the email goes out from their address with the PDF attached and the message body pre-filled from a template.

Today FORGE has the structural pieces — proposals, sections, reviews, compliance, opportunities — but the section body is a plain `textarea`, there is no template concept, no PDF, no outbound email infrastructure beyond Resend's transactional sends from `noreply@sysgov.com`.

---

## Architecture decisions (the trade-offs)

### Authoring: TipTap (recommended)

Replace the per-section `<textarea>` with a **TipTap** editor (ProseMirror under the hood).

**Why TipTap:**
- Schema-aware — section bodies become structured JSON, not loose markup. Critical for the intelligence work too (clean labeling per heading / paragraph / list item).
- First-class extensions for tables, images, mentions, comments, suggestions, collaborative cursors.
- React-native; integrates with our server-action data flow.
- MIT-licensed; no per-seat fees.

**Why not alternatives:**
- *Slate* — flexible but lower-level; we'd write the toolbar / table / mentions ourselves.
- *Lexical (Meta)* — newer, smaller plugin ecosystem, weaker collaboration story today.
- *Quill* — simpler but its data model is delta-based, awkward for our use case.
- *Plain Markdown editor* — ships fast but customers expect Word-grade tables and images on the page.

**DP-1:** Confirm TipTap as the editor. *Recommendation: yes.*

### PDF generation: HTML → PDF via Browserless (recommended)

Two real paths:

**Path A — HTML to PDF via headless Chromium (Browserless or Puppeteer).** We render the proposal as HTML using the same template styles the editor preview uses, hand it to a headless browser, capture the PDF.

- Pro: 1:1 fidelity with the editor preview. Templates can be authored in CSS / HTML which any designer can produce.
- Pro: Page numbers, headers/footers, table-of-contents — all standard CSS print primitives.
- Con: Vercel hobby tier doesn't run headless Chromium. Two options:
  - **Browserless.io** — managed Puppeteer, ~$50/mo for the starter tier, scales fine for our volume.
  - **Self-hosted worker** — a Vercel separate service or a Fly.io box running Puppeteer; cheaper at scale but ops drag.

**Path B — `@react-pdf/renderer`.** Render PDFs directly from React components using a custom layout engine.

- Pro: Pure-Node, runs anywhere including hobby Vercel.
- Pro: No external service.
- Con: Custom React-flavored layout primitives (no real CSS). Templates have to be built in TypeScript code, not designer-friendly.
- Con: Tables, footnotes, complex pagination — all DIY.

**DP-2:** PDF strategy. *Recommendation: Path A with Browserless.* Templates become real HTML/CSS that a designer can author; we get rich pagination for free; PDF fidelity matches what the editor shows.

### Outbound email from sender's address: OAuth into the user's mailbox (recommended)

The constraint "from-field is the sender's email" is strict. You **cannot** spoof a sender through Resend without their domain being verified there — and even then, Resend is technically the sending system. SPF/DKIM/DMARC will at best mark it "via sysgov.com"; at worst, junk it.

Real options:

**Option 1 — OAuth into the user's mailbox.**
- Gmail: `https://mail.google.com/` scope via Google OAuth → call `gmail.users.messages.send`.
- Microsoft 365: `Mail.Send` scope via Microsoft Graph → POST `/me/sendMail`.
- Pro: From-address really is the user. SPF/DKIM/DMARC pass naturally because the customer's IT already configured them for their tenant.
- Pro: Reuses the Google + Microsoft OAuth we already have wired for sign-in (#24); we'd add the additional scopes.
- Con: Each user has to grant the consent. Tokens need refresh handling. We'd persist them in a new `email_account` table per user.

**Option 2 — Per-org SMTP relay.**
- Customer enters their company SMTP host + credentials in Settings; we relay through it.
- Pro: Works for non-Google/Microsoft customers (older Exchange, on-prem, etc.).
- Pro: No per-user consent.
- Con: Storing customer SMTP passwords is a non-trivial security burden (encryption-at-rest with rotated KEK; audit trail on access). And it's a 1990s UX.

**Option 3 — Per-domain SES with verified sending domains.**
- We give the customer DNS records to add (SPF/DKIM CNAMEs); they verify the domain in our SES account; we send via SES with their from-address.
- Pro: Industrial-strength deliverability.
- Con: DNS friction on the customer side. Operationally heavy on us.
- Con: We're still the sender of record; replies go to the customer's address but bounces and reputation tracking are ours.

**DP-3:** Outbound email path. *Recommendation: Option 1 (OAuth Gmail + Microsoft) as primary, with Option 2 as the explicit enterprise escape hatch in a later PR. Skip Option 3.*

---

## Schema additions

All migrations follow our `node scripts/apply-schema.mjs` workflow.

```sql
-- One row per template. Org-scoped.
CREATE TABLE proposal_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- Template content:
  cover_html text NOT NULL DEFAULT '',
  header_html text NOT NULL DEFAULT '',
  footer_html text NOT NULL DEFAULT '',
  page_css text NOT NULL DEFAULT '',
  -- Section seed list (ordering + kind):
  section_seed jsonb NOT NULL DEFAULT '[]',
  -- Branding tokens:
  brand_primary text NOT NULL DEFAULT '#2DD4BF',
  brand_accent text NOT NULL DEFAULT '#EC4899',
  font_display text NOT NULL DEFAULT 'Inter',
  font_body text NOT NULL DEFAULT 'Inter',
  logo_url text NOT NULL DEFAULT '',
  -- Lifecycle:
  is_default boolean NOT NULL DEFAULT false,
  archived_at timestamp,
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- TipTap doc per section. Replaces the current `body text` column.
ALTER TABLE proposal_section
  ADD COLUMN body_doc jsonb NOT NULL DEFAULT '{"type":"doc","content":[]}',
  ADD COLUMN word_count integer NOT NULL DEFAULT 0;
-- We KEEP `body text` as a denormalized plain-text projection
-- so existing search + AI prompts don't break; populated from body_doc on save.

-- Each proposal can pin a template (defaults to org's is_default):
ALTER TABLE proposal
  ADD COLUMN template_id uuid REFERENCES proposal_template(id) ON DELETE SET NULL;

-- PDF generation log. Each export is a row.
CREATE TABLE proposal_pdf_render (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES proposal(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  rendered_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  template_id uuid REFERENCES proposal_template(id) ON DELETE SET NULL,
  storage_path text NOT NULL,        -- e.g. s3://forge-pdfs/<org>/<proposal>/<id>.pdf
  byte_size integer NOT NULL DEFAULT 0,
  page_count integer NOT NULL DEFAULT 0,
  rendered_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp                -- short-lived signed URL expiry
);

-- OAuth-connected email accounts (one per user per provider).
CREATE TYPE email_account_provider AS ENUM ('gmail', 'microsoft');
CREATE TABLE email_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  provider email_account_provider NOT NULL,
  email text NOT NULL,                -- the verified sending address
  display_name text NOT NULL DEFAULT '',
  access_token text NOT NULL,          -- encrypted at rest
  refresh_token text NOT NULL,         -- encrypted at rest
  token_expires_at timestamp NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  disconnected_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, email)
);

-- Outbound proposal sends. One row per send attempt.
CREATE TYPE proposal_send_status AS ENUM ('queued', 'sent', 'failed');
CREATE TABLE proposal_send (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES proposal(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  pdf_render_id uuid NOT NULL REFERENCES proposal_pdf_render(id) ON DELETE RESTRICT,
  email_account_id uuid REFERENCES email_account(id) ON DELETE SET NULL,
  sender_user_id text NOT NULL REFERENCES "user"(id) ON DELETE SET NULL,
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  bcc_addresses text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  body_text text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  status proposal_send_status NOT NULL DEFAULT 'queued',
  error text NOT NULL DEFAULT '',
  provider_message_id text NOT NULL DEFAULT '',
  sent_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
```

Audit story is the same shape as the rest of FORGE: every render and every send is a row with `created_by`, timestamps, and an error column for failures.

---

## PR plan — v1 MVP (committed)

### PR-7a — TipTap migration (no template, no PDF, no email)

Smallest beachhead. Replace the `<textarea>` with a TipTap editor. No new features visible besides formatting in the section body.

- Add `body_doc jsonb` + `word_count integer` to `proposal_section`. Backfill from existing `body text` (single SQL `UPDATE` that wraps each body in a TipTap `doc → paragraph` shape).
- Implement `<RichSectionEditor>` with: bold/italic/underline, H1–H3, bulleted + numbered lists, blockquote, code, links, basic table, image (URL only — no uploader yet).
- Save round-trip: editor → server action → `body_doc = JSON.stringify(json)`, `body = projectToPlain(json)`, `word_count = countWords(json)`.
- Reviews + comments continue to anchor on `proposal_section.id` exactly as today.
- AI prompts continue to use the projected `body` text.

**Effort:** 1 PR, ~3 days. Independent of other PRs.

### PR-7b — Template library (org-scoped)

Add the `proposal_template` table + `/settings/templates` page.

- CRUD for templates: name, description, branding tokens, cover/header/footer HTML, page CSS, section seed list.
- Template gallery with 2–3 starter templates we ship in seed data (Civilian basic, DoD basic, Color-team blank).
- "Set as default" — exactly one per org.
- Proposal create flow (`/proposals/new`) gets a Template picker; default to the org default.
- `proposal.template_id` column.

**Effort:** 1 PR, ~5 days. Depends on PR-7a (uses the rich body shape).

### PR-7c — PDF generation (Browserless) — download only in v1

- Add `proposal_pdf_render` table.
- `src/lib/pdf.ts` — provider abstraction matching `src/lib/ai.ts`'s pattern. Default to a `BrowserlessProvider`; stub to a `BasicHtmlProvider` (writes HTML, no PDF) when `BROWSERLESS_API_KEY` is missing.
- Template renderer: takes proposal + template → produces a single HTML doc that uses `@page`, `running()`, page numbers, and bookmarks for the TOC.
- New action `renderProposalPdfAction(proposalId)` → POSTs to Browserless's `/pdf` endpoint, persists the result blob to **Cloudflare R2** (DP-4 locked), writes a row, returns a short-lived signed URL.
- "Generate PDF" button on the proposal detail page (Overview tab). History of past renders surfaced in a side panel — the audit trail makes "what we exported when" recoverable forever.
- Customers download the resulting PDF and email it through their normal mail client. The OAuth-based "send from your address" path lands in PR-7d/7e (post-MVP).

**Effort:** 1 PR, ~5 days. Depends on PR-7b. Needs `BROWSERLESS_API_KEY` + Cloudflare R2 credentials configured.

---

## Future plan — post-MVP (deferred 2026-04-26)

These are scoped, designed, and ready to pick up the moment the v1 MVP ships. Not committed to a date yet — the customer signal from the v1 MVP shapes whether 7d/7e move first or 7f does.

### PR-7d — Email account connection (Gmail + Microsoft Graph)

The send-from-user's-address foundation, no actual sends yet.

- Reuse the existing Google + Microsoft NextAuth OAuth setup. Add `https://mail.google.com/` and `Mail.Send` scopes as **opt-in** scopes (not required for sign-in).
- New page `/settings/email-accounts`: "Connect Gmail" / "Connect Microsoft". On consent, capture refresh token, persist encrypted (AES-GCM with key from env).
- Per-account "Send a test message to yourself" button to confirm the connection works.
- `email_account` table.
- Token refresh helper that runs lazily on each send.

**Effort:** 1 PR, ~5 days. Independent of PR-7c. Requires app registration updates on Google + Microsoft consoles + a new `EMAIL_ACCOUNT_TOKEN_KEK` env var.

### PR-7e — Outbound proposal send

- "Send to customer" modal on proposal detail. Pick connected email account → pick PDF render (default to latest) → fill To/CC/BCC + subject + body. Body is pre-filled from a configurable per-template default.
- Default behavior **attach the PDF** with a toggle to switch to link-only (DP-5 locked).
- Send via the chosen provider (Gmail API or Microsoft Graph). Persist a `proposal_send` row with `status='sent'` + provider message id, or `'failed'` + error.
- Activity timeline on the proposal gets an entry: "Sent to `<recipients>` from `<sender's email>`".
- Notification fired to the proposal manager when send completes (composes with the existing notification infra from PR #35 / #36).

**Effort:** 1 PR, ~3 days. Depends on PR-7c + PR-7d.

### PR-7f — Polish + import existing Word templates

- `mammoth` extraction for `.docx` upload → produce a starter HTML cover/header/footer the user can refine.
- Template versioning (snapshot template content into the proposal at create time so later template edits don't break old proposals).
- Per-template default email body templates (variables: `{recipient_first_name}`, `{proposal_title}`, `{due_date}`).
- Reply tracking via Gmail/Graph webhooks (out of scope, but worth knowing).

**Effort:** 1 PR, ~5 days. Pure polish; sequencing flexible.

### Open questions for the post-MVP block

These don't block the v1 MVP but should be answered before PR-7d starts:

- Do we want an enterprise SMTP-relay escape hatch alongside OAuth? (DP-3 was locked OAuth-only; revisit if a customer needs Exchange-on-prem.)
- What's our policy for PDF retention in R2? Auto-purge old renders after N days, or keep forever as part of the audit trail?
- Reply tracking — do we surface customer responses in FORGE, or stay outbound-only?

---

## What we're NOT building in Phase 7

Calling these out so they don't get smuggled into scope:

- **Multi-user real-time collaborative editing** (Y.js / TipTap Hocuspocus). Single-author editing is fine for v1; per-section locking via `updatedAt` collision detection is enough.
- **Reply threading.** Outbound only — replies go to the customer's mailbox, not back into FORGE.
- **Inbound email parsing** ("forward this RFP to FORGE and we'll create the opportunity") — separate phase.
- **Word .docx output.** PDF only. We can revisit when a customer specifically asks.
- **Per-org custom CSS sandboxing.** First wave of templates ships from us; customer-authored templates require trust-and-honor for now (scoped to their own org's data; no cross-org rendering).

---

## Required env vars

### v1 MVP

| PR | New env vars |
|---|---|
| 7a | none |
| 7b | none |
| 7c | `BROWSERLESS_API_KEY`, `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL_BASE` |

### Post-MVP

| PR | New env vars |
|---|---|
| 7d | `EMAIL_ACCOUNT_TOKEN_KEK` (32-byte base64, for AES-GCM token encryption) — and updated OAuth consent screens on Google + Microsoft |
| 7e | none new |
| 7f | none new |

---

## Why this ordering

**PR-7a first** because it unblocks every later piece (rich body becomes the source of truth for templates, PDF, and intelligence).

**PR-7b before PR-7c** because PDF generation is meaningless without a template to render against — but you'd want the template work in production for at least a week before turning on PDFs to surface CSS bugs.

**PR-7c is the v1 MVP finish line.** Customers can write rich text, pick a template, and download a branded PDF. They distribute it through their existing email tooling. That's the whole product loop on the v1 MVP.

**PR-7d/7e (post-MVP)** layer OAuth-based send onto the working PDF chain. Each is independently demo-able once 7c is in production.

**PR-7e last in its sub-chapter** because it composes 7c (the PDF) and 7d (the email account) into a single "deliver this" button — adding it on top of two already-deployed pieces is much safer than landing all three in one PR.

---

## Estimated effort

### v1 MVP — committed

- PR-7a TipTap: 3 days
- PR-7b Template library: 5 days
- PR-7c PDF generation + R2 storage: 5 days

**Total v1 MVP: ~13 working days (~2.5 weeks)**, plus product-side time on template designs and brand assets.

### Post-MVP — deferred

- PR-7d Email account connection: 5 days
- PR-7e Outbound send: 3 days
- PR-7f Polish (Word import, template versioning, email body variables): 5 days

**Post-MVP additional: ~13 working days** (~2.5 weeks).

**Combined Phase 7 if everything lands: ~26 working days (~5–6 weeks).**

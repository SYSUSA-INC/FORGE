# Phase 6 — Deliver: design for review

**Status:** approved by the owner (2026-11-17, "all recommended") with
every recommended answer in §4. 6a is built (migration 0177); 6b to 6d
follow, one PR each.
**Requirements:** FORGE II footnote 9, S-1 to S-6 in
`docs/FORGE_II_REQUIREMENTS.md`. **Plan:** BL-NAV-LIFECYCLE phase 6.
**Shape:** the same as `BL-NAV-LIFECYCLE_PHASE5_DEVELOP.md`.
**Already decided (2026-11-06):** replies are received in FORGE's
Exchange mailbox and read through Microsoft Graph, as the bid inbox
does; no separate inbound mail service.

## 1. What FORGE already has

| Piece | Where today | What it gives Deliver |
|---|---|---|
| The stage | Opportunity stage `submitted` ("Delivered", `src/lib/opportunity-types.ts`); proposal stages `white_gloves` and `submitted` map to Deliver (`lifecycleForProposal`, `src/lib/lifecycle.ts`); Pipeline → Deliver (`PipelineStagePage`, `src/app/(app)/pipeline/StagePage.tsx`) lists opportunities at `submitted` with the generic list | The page and the stage names. The page shows nothing about a submission, and nothing lists the proposals that are *ready* to deliver |
| Marking submitted | `advanceProposalStageAction` (`proposals/actions.ts`, `StageAdvancePanel`): sets the stage and `proposal.submittedAt`, audits `proposal.advance_stage`, raises `proposal_advanced`, and on first entry runs the `proposal_harvest` job | A click that says "submitted". It checks no review, records no file, recipient or method, locks nothing, and does not move the opportunity (that is a second click, `setStageWithLogAction`) |
| The final file | `renderProposalPdfAction`, `renderProposalDocxAction`, `renderProposalDocxAsPdfAction` (`proposals/[id]/pdf/actions.ts`, `ExportPanel`; `src/lib/pdf.ts`, `docx-render.ts`, `docx-to-pdf.ts`). Each render is **kept**: a `proposal_pdf_render` row and the file at `org/{org}/proposal/{id}/render/{renderId}`, downloaded through `/api/proposals/[id]/pdf/[renderId]`. `enforceExportGate` (`compliance-gate.ts`) blocks on open compliance rows and `[NEEDS CITATION]`, with an audited override | S-2's PDF, already stored and addressable by id. One file per proposal: no volumes, no package, no record of *which* render was sent |
| Reviews | `proposal_review` (pink, red, gold, white_gloves, green) with `status` and `verdict` (pass, conditional, fail); `proposal_review_assignment` with each reviewer's own `verdict` and `submittedAt`; the White Gloves checklist has `submission_pack` (`review-workflow-logic.ts`) | The data S-1 needs. **No gate reads it**: only a next-action hint looks at `goldPassed` (`next-actions.ts`) |
| Submission instructions | `solicitation.lmStructure.sectionL.submission` (deadline, method, copies as quoted rules), `volumes`, `formatRules` (`solicitation-lm-extract.ts`); `opportunity.responseDueDate` (a day, no time or zone); contracting officers as `customer_contact` rows by agency, not tied to an opportunity | What the RFP says about how to submit, to show beside the Send form. No recipient address or due time is stored on the opportunity |
| Sending email | Resend through `sendEmail` (`src/lib/email.ts`): `from`, `replyTo`, `attachments` (used by the review-meeting `.ics`); sender from `emailFrom()` (`site-domain.ts`); stub mode with no key. **No outbox**: nothing records a sent message except `notification.emailSentAt` | The transport for S-3, attachments included. No proof of what was sent |
| The Exchange mailbox | `src/lib/inbound-graph.ts` (`graphToken`, `pollInboundMailbox`: unread messages, attachments to 20 MB each and 10 per message, marked read only once filed), `inbound-email.ts` (`receiveInboundMessage`), `inbound-email-logic.ts` (`graphConfig`, `recipientsOf`, `companyLocalPart`); cron `/api/cron/inbound-mail` every 2 minutes; permission `Mail.ReadWrite` on the one mailbox (Admin Manual §3.7). **Read only: no `sendMail`** | S-4's reader, running. It routes by **company** (`inbound_address`: `{name}-{4 chars}@INBOUND_EMAIL_DOMAIN`), never by opportunity |
| Inbound storage | `inbound_email` (deduped on the Internet Message-ID; SPF, DKIM, `authenticated`; kind `unknown / bid_alert / account / other`; status), the message at `org/{org}/inbound/{id}.json` and its attachments beside it; job `inbound_email_parse` turns bid alerts into Scout finds (`inbound-bids.ts`) | The store and the parse-job pattern. `inbound_email` has no `opportunityId` |
| History on the opportunity | `opportunity_activity` (note, meeting, action, stage_change, gate_decision, ...) with `metadata`; documents as `solicitation` rows (`fileInboundAttachments` files a bid email's attachments that way) | Where "filed on the opportunity" lands. No correspondence kind |
| Notifications | `dispatchTriggerEvent` (`notification-dispatcher.ts`), `notification_rule`, `notification_delivery` | The way to tell the team. No submission or reply event |
| An older sketch | `docs/design/PHASE_7_AUTHORING_TEMPLATES_OUTPUT.md` PR-7d/7e: "Send to customer" through each user's own Gmail or Microsoft account (`email_account`, `proposal_send`); never built | Superseded by this design: the owner chose a platform address, not the user's own mailbox |

**What's missing:** a sign-off gate before submission; a submission
*record* (what was sent, to whom, by whom, when, which files); sending
from the portal; a reply address for each opportunity; routing a reply
to its opportunity, reading it and filing it; a Deliver page that shows
any of this.

## 2. The design

### 2.1 The Deliver tab and the sign-off gate (S-1)

A **Deliver** tab on the opportunity, beside Develop. It has three
parts: **Sign-off**, **Submit**, **Correspondence**.

**Sign-off** is one row per colour (Pink, Red, Green, Gold, White
Gloves) for the opportunity's proposal: the newest round of that
colour, its status and verdict, and each assigned reviewer's own
verdict. A colour is **signed off** when its newest round is
`complete` with verdict `pass`, and every assigned reviewer has
submitted a verdict that is not `fail`. A `conditional` round is not
signed off until its conditions are closed and the round is re-closed
as `pass`. The rule is pure (`src/lib/deliver-logic.ts`, unit tested)
and reads only what exists; no new sign-off table.

The gate **blocks** Submit (both options below) until all five colours
are signed off, the White Gloves `submission_pack` item is ticked and
the export gate is clean. As with the export gate, an org admin or the
proposal manager may **override with a written reason**; the override
and the state of every colour at that moment are stored on the
submission and audited (`proposal.submission.gate_override`). A colour
the team never runs (Green on a bid with no price volume) is handled by
decision 2.

### 2.2 The submission record

A new table `proposal_submission` (migration 0177), one row per
submission (a resubmission after an amendment is a second row):
organization, opportunity, proposal, `method` (`portal_email`,
`own_email`, `government_portal`, `other`), `status` (`draft`,
`sending`, `sent`, `failed`, `recorded`), recipients (to, cc), subject
and body, the from and reply addresses, the Message-ID, `sentAt`,
`sentByUserId`, the sign-off state and any override reason, and the
**files**: for each, the render id, file name, size and SHA-256, copied
to `org/{org}/submission/{id}/` so the bytes that left are kept even if
a render is later deleted.

Recording a submission, by either option, is the **one** act that marks
delivery: it sets the proposal to `submitted` with `submittedAt`, moves
the opportunity to `submitted` through `applyOpportunityStage`, writes
an `opportunity_activity` entry (new kind `submission`), audits
`proposal.submission.sent` / `.recorded`, raises a new notification
event `proposal_submitted`, and starts `proposal_harvest` as today.
`advanceProposalStageAction` no longer offers `submitted`; the panel
points to the Deliver tab. Sections stay editable after submission
(FORGE has no lock today, and an amendment needs them); the stored
files are the record.

### 2.3 Option 1: the PDF, submitted by the lead (S-2)

**Submit → I will send it myself.** The lead picks the render (or
renders a fresh one; the export gate applies), downloads it, sends it
from their own mail or uploads it to the agency's site, then **Record
submission**: when, to whom, how (their own email, a government portal,
other), and an optional receipt upload. This is also the answer for S-5
until portal integrations are explored: the submission is made outside,
and recorded here.

### 2.4 Option 2: submit by email from the portal (S-3)

**Submit → Send from FORGE.** A form with: To and Cc (typed; suggested
from the agency's `customer_contact` rows with role
`contracting_officer`), subject (pre-filled with the solicitation
number and the company's name), a plain message body, the files (one or
more kept renders, each with an editable file name; other files such as
a signed form are uploaded with `uploadFile()` and attached by upload
id, convention 11), and a Cc to the sender, on by default. Beside the
form: the RFP's own submission rules from Section L, quoted, and the due
date.

**Send** is a confirm step that names the recipients and the files, then
a durable job (`submission_send`): it copies the files, sends once,
stores the Message-ID and marks the row `sent`; a failure marks it
`failed` with the provider's reason and the lead retries by hand. The
job never sends twice for one row (the provider call carries the row id
as an idempotency key).

**The addresses.** Each opportunity gets one address on the existing
inbound domain, made the first time it is needed and kept for the
opportunity's life: `sub-{10 random characters}@INBOUND_EMAIL_DOMAIN`
(a unique nullable column `opportunity.delivery_local_part`). The
existing Exchange rule already redirects the whole subdomain into the
shared mailbox, so no mailbox work is needed per opportunity. The
message goes out as:

- **From:** `{Company name} via FORGE <sub-…@bids.forgeaxi.com>`
- **Reply-To:** the same address
- **Cc:** the sender's own address (so the team holds a copy and the
  officer sees a person)

Using the opportunity's address as From, and not only as Reply-To,
brings back what Reply-To alone loses: out-of-office notices, delivery
failures and read receipts, all of which go to the sender address.

**Transport.** Resend, through `sendEmail` as it stands (attachments and
`replyTo` already work), with the inbound subdomain verified in Resend
as a sending domain (SPF and DKIM records on the subdomain; its MX stays
with Exchange). The alternative is Graph `sendMail` from the shared
mailbox: one system and a copy in Sent Items, but it needs the
`Mail.Send` permission, it can only send as the mailbox's own address
(the per-opportunity address would be Reply-To only), and attachments
over 3 MB need an upload session. Decision 3.

**Size.** Many agency mail gateways refuse messages over 10 to 25 MB.
The form shows the total and warns above 20 MB; above 35 MB (under
Resend's 40 MB ceiling) Send is refused and the lead is pointed to
Option 1. FORGE does not replace attachments with download links: a
contracting officer may be barred from following one, and a link is not
a submission.

### 2.5 Replies come back and are filed (S-4)

**Routing.** `receiveInboundMessage` gains a second lookup before the
company lookup: a recipient whose local part starts `sub-` is matched to
`opportunity.delivery_local_part`, which gives the tenant and the
opportunity together. If the address is unknown the message falls
through to today's handling. A message to the *company's* bid address
whose `In-Reply-To` or `References` names a submission's Message-ID is
routed the same way. `inbound_email` gains `opportunity_id`,
`submission_id` and a kind `proposal_reply` (migration in 6c); dedupe,
storage and the unread-until-filed retry are unchanged.

**Reading.** A job `submission_reply_parse` (the `inbound_email_parse`
pattern; AI feature key `delivery_reply`, metered, with a no-AI
fallback) writes onto the row: a **type** (receipt acknowledged,
question or clarification, amendment, evaluation notice, award,
unsuccessful, automatic reply, delivery failure, other), a two-line
summary and any date it names. Delivery failures and automatic replies
are recognised from headers without the model. The message is treated
as untrusted text: the parse **suggests and never acts**. A reply typed
"award" shows *Record the outcome* on the opportunity; it does not
change the stage.

**Filing.** Each reply writes an `opportunity_activity` entry (new kind
`correspondence`) with the sender, subject, type and summary, audits
`opportunity.correspondence.received`, and raises a notification event
`submission_reply_received` to the proposal manager, the capture manager
and the sender. The Deliver tab's **Correspondence** list shows the
thread in order: each submission and each reply, the full text on open,
attachments downloadable, and **File as a document** on an attachment
(the bid inbox's `fileInboundAttachments`, so an amendment PDF is parsed
like any solicitation file). A reply that failed SPF and DKIM, or whose
sender is not among the submission's recipients, is filed with a
**check the sender** mark, not dropped.

**Answering.** **Reply** on a message opens the Send form in the same
thread (`In-Reply-To` set, same From address), stored as a
`proposal_submission` row of method `portal_email` with no gate when it
carries no proposal file. Decision 6.

### 2.6 Pipeline → Deliver

Two lists. **Ready to deliver:** opportunities in Develop whose proposal
is at Gold or White Gloves, each with its sign-off line (4 of 5 signed
off; White Gloves open), the due date and **Open Deliver**.
**Delivered:** opportunities at `submitted`, each with how and when it
was sent, to whom, and the newest reply's type and date, with unread
replies counted.

### 2.7 Security and the tenant line

- Every action opens with `requireAuth` and `requireCurrentOrg`; the
  submission, its files and its replies are read through the opportunity
  with `organizationId`. Who may send: org admins, the proposal manager
  and the capture manager (decision 7).
- The reply address is a secret-length random string, unique across
  tenants; the lookup returns its own tenant and nothing else. An
  address is never reused.
- The only cross-tenant read is the address lookup inside the cron, as
  the bid inbox's lookup of a company's address is today; if the
  isolation check needs an exception for it, it is documented in
  `.isolation-allow.json` in 6b.
- Sent files are read with `storage.get` under the org prefix; uploaded
  extras are claimed by upload id.
- A read of a reply's body is a `recordRead`
  (`opportunity.correspondence.read`), as a PDF render is.
- No new secret: `RESEND_API_KEY` and the `MS_GRAPH_*` variables exist.

## 3. Delivery (one PR each, under 1,500 lines)

1. **6a — the Deliver tab, the sign-off gate, the submission record and
   Option 1** (§2.1 to §2.3): migration 0177 (`proposal_submission`,
   activity kind `submission`, event `proposal_submitted`),
   `deliver-logic.ts`, Record submission, the stage moves, the
   `StageAdvancePanel` change. Usable alone: S-1 and S-2.
2. **6b — send from the portal** (§2.4): migration 0178
   (`opportunity.delivery_local_part`), the Send form, the
   `submission_send` job, the size rules. S-3. Needs the owner's DNS
   step if decision 3 is Resend.
3. **6c — replies** (§2.5): migration 0179 (`inbound_email` columns and
   kind, activity kind `correspondence`, event
   `submission_reply_received`), routing, the parse job and its prompt
   (version registered in `ai-prompt-versions.ts`), the Correspondence
   list, File as a document. S-4.
4. **6d — Reply from the portal and Pipeline → Deliver** (§2.5
   Answering, §2.6). Split in two if it passes the budget.

Each PR updates the User Manual (Deliver) and, for 6b and 6c, the Admin
Manual §3.7 (the DNS records, the address form, the cron's second
route). S-5 stays recorded for later; S-6 is this document.

## 4. Decisions for the owner

1. **The sign-off gate (S-1).** Block Submit until all five colours are
   signed off, with an audited override by an org admin or the proposal
   manager giving a reason (recommended: "formally signed off by
   everyone" is the requirement, and a deadline at 16:55 needs a way
   through that leaves a trace)? Or advise only, as Ready for Pink does?
   Or block with no override?
2. **A colour the team did not run.** Require all five on every bid, so
   a skipped colour needs the override (recommended: simplest, and the
   override reason says why)? Or let the plan's colour teams decide
   which colours this bid requires?
3. **The transport for Option 2.** Resend, From the opportunity's own
   address on the inbound subdomain, which needs that subdomain verified
   in Resend with two DNS records (recommended: built on `sendEmail`,
   bounces and out-of-office come back to the opportunity, attachments
   to 40 MB)? Or Graph `sendMail` from the Exchange mailbox (adds
   `Mail.Send`; From is the mailbox's address for every tenant, the
   opportunity's address is Reply-To only)?
4. **What the officer sees as the sender.** `{Company name} via FORGE`
   with the sender Cc'd (recommended)? Or the sending person's name
   (`Jane Doe, Acme, via FORGE`)? Or the company's name alone?
5. **How a reply is read (S-4 "read and parsed").** Typed and summarised
   by FORGE AI, suggesting the next step and never acting, with a
   header-only fallback (recommended)? Or filed as received with no AI
   reading?
6. **Answering a reply from the portal.** Build Reply in 6d
   (recommended: a clarification answered from a personal mailbox leaves
   the thread, and its reply would not come back)? Or leave answering to
   the team's own mail for now?
7. **Who may submit.** Org admins, the proposal manager and the capture
   manager (recommended)? Or any member with edit rights on the
   proposal?
8. **After submission.** Leave the sections editable and keep the sent
   files as the record (recommended: amendments and resubmissions need
   the text, and FORGE has no lock today)? Or lock the proposal
   read-only until someone reopens it?
9. **Large submissions.** Warn above 20 MB, refuse above 35 MB and point
   to Option 1 (recommended)? Or also offer a download link in the email
   for large files (not recommended: officers may not follow links, and
   a link is not a delivery)?
10. **Order.** 6a, 6b, 6c, 6d as above (recommended: 6a alone gives the
    gate and the record)? Or replies (6c) before sending (6b), so mail
    sent by hand with the opportunity's address in Cc is filed first?

**Decided 2026-11-17: all recommended** — the gate blocks, with an
audited override by an org admin or the proposal manager (1); all five
colours on every bid, a skipped colour through the override (2); Resend,
From the opportunity's own address on the inbound subdomain, which the
owner verifies in Resend before 6b goes live (3); `{Company name} via
FORGE` with the sender Cc'd (4); replies typed and summarised by FORGE
AI, suggesting and never acting (5); Reply from the portal in 6d (6);
org admins, the proposal manager and the capture manager submit (7);
sections stay editable and the kept files are the record (8); warn
above 20 MB, refuse above 35 MB, no download links (9); order 6a, 6b,
6c, 6d (10).

**As built in 6a.** A cancelled round is ignored when reading a colour's
newest round. The submission pack counts as ticked when any reviewer
ticked it on the newest White Gloves round. Record submission requires
one kept render (PDF or Word) as the file; the optional receipt upload
of §2.3 moves to 6b, which builds the upload of extra files, as does
downloading the kept copy (the file's name, size and SHA-256 are shown).

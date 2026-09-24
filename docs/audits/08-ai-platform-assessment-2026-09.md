# 08 — AI-platform assessment (2026-09-24)

> Is FORGE a true AI platform, or scaffolding around a model call?
> Every route, action and library was read with three questions: is the
> AI real, is there a learning loop, and does the surface do what it
> claims. This report is the evidence; `docs/BACKLOG.md` → **BL-AIP**
> is the remediation program that follows from it.

## 1. Verdict in one page

**What is real.** The AI gateway is well built: Anthropic-first with
forced-tool structured output, streaming, per-feature model routing,
per-tenant token caps and a per-call telemetry ledger (`ai_call_log`).
Twenty features route through it and none of them fakes a result: stub
mode announces itself in the text and most panels banner it. The PWin
model is a real calibrated estimator graded by Brier score against
outcomes. The section drafter's prompt is genuinely assembled from
learned signals: winning and losing corpus excerpts, compliance gaps,
reviewer pass-rates by section kind, and, since PR #268, the team's own
accept / reject decisions on tracked changes. The outcome → corpus label
→ retrieval-boost loop exists and is the right shape.

**What is not.** Almost nothing runs without a click: the only
background AI is the proposal health scan. Half of the signals the
platform collects are written and never read by any prompt. Several
core hand-offs are broken, so users see the model work and then lose
its output: accepted drafts never reach the editor, review results
never render after the call, the notification engine records email
deliveries it never sends. Requirement capture is lossy by design (top
25 requirements, first 80k characters of an RFP whose Sections L and M
come last), which caps how "close to 100 %" any downstream check can
be. Outcome labels, which the winning-pattern retrieval depends on, are
rarely set because of two ordering bugs and no labelling UI. Collab
editing is engineering-complete but undeployed, and when enabled would
open existing sections blank.

**Where the scaffolding is.** Header search that does nothing. A footer
of dead text. Seven notification triggers that can be selected and
never fire. Promo codes that cannot be redeemed. An AI Engine settings
page that shows an environment variable the gateway does not read.
Internal ticket codes ("BL-23b", "(10c)") shown to customers. File
storage that is in-memory in production. These are catalogued in §5.

**Headline numbers** (from the five audits; routes counted once):

| Area | Surfaces audited | solid | thin | scaffold | broken |
|---|---|---|---|---|---|
| Capture & intelligence | 32 | 8 | 19 | 1 | 4 |
| Solicitations | 22 | 5 | 11 | 0 | 6 |
| Proposal development & editor | 46 | 21 | 16 | 5 | 4 |
| Brain & AI engine (components) | 24 | 10 | 10 | 3 | 1 |
| Navigation, settings, admin | 38 | 20 | 12 | 3 | 3 |

"Broken" means a user-facing flow does not do what it says (data lost,
result never shown, control inert). "Scaffold" means the surface exists
but the feature behind it does not.

## 2. Method

- Five read-only audits by area, each enumerating every route, action
  and library it covers, with file:line evidence. Reports are condensed
  in §4–§6; full tables live in the PR discussion of the PR that ships
  this document.
- Every defect marked **[confirmed]** below was re-read in the source by
  the author of this report before being recorded. Items without the
  marker are reported by an audit and were not independently re-read;
  each still cites file:line so it can be checked in a minute.
- No code was run against production. Two claims are inferences from
  library behaviour rather than observations and are flagged as such
  (IVFFlat recall; serverless fire-and-forget).
- The instrumentation-hook incident of 2026-09-23 (BL-QC-boot-hook,
  PR #267) is out of scope here; it is the reason the assessment was
  commissioned.

## 3. Learning loops — the whole inventory

A **closed loop** is a signal that is written and later read to change
what the AI produces or decides. A **half-loop** is written and only
displayed, or read but never written.

### Closed (7)

| # | Signal → consumer | Notes |
|---|---|---|
| 1 | `section_change_decision` → `edit-feedback.ts` → drafter prompt (`patternIntel.editFeedback`) | PR #268. Learns from human suggestions to each other; AI drafts still replace the body outside tracking, so it does not yet learn how owners judge AI text. |
| 2 | `proposal_outcome` → `knowledge_artifact.outcome_label` → `outcomeBoost` in `searchBrain` and the won / lost pattern queries → drafter | Starved: labels are set only for `mined_from_proposal` artifacts, the win-harvest path inserts `none` (§4.4), approval does not inherit the label, and there is no labelling UI. |
| 3 | Review verdicts × outcomes → `section-signals.ts` → drafter (`sectionSignal`) | Pass rate only; comment text is never used. |
| 4 | Compliance pre-flight `ai_assessment` → `complianceGaps` → drafter "MUST address" | Only as complete as the hand-pasted matrix. |
| 5 | `proposal_outcome` → PWin prior and calibration shift | Deterministic. Weights are still v1 heuristics. |
| 6 | `proposal_scan_result` → PWin readiness factor | |
| 7 | Section chat history → chat context | Memory, not learning. |

### Half-loops (14)

| Signal | Written by | Read by | What is missing |
|---|---|---|---|
| `section_draft_signal.accepted_fraction`, A/B `selected` | drafter, A/B picker | Draft Insights panel | Never reaches a prompt, routing or default-mode choice; stubbed rows counted. BL-11 is measurement, not learning. |
| Candidate approve / reject, AI kind vs applied kind | knowledge import review | UI | Extraction and classification prompts never learn from corrections. |
| Compliance AI accept / dismiss | compliance actions | nothing (assessment nulled) | Dismissals are lost. |
| `pwin_snapshot` Brier track | outcome save | display | Never retunes weights. |
| `knowledge_entry.reuse_count` | never | UI | Read but never written. |
| `knowledge_entry.quality_score` | create / update | editor badge | Not in ranking; not set on approval. |
| `ai_call_log.parse_ok`, `prompt_version` | gateway | admin usage | No repair retry; `promptVersion` never passed by any caller. |
| Debrief strengths / weaknesses, `proposal_winner_analysis`, lessons learned | outcome actions | winner / protest prompts, recompete panel | Never reach the section drafter, chat or scan. |
| Loss narrative | `/intelligence/losses` | returned to client | Not persisted. |
| Loss / customer / recompete patterns | computed on read | panels | Not in drafter or scan prompts. |
| Pursuit and pipeline briefs | `opportunity_brief`, `pipeline_brief` | in-process 5-minute cache | Not persisted, no feedback, not graded against outcomes. |
| Reviewer bid / no-bid recommendations | `opportunity_review_request` | nothing | Never compared with outcomes. |
| SAM.gov results imported vs ignored, watchlist, saved searches | BD tools | nothing | No fit model learns from them. |
| `knowledge_extraction_run.prompt_version` | hard-coded | nothing | No re-run or compare. |

Two structural gaps sit under the table. Collaborative-editor saves
(`services/collab/src/server.ts:127-157`) write the section body
directly and skip `markScanDirty` and `resolveDraftSignal`, so when
collab is enabled loops 6 and the BL-11 signals stop for those sections.
And every "background" job in `src` is a `void` promise inside a server
action (harvest on submit and on win, save-debounced scan, solicitation
parse); on serverless hosting these can be suspended when the response
returns. (Inference from platform behaviour; see BL-QC-boot-hook for the
same class of problem at boot.)

## 4. Findings by area

### 4.1 Capture & pursuit, platform intelligence

Deterministic parts are strong: PWin with calibration and Brier grading,
the recompete radar, cross-loss pattern detection, and the eBuy / GSA
structured extractors. The LLM layer is thin: four surfaces call the
model (pursuit brief, pipeline brief, loss narrative, eBuy / GSA
extraction), none persists its output, and the two briefs ignore the
intelligence the platform already computes.

- **[confirmed] SAM.gov import silently dropped selections.**
  `importSamGovOpportunitiesAction` took notice ids and re-ran an
  unfiltered 30-day / 200-row search to find them; any pick from a NAICS
  or keyword search or a wider window was reported as "skipped".
  → Fixed in BL-AIP-1.
- **[confirmed] Gate decisions never fired notification rules.**
  `setStageWithLogAction` (the one the UI calls) wrote stage + activity +
  audit and no BL-13 event; `setOpportunityStageAction`, which did
  dispatch, was unused. → Fixed in BL-AIP-1 (single write path).
- **[confirmed] Outcomes never moved the opportunity.** `saveOutcomeAction`
  updated the proposal's stage only, so the pipeline win rate, PWin
  prior, loss intelligence and recompete radar saw proposal-side
  decisions only. → Fixed in BL-AIP-1.
- **[confirmed] `listActivities` exported from a `"use server"` file with
  no auth and no tenant scope**; unused. → Removed in BL-AIP-1.
- **[confirmed] Capability matrix scored against the first 60 knowledge
  entries by title** (`review-actions.ts` + `ai-prompts-bl23.ts:213-229`)
  while `searchBrain` went unused. → Fixed in BL-AIP-1.
- **[confirmed] GSA-paste attachments were never parsed** (stored
  `parseStatus: "uploaded"`; only the upload action kicked off parsing).
  → Fixed in BL-AIP-1.
- **[confirmed] Copy hygiene:** developer text in the customer review
  email; "BL-23b" as a panel eyebrow. → Fixed in BL-AIP-1.
- Model PWin does not reach the dashboard, pipeline, Command Center or
  briefs; imports insert `pWin 0`; the dashboard receives `pWin` and
  never renders it (`OpportunitiesClient.tsx:24`) **[confirmed]**.
- The pursuit brief's snapshot uses the hand-set PWin and none of: model
  factors, recompete lessons, customer history, loss patterns, Brain
  hits (`opportunities/[id]/ai/actions.ts:51-163`). The pipeline prompt
  asks for signals its snapshot lacks (`ai-prompts.ts:531-566`).
- The "FORGE Brain" page (`/intelligence`) has no retrieval, knowledge or
  draft signals on it, and shows an operator provider panel to every
  user (`ProviderStatusPanel.tsx:12-20`).
- Env-gated BD tools (awards, firms, watchlist, saved searches) are
  always in the nav and land on "set an env var" pages.
- Activity delete has no author check; review-link copy says 14 days
  where the token lasts 72 hours; customer history renders only on
  solicitations, never on opportunities.

### 4.2 Solicitations

Five real gateway features (`solicitation_extract` text / pdf-vision /
image-vision, `solicitation_review`, `capability_matrix`,
`question_generator`) with schema validation, quota and telemetry. No
learning loop at all: nothing a reviewer does to a requirement, matrix
cell or question is recorded; past outcomes reach panels, never prompts.

- **The main AI flow shows nothing after you click.**
  `SolicitationReviewPanel.tsx:109-111` copies review / matrix / question
  state from props once (`useState(initialReview)`, setter unused), so
  `router.refresh()` cannot update it; the badge stays "Not started" and
  the matrix / question buttons stay disabled until a full reload.
  → BL-AIP-2.
- **Parses can die mid-flight and cannot be recovered.** `void parse…`
  with no `after` / `waitUntil`; Re-parse is hidden while status is
  `parsing` (`SolicitationActions.tsx:57`); the upload form claims the
  parse is synchronous (`UploadSolicitationForm.tsx:114`). → BL-AIP-2 /
  BL-AIP-4 (queue + stuck-row recovery).
- **Extracted requirements never reach the proposal.** The compliance
  matrix is filled only by manual paste
  (`proposals/[id]/compliance/actions.ts:264-300`); drafting, scan and
  chat read the thin intake list with `.limit(1)` and no ordering.
  → BL-AIP-5.
- **The review reads part of the document.** Parent `rawText` only;
  companion PWS / SOW text ignored; scanned PDFs are reviewed from the
  extraction's own summary; silent cuts at 100k (review) and 80k
  (extraction) characters. → BL-AIP-5.
- Companion-document merge: deleted documents' requirements persist
  though the confirm says they are removed (`document-actions.ts:494-503`);
  re-parsing the parent wipes merged requirements; the panel never
  refreshes out of "parsing".
- Amendments get no `opportunityId` (`actions.ts:101-115`), no team
  notification, and the diff compares two independent LLM samples so it
  reports noise.
- Uploaded solicitations cannot be attached to an existing opportunity;
  the opportunity page's CTA is a dead end and Convert duplicates.
- Key-date reminders skip solicitations with no assigned team, use the
  wrong notification kind and bypass the rules engine and email.
- Stub intake is saved as `parsed` with the stub message in Section L
  and no marker (`solicitation-extract.ts:97-121`); the drafter later
  reads it as the real Section L summary.

### 4.3 Proposal development and the editor

The AI is real and feature-gated (drafting, chat, health scan,
pre-flight, auto-map, winner analysis, protest viability). The drafter
consumes four closed loops. But the hand-offs around it are broken and
there is no proactive AI while writing.

- **Accepted AI text never shows in the editor.** `RichSectionEditor`
  reads `content` once at mount (`:315`); TipTap 3 `setOptions` does not
  re-apply content. "Replace section with this", chat "Apply to
  section", Brain Suggest insert and snapshot restore all change page
  state while the visible text stays; the next keystroke or Save
  discards the AI text or the restore. → BL-AIP-2 (this is the single
  highest-impact defect in the product).
- **AI changes are all-or-nothing and destroy formatting.** Whole-section
  replacement; output flattened to paragraphs (`tiptap-doc.ts:10-24`);
  Brain insert rebuilds the document from plain text, wiping tables,
  lists, pending tracked changes and comment anchors. → BL-AIP-6 (AI
  edits as tracked changes by "FORGE AI").
- **AI runs on stale content.** Improve / Tighten / Chat read the saved
  body (`section-draft.ts:190`, `section-chat.ts:145`); no autosave or
  unsaved-changes guard. → BL-AIP-2.
- **Pending tracked changes leak into exports and AI input**
  (`tiptap-html.ts:106-108` passes unknown marks; the plain projection
  keeps suggested deletions). → BL-AIP-2.
- **Collaboration is scaffolding.** Flag off, service undeployed (Slice
  2c); when enabled, existing content is not loaded into the Y.Doc
  (`services/collab/src/server.ts:225-262`) so sections open blank; two
  writers on one field; comments are collab-only.
- **Team workflow is silent and unguarded.** Assigning a section notifies
  no one (no trigger kind exists); sections have no due date so
  `proposal_section_overdue` can never fire; `compliance_overdue` and
  `proposal_advanced` are defined and never dispatched; any member can
  approve a section, delete a proposal or close a review; reviews show
  no content and do not update section status. → BL-AIP-3 / BL-AIP-5.
- **Compliance chain has manual gaps.** Matrix not seeded from extracted
  requirements; evidence unused by the drafter; the export gate is
  always advisory (`compliance-gate.ts:12-14`) although BACKLOG describes
  per-tier hard blocking and owner reminders that do not exist.
- **Stub junk:** auto-draft saves stub text into sections
  (`auto-draft-actions.ts:190-215`); a stub scan returns without clearing
  the stale flag so the overview shows "Background scan running" forever
  and every page load re-triggers it; stubbed drafts are counted in
  Draft Insights.
- **A/B prompt bug:** `draft_alt` receives the "Return the tightened
  body" output instruction (`ai-prompts.ts:496-501`), contaminating
  variant B of every comparison. → BL-AIP-2.
- Minor: FAR-part picker matches `includes("to")`; winner-analysis parse
  failure does not refund the request; auto-draft overwrite takes no
  snapshot; "Clear chat" has no confirm.

### 4.4 The Brain and the AI engine

- **Providers.** Anthropic (direct `/v1/messages`, native streaming),
  Azure OpenAI and vLLM; Bedrock is a class that throws. Missing key →
  silent stub. Embeddings: OpenAI `text-embedding-3-small` only; without
  a key, deterministic hash vectors that persist forever (backfill only
  fills NULLs, re-embed skips artifacts with chunks). Embedding calls are
  neither logged to `ai_call_log` nor metered.
- **Gateway gaps:** no retry / backoff on 429 / 529 and no fetch timeout
  (`ai.ts:341-349`); `stopReason` captured and never read, so output cut
  at `max_tokens` (drafts 2 200, extraction 2 400) goes undetected;
  `promptVersion` exists in the schema and is never passed.
- **Retrieval.** pgvector cosine with the won +0.10 / lost −0.05 boost and
  a +0.05 curated tie-break. IVFFlat indexes were created on empty tables
  (`0022:22`, `0023:3`) with no `probes` setting, no reindex, and the
  tenant filter applied after the approximate scan, so recall for a
  tenant's slice of a shared table is probably poor (inference, not
  measured). Ranking ignores quality score, recency, artifact kind and
  reuse. Uploads are not auto-embedded or auto-extracted; entry
  embedding failures are dropped silently (`{ok:false}` never reaches
  the `.catch`).
- **Outcome labels are effectively unset.** `saveOutcomeAction` runs
  `propagateOutcomeToCorpus` first and only then harvests a won proposal,
  which inserts with the default `none` (`outcome/actions.ts:146-165`,
  `harvest-actions.ts:155-177`) — so the BL-FB-X-BRAIN-MINE claim "every
  won proposal lands with outcomeLabel=won" is false for exactly its own
  path. `approveCandidateAction` ignores the artifact's label and
  computes no quality score. No UI lets a tenant label uploaded
  historical proposals won / lost, which is how a new tenant would seed
  winning patterns. → BL-AIP-4.
- **Requirement capture is lossy by design.** The extraction prompt asks
  for the "25 most important" requirements from the first 80k
  characters; the drafter receives the top 25 for the whole proposal, not
  per section; the scan sees 20 at 200 characters. → BL-AIP-5.
- **Grounding is optional.** Citation mode defaults off, auto-draft never
  cites, marker counts are the only check. → BL-AIP-5.
- **Background AI:** the health-scan cron only. Its stub / parse-failure
  path throws before clearing the dirty flag
  (`proposal-scan-cron.ts:220-227` vs `288-291`), so the same proposals
  are retried every five minutes, oldest first, five per run, burning
  tokens (only the request count is refunded). → BL-AIP-4.
- **Stub contamination:** the four leaks in §4.2–4.3 plus stub extraction
  candidates that can be approved into the knowledge base.
- **No evals, no prompt versioning.** Tests cover wire format and pure
  functions; there are no golden sets or retrieval evals.

### 4.5 Navigation, settings, admin, notifications, help

Every internal href resolves (`check:links`, plus hand-checked
object-literal hrefs, `router.push` targets and help markdown). The
problems are controls that do nothing and features that record success
without doing the work.

- **File storage does not persist.** `R2Storage.put()` throws "not yet
  implemented" (`storage.ts:88-104`); DOCX templates, knowledge uploads
  and PDFs live in per-instance memory and vanish on redeploy. The
  Integrations page does not list storage.
- **The notification rules engine cannot be trusted.** The email channel
  marks deliveries sent and never sends (`notification-dispatcher.ts:
  118-127`); 7 of 18 selectable triggers, including the editor default
  `opportunity_due_soon`, have no emitter; `ackedAt` is never written so
  every SLA breaches and escalates regardless of what the user did; Test
  send fans out to every rule of that kind and can deliver nothing while
  reporting success. → BL-AIP-3.
- **Header search does nothing** (`AppShell.tsx:66-77`, bare input, no
  ⌘K listener); footer "Docs · System status · API" is a plain span;
  "FORGE · Live" is static.
- **Pricing CTAs are broken:** signed-in Upgrade lands on `/settings`
  which ignores `?upgrade=`; sign-up ignores `?tier=`.
- **SAM.gov sync can be undone by the next Save** on the org profile
  (`SettingsClient.tsx:55,504`, stale `useState(initialProfile)`).
- **AI Engine page is read-only and partly wrong:** shows
  `AI_DEFAULT_MODEL`, which the gateway does not read; lists 7 of 20
  features; internal codes shown; per-tenant model overrides exist in the
  backend with no UI. → BL-AIP-7.
- Access and nav disagree: non-admins get no nav link to their own inbox,
  Settings or Audit Log; any member can export the full audit log.
- No personal account settings (profile, password, MFA, notification
  preferences) anywhere.
- Monetisation scaffolding: promo codes cannot be redeemed; `apiAccess`
  and `customTemplates` tier flags are enforced nowhere; no UI for
  per-tenant `custom_overrides`; billing shows no usage vs quota.
- Help: FAQ links resolve to 404 under `/help`; admin manual claims
  email rules work; onboarding is an error-explainer, not onboarding.
- Admin org page links to the platform audit log with `?orgId=` while the
  page reads `?tenant=` (two places).

## 5. Dead-end inventory (controls that do not do what they show)

| # | Element | Where |
|---|---|---|
| 1 | Header search input + ⌘K badge | `AppShell.tsx:66-77` |
| 2 | Footer "Docs · System status · API" | `AppShell.tsx:102` |
| 3 | "FORGE · Live" pulse | `AppShell.tsx:60-64` |
| 4 | Pricing "Upgrade →" (signed in) → `/settings?upgrade=` ignored | `(public)/pricing/page.tsx:117-118` |
| 5 | Pricing "Get started →" → `/sign-up?tier=` ignored | `(public)/pricing/page.tsx:119` |
| 6 | Admin "View full audit log for this tenant" sends `?orgId=`, page reads `?tenant=` | `admin/orgs/[id]/page.tsx:419`, `activity/page.tsx:191` |
| 7 | Seven rule triggers with no emitter (incl. the default) | `notification-rules-types.ts:16-38`, `RuleEditorForm.tsx:68` |
| 8 | Rule channel "Email" marks sent, sends nothing | `notification-dispatcher.ts:118-127` |
| 9 | Rule channels Slack / Teams "coming soon" | `notification-rules-types.ts:53-54` |
| 10 | Rule SLA / escalation (`ackedAt` never written) | `notification-cron.ts:251` |
| 11 | Rule "Test send" fans out to sibling rules | `notifications/rules/actions.ts:407` |
| 12 | Settings keywords / vehicles / PSC codes saved, never used | `SettingsClient.tsx:343,404,418` |
| 13 | SAM.gov Sync then Save overwrites synced data | `SettingsClient.tsx:55,504` |
| 14 | Promo codes (whole surface) | `admin/promo-codes/page.tsx:35` |
| 15 | Tier flags API access / Custom templates | `admin/tiers/[id]/TierEditForm.tsx:26-27` |
| 16 | AI Engine "Default model" (env var nothing reads) | `settings-status.ts:235` |
| 17 | Intelligence nav links behind `AWARDS_INTEL_ENABLED` | `NavContent.tsx:93-96` |
| 18 | FAQ links to `./USER_MANUAL.md` (404 under `/help`) | `docs/FAQ.md:4` |
| 19 | Help "View on GitHub →" | `help/layout.tsx:26` |
| 20 | Google / Microsoft SSO buttons without env → config error | `SsoButtons.tsx`, `auth.ts:125-135` |
| 21 | Email senders written and never called | `email.ts:192,239,280` |
| 22 | `Ticker` returns null, imported nowhere | `components/shell/Ticker.tsx` |
| 23 | Opportunity CTA "Upload a solicitation and link it here" (no link action exists) | `OpportunityDocsAndAIPanel.tsx:63-72` |
| 24 | Section author picker (no notification, no due date) | `SectionsClient.tsx` author select |
| 25 | `/pipeline/[id]` leftover redirect | `pipeline/[id]` |
| 26 | ~~SAM.gov import of filtered results~~ | fixed in BL-AIP-1 |
| 27 | ~~"BL-23b" eyebrow; developer copy in review email~~ | fixed in BL-AIP-1 |

## 6. Backlog claims that the code does not support

| Claim (docs/BACKLOG.md) | Reality |
|---|---|
| BL-11 "Brain self-improvement loop" shipped | Measurement only; `accepted_fraction` and A/B `selected` reach no prompt. |
| BL-FB-X-BRAIN-MINE "every won proposal lands in the Brain with outcomeLabel=won" | The win-harvest path inserts `none` (ordering bug). |
| BL-FB-GEN-CITE "prevents AI-fabricated past performance" | Opt-in, off by default, never verified against sources. |
| BL-FB-X-PWIN-MODEL "replaces the manual slider" | Slider is still primary; model PWin is not on dashboard, pipeline or briefs. |
| BL-FB-CM-GATE per-tier hard block + crosswalk auto-attach | Gate is always advisory. |
| BL-FB-CM-OWNERS reminders + "my rows" dashboard | Neither exists. |
| BL-FB-SOL-AMEND-DIFF notifies the team | No notification. |
| BL-FB-SOL-CALENDAR reminders through the rules engine + per-opportunity strip | Cron inserts directly with the wrong kind; strip does not exist. |
| BL-23 review "every uploaded attachment" | Parent `rawText` only. |
| Question generator Word export | Clipboard only. |
| BL-QC-auto-migrate acceptance | Never ran until PR #267 (already corrected). |

## 7. The program — BL-AIP

Ordered by user impact per unit of work; one PR per slice; strict serial.
Each slice names the evidence above it closes.

**BL-AIP-1 — capture-loop breaks and hygiene** (this PR). §4.1 confirmed
items: import bug, gate-decision rules, outcome → opportunity stage,
unguarded `listActivities`, Brain-ranked matrix knowledge, GSA parse
kick-off, copy hygiene.

**BL-AIP-2 — the hand-offs.** Editor receives AI output (drive TipTap via
`editor.commands.setContent` on replace / apply / insert / restore, or
key the editor on a document version); unsaved-changes guard and
"AI runs on what you see" (send the live plain text); strip pending
tracked-change marks from exports and AI input; `SolicitationReviewPanel`
state keyed to props; fix the `draft_alt` output instruction; stub scan
clears the stale flag; stuck-parse recovery (Re-parse visible while
`parsing` older than N minutes). Small, high-impact, all confirmed
reproducible from code.

**BL-AIP-3 — notification engine truth.** Send email in the dispatcher and
cron; write `ackedAt` on mark-read; scope Test send to the rule; emit the
seven missing triggers (`opportunity_due_soon` from the key-dates cron,
`membership_*` from users actions, `proposal_advanced` from stage
advance, `proposal_section_overdue` / `compliance_overdue` once due dates
exist, `audit_anomaly` from a nightly pass); section-assignment
notification kind; admin audit-link param; nav visibility for non-admin
members; audit-log read gated to admins.

**BL-AIP-4 — outcome provenance and Brain indexing.** Harvest reads
`proposal_outcome`; approval inherits label and quality; outcome selector
on artifact upload and entry editor; reconcile job outcome →
artifacts / entries. `/api/cron/brain-index`: embed artifacts without
chunks, re-embed stub / stale vectors (record provider + model on
entries), auto-extract new artifacts with dedup, log embedding calls;
`ivfflat.probes` + reindex (or HNSW); hybrid tsvector; kind / recency /
quality in ranking. Fix the scan cron (attempt counter, backoff, clear on
stub). Move `void` background work onto the same durable pattern.

**BL-AIP-5 — requirements-first pipeline.** Chunked extraction over the
full `rawText` merged across companion documents (no "top 25"); seed
`compliance_item` from requirements on convert / proposal create and run
auto-map; per-section requirements to the drafter verbatim; citation
mode on by default including auto-draft, with a verifier pass and
`stopReason` handling; the export gate hard-blocks on open matrix items
and `[NEEDS CITATION]`. Proposal bootstrap from Section L (sections, page
limits, due dates, proposed themes).

**BL-AIP-6 — AI as a collaborator in the editor.** Apply Improve /
Tighten / Chat results as paragraph-level tracked changes authored
"FORGE AI" (jsdiff is already in the bundle), so owners accept or reject
per paragraph and `section_change_decision` starts measuring how owners
judge AI text; a debounced "research while you write" rail (Brain hits
with the won boost, unaddressed mapped requirements, missing themes,
contradictions) with "insert as tracked suggestion"; drafter and chat
receive draft-signal acceptance, review-comment text, debrief weaknesses
and winner gaps by agency; AI colour-team pre-review on `startReview`.

**BL-AIP-7 — proactive intelligence and control.** Nightly scout
(re-run saved searches + org NAICS, score with recompete / PWin prior /
customer intel, structured `opportunity_triage`, learn from import vs
dismiss; watchlisted expiring awards → draft opportunities); stored,
grounded, graded pursuit and pipeline briefs; nightly PWin snapshots and
"PWin movers"; a real AI Engine control panel (per-feature model class
within tier → `customOverrides.aiModels`, monthly budget vs
`aiTokensPerMonth`, burn-down from `ai_call_log`, all 20 features); ⌘K
palette with Brain answers; AI-assisted onboarding from UEI.

**Cross-cutting, scheduled into the slices above:** R2 storage
implementation (BL-AIP-4), golden eval set from won proposals keyed by
`promptVersion` (BL-AIP-5), personal account settings and role checks on
proposal actions (BL-AIP-3), pricing CTA and SAM-sync-overwrite fixes
(BL-AIP-2).

## 8. What "a true AI platform" looks like when the program lands

A capture manager opens FORGE and the scout has already triaged last
night's SAM.gov notices against the Brain, the org's win history and the
recompete radar, with a stored brief per pursuit that will later be
graded against the outcome. A solicitation upload is parsed to
completion on a durable job, every requirement is captured and seeded
into the compliance matrix, and the review, matrix and question set are
pre-computed before anyone clicks. Writers work in an editor where the
AI's suggestions arrive as tracked changes they accept paragraph by
paragraph, while a rail surfaces the evidence, the unaddressed
requirements and the missing win themes for the paragraph under the
cursor. Every accept, reject, reviewer verdict, debrief and outcome
flows back into the prompts. Exports are blocked, not warned, when a
requirement is open or a claim is uncited. And the tenant can see and
steer all of it: which model class each feature uses, what it costs,
and how much of what the AI wrote survived review.

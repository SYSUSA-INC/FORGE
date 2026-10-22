# Uniformity assessment: Knowledge base, Settings, Users

Scope: /knowledge-base, /knowledge-base/[id], /knowledge-base/import, /knowledge-base/import/[id], /knowledge-base/new, /knowledge-base/usaspending, /settings, /settings/ai-engine, /settings/api, /settings/billing, /settings/integrations, /settings/templates, /settings/templates/[id], /settings/templates/new, /users.

Method: I looked at both themes of every route (the `all/*--light.png` and `*--dark.png` screenshots, with crops where needed) and read the code on origin/main at 4a6f0b4. All paths below are relative to `src/app/(app)/` unless they start with `src/`.

Excluded from this report:
- Anything PR A (`/home/user/forge-ui`) already fixes: elevated cards in AIEngineTab, IntegrationsTab and UsersClient; Panel stripes; the gradient avatar; brass, red and indigo contrast.
- Every accepted `UP` finding: tabs and diamond, list-row boxes, `.aur-tag` chips, mono paragraphs, sub-10px mono, the secondary-button/`.aur-link` change, `padStart`, `text-foreground`, semibold, inline links becoming `text-accent`, pills vs squares, and the plum-as-accent sites already listed there.

---

## 1. Patterns

**Page header.** All 15 routes use `PageHeader`: mono eyebrow, a 400-weight title, a subtitle, and optional actions and meta.
- Outliers:
  - The eyebrows don't follow one scheme. You get "Settings" (SettingsClient.tsx:99, ai-engine/page.tsx:77, integrations/page.tsx:42), "Settings · API access" (api/page.tsx:39), "Account · Billing" (billing/page.tsx:93) and "Settings · Templates". The knowledge pages mix "Knowledge base · Corporate memory", "Knowledge base" and "Knowledge · …".
  - The back affordance takes five forms:
    - "Back" ([id]/page.tsx:37, new/page.tsx:19)
    - "← Knowledge base" and "← Corpus"
    - "← Settings" (ai-engine/page.tsx:81 and integrations/page.tsx:46 only)
    - In the page body at 11px (templates/[id]/EditTemplateClient.tsx:653-658)
    - Missing on the other settings pages
  - /settings puts a second page-title-sized heading in its body (finding 11).

**Tabs and segmented filters.** I found five controls and four looks.
- KnowledgeBaseClient.tsx:115-155: a bordered container, with the active segment `bg-layer/10` (grey).
- import/CorpusList.tsx:189-200: filled chips, with the active one `bg-teal-400/15` (blue).
- import/[id]/CandidateReviewClient.tsx:323-334: `rounded-full`, with a blue border when active.
- VolumeStylePanel.tsx:64: `rounded-full`, with the active one plum.
- templates/[id]/EditTemplateClient.tsx:425-432: a `rounded-full` segmented control.

The planned tab/diamond and 3px-radius fixes cover the shape. The plum active state is finding 4.

**Tables and list rows.**
- Tables: there are three header recipes, and two of them appear on the same page (finding 13).
- List rows: rows are boxes inside a Panel almost everywhere: KnowledgeBaseClient.tsx:175, UsersClient.tsx:478 and :613, billing/page.tsx:190, VersionHistoryPanel.tsx:52, TemplatesList.tsx:58 and :161, UsaspendingImportClient.tsx:244, and CandidateReviewClient.tsx:361. The known list-rows fix covers these.
- The only hairline lists are CorpusList.tsx:151 and TagManager.tsx:44. They use `divide-y` inside a bordered `ul`.

**Status chips and badges.**
- Dominant recipe: `rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest` plus a tint. Examples: ArtifactRow.tsx:89-99, KnowledgeBaseClient.tsx:179/190, billing/page.tsx:201, UsersClient.tsx:486/638/644, AiControlPanel.tsx:187.
- Outliers:
  - `aur-pill` (fully round) at AIEngineTab.tsx:29-35 and IntegrationsTab.tsx:86-90 (finding 12).
  - A larger `rounded-md px-2 py-1` status chip at UsersClient.tsx:669.
- Tags are drawn three ways:
  - `#VA`, uppercase, 9px (KnowledgeBaseClient.tsx:217)
  - lowercase with no `#` (ArtifactRow.tsx:113)
  - `#tag` at 11px (TagManager.tsx:125)
- Colour meaning drifts: findings 2, 3 and 4.

**Alerts, banners and notices.**
- Dominant recipe (17 uses): `rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose`, plus an emerald twin (6 uses, and 4 more as `emerald-400`).
- Outliers take five other forms (finding 8).
- Stub mode has a shared component, `StubModeBanner`, but only the KB import page uses it (finding 12).

**Buttons and links.**
- Buttons: primary is `aur-btn aur-btn-primary`. Secondary is the `aur-btn aur-btn-ghost` combination (56 uses in this area), which the known secondary-button finding covers.
- Destructive actions take three forms (finding 5).
- Button text comes in four sizes: 10, 11, 12 and 14px (finding 6).
- Links are styled four ways:
  - Ink `hover:underline`: KnowledgeBaseClient.tsx:203, TemplatesList.tsx:73, api/page.tsx:79
  - `text-teal`: UsaspendingImportClient.tsx:305, CandidateReviewClient.tsx:388
  - A bare `underline` that inherits the colour: SettingsClient.tsx:545, SamGovKeyPanel.tsx:123
  - Mono uppercase text buttons: TemplatesList.tsx:119-143, VersionHistoryPanel.tsx:62-68

  The known "inline text links → `text-accent`" fix covers this.

**Form fields.**
- Consistent: every text input, select and textarea in the area uses `aur-input`, and every visible label uses `aur-label`.
- Radio-card pickers match each other (NewEntryForm.tsx:74 and NewTemplateForm.tsx:45): blue border and tint when selected.
- Outliers are font and size overrides on `aur-input`, one unbranded checkbox, and two hand-rolled labels (finding 14).
- Checkbox labels mix mono (SettingsClient.tsx:927/953, UsaspendingImportClient.tsx:137) and Host Grotesk (VoicePanel.tsx:94).

**Empty states.** They come as a Panel with 14px body text and a primary CTA (knowledge-base/page.tsx:111-125), 13px body text (KnowledgeBaseClient.tsx:167, ApiTokensClient.tsx:120), or 11px mono ("No pending invites.", "None yet.", "No candidates yet…", VersionHistoryPanel.tsx:23). The known mono-paragraph fix covers this.

**Cards and panels.**
- `Panel` dominates.
- Outliers:
  - A hand-made box at the top of /knowledge-base/import (finding 10).
  - The entity banner on /settings (finding 11).
  - The settings tab components stack their Panels with no gap (finding 7).
  - Inline boxes (QualityScorePanel at EditEntryClient.tsx:280/293, ClassifyBackfillButton.tsx:31) are notice-like and acceptable.
  - Dropzones use 2px dashed borders at a 9px radius (CorpusUploader.tsx:164, EditTemplateClient.tsx:727), off the 5px card scale.

**Charts and graphs.** There is only one: the AI Engine daily token bars, `bg-cobalt/40` (AiControlPanel.tsx:122-131), and burn meters coloured green, brass and red for healthy, approaching and at-cap (AiControlPanel.tsx:195-199). They are on-meaning, and I found no problem.

**Modals and menus.** There are no custom ones. All 11 confirmations are native `window.confirm` dialogs, for example EditEntryClient.tsx:112, ApiTokensClient.tsx:48 and UsersClient.tsx:581. They are browser chrome and don't follow the theme. That's a product choice, not a colour defect.

**Stat tiles.**
- `PageHeader` meta tiles appear on six pages (KB index, import, import/[id], ai-engine, api, templates). Only /knowledge-base pads them to "01".
- Outliers:
  - The `BannerTag` tiles on /settings (finding 11).
  - The role tiles on /users (UsersClient.tsx:159-176), which are already in the known findings.
- Billing, Integrations and Users have no figure row.

---

## 2. Findings

### 1. The default template is marked in the tenant's brand colour, which is unreadable on the light theme
- **Severity:** high
- **Pages:** /settings/templates and /settings/templates/[id]. It affects the light theme most.
- **What you see:** When a template is the default, its card border and wash and its "Default" chip all switch to the tenant's `brandPrimary`. The schema default is `#2DD4BF` (src/db/schema.ts:2347). As 9–10px chip text on white paper that measures **1.86:1**, so it can't be read. It is also a second accent in the app chrome, next to the brand blue. On the dark theme, a dark navy brand colour would drop to about 1.2:1 on paper.
  - The screenshots show "Default: Not set", so the chip doesn't appear in them. I computed the contrast from the code and the schema default.
- **Cause:**
  - TemplatesList.tsx:58-66: `style={{ borderColor: \`${t.brandPrimary}80\`, background: \`${t.brandPrimary}0D\` }}`
  - TemplatesList.tsx:77-87 and templates/[id]/EditTemplateClient.tsx:259-269: chip `color: brandPrimary`, `${brandPrimary}1A` / `${brandPrimary}50`
- **Fix:**
  - Mark the default the way the rest of the app marks a selection. Card: `aur-card` plus `border-cobalt/40 bg-cobalt-400/[0.06]`, with no inline style. Chip: `<span className="aur-chip border-cobalt/40 bg-cobalt/10 text-cobalt-300">Default</span>`, or the planned `.aur-tag` with an `aur-diamond`.
  - Keep tenant colours only where they are content: the swatch dots (TemplatesList.tsx:99-108) and the Preview panel (EditTemplateClient.tsx:599-635).
- **Scope:** local, in two files.

### 2. Each knowledge "kind" is coloured with a status hue, and the hue changes from page to page
- **Severity:** medium
- **Pages:** /knowledge-base and /knowledge-base/import/[id], both themes. It also reaches /proposals/[id]/compliance.
- **What you see:**
  - "Past performance" is a **plum** chip on /knowledge-base, but **green** on /knowledge-base/import/[id] and in the compliance EvidenceDock.
  - "Boilerplate" is **muted** on one page and **brass** on the other.
  - "Personnel" is indigo.
  - Plum means pink team, green means won, brass means attention and indigo means review, so a category reads as a state. On an entry card a green "PAST PERFORMANCE" chip can sit next to a green "WON" outcome chip.
  - The same chip also looks different on the two pages. On /knowledge-base it is bare plum text with no tint or border: the `${color}1A` suffix on a `var()` colour is invalid CSS. On import/[id] it is a tinted box.
- **Cause:**
  - knowledge-base/KnowledgeBaseClient.tsx:23-28: `KIND_COLOR`. `past_performance: THEME.plum`, `personnel: THEME.indigo`, `boilerplate: THEME.muted`. Rendered at :178-187.
  - import/[id]/CandidateReviewClient.tsx:26-31: `KIND_TONES`. `past_performance` emerald, `personnel` violet, `boilerplate` amber. Rendered at :371-375.
  - Outside this area, proposals/[id]/compliance/EvidenceDock.tsx:21-25 sets `past_performance: THEME.green`.
- **Fix:**
  - Treat a kind as a category, not a status. Add one shared module (for example `src/lib/knowledge-kind.ts`) with only the labels.
  - Render every kind as a neutral tag: `rounded border border-layer/15 bg-layer/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-label text-muted`, or the planned `.aur-tag` with no tone.
  - Delete `KIND_COLOR` and `KIND_TONES`.
  - Keep hue only for the outcome chips (won green, lost red).
- **Scope:** shared (one module and three consumers).

### 3. Status hues are used against their meaning in the KB and on AI Engine
- **Severity:** medium
- **Pages:** /knowledge-base, /knowledge-base/import, /knowledge-base/import/[id] and /settings/ai-engine, both themes.
- **What you see and why:**
  - **Withdrawn is brass.** Brass means attention. On proposals the same outcome is slate grey (src/lib/proposal-outcome-types.ts:20 `withdrawn: "#94A3B8"`). Cause: KnowledgeBaseClient.tsx:42 `withdrawn: "bg-amber-400/10 text-amber-200 border-amber-400/30"`.
  - **An artifact being extracted is brass.** Work in progress should be cobalt. Cause: import/ArtifactRow.tsx:78-79 `extracting_text ? "bg-amber-500/15 text-amber-200"`.
  - **The tag drop target is brass, while every other drop target is blue.** Kind group: CorpusList.tsx:278. Kind chip: :496. Dropzone: CorpusUploader.tsx:166. The tag bucket uses `border-amber-400/60 bg-amber-400/[0.05]` at CorpusList.tsx:357-360.
  - **The "Unlimited" budget chip is cobalt.** That is informational, not in progress. Cause: settings/ai-engine/AiControlPanel.tsx:39 `unlimited: "border-cobalt/40 bg-cobalt/10 text-text"`.
  - **Similarity scores use a five-hue ramp.** Green, greenLight, cobalt, indigo and muted, so a 60% match reads as "in progress" and a 45% match as "in review". Cause: SemanticSearchClient.tsx:200-206. The sibling quality score uses green, brass and red instead (EditEntryClient.tsx:286-291).
- **Fix:**
  - KnowledgeBaseClient.tsx:42: `withdrawn: "bg-layer/5 text-muted border-layer/10"`, the same as `no_bid` at :41.
  - ArtifactRow.tsx:79: `"bg-cobalt/15 text-cobalt-300"`.
  - CorpusList.tsx:359: `"border-teal-400/60 bg-teal-400/[0.05]"`, matching :278.
  - AiControlPanel.tsx:39: `"border-layer/15 bg-layer/5 text-muted"`.
  - simColor: `s >= 0.85 ? THEME.green : THEME.muted`, rendering the number in ink. The greenLight text role is already a known finding.
- **Scope:** local.

### 4. Plum is the accent for Writing voice and House style on /settings
- **Severity:** medium
- **Pages:** /settings, both themes. In the screenshot, the "My writing voice" panel shows the plum stripe. The trait chips only render once a voice is built, and the volume picker is below the screenshot crop. I verified both in the code.
- **What you see:** Plum is the pink-team colour. Here it marks the voice traits, the selected volume and the panels themselves. This extends the known "plum and indigo as general accents" finding to files that finding doesn't list.
- **Cause:**
  - VoicePanel.tsx:80: traits `border-plum-400/40 bg-plum-400/10 text-plum-300`
  - VolumeStylePanel.tsx:64: active `border-plum/40 bg-plum/10 text-text`
  - `accent="plum"` at VoicePanel.tsx:56, HouseStylePanel.tsx:34 and VolumeStylePanel.tsx:53. After PR A this prop does nothing, but it is still passed.
- **Fix:**
  - Traits become neutral tags: `rounded border border-layer/15 bg-layer/5 px-2 py-0.5 font-body text-[12px] text-text`.
  - The selected volume becomes `rounded border border-cobalt/40 bg-cobalt-400/[0.06] text-text`, or the planned diamond tab pattern.
  - Remove `accent="plum"` from all three panels.
- **Scope:** local.

### 5. Destructive buttons take three forms, and the most common one turns blue on hover
- **Severity:** medium
- **Pages:** /knowledge-base/[id], /knowledge-base/import, /knowledge-base/import/[id], /settings, /settings/api, /settings/billing, /settings/integrations, /settings/templates/[id] and /users, both themes.
- **What you see:**
  - "Delete" on /knowledge-base/[id] is a red-tinted button.
  - "Delete" on /knowledge-base/import, one click away, is a grey button with red text.
  - Elsewhere, Remove is underlined mono text.
  - The grey-with-red-text version turns **brand blue on hover**. In the compiled CSS, `.aur-btn-ghost:hover { color: cobalt-500 }` (.next/static/css/app/layout.css:704) has specificity 0,2,0, which beats `.text-rose-300` at 0,1,0 (:3268). So the destructive action looks like the primary action exactly when you point at it.
- **Cause:**
  - `aur-btn aur-btn-danger`: EditEntryClient.tsx:254, SettingsClient.tsx:813, UsersClient.tsx:524 and :687.
  - `aur-btn aur-btn-ghost text-rose(-300)`: ArtifactRow.tsx:188, TagManager.tsx:173, CandidateReviewClient.tsx:433 (Reject), EditTemplateClient.tsx:763, ApiTokensClient.tsx:151 (Revoke), AddonGrantControls.tsx:78.
  - Text only: SamGovKeyPanel.tsx:139 (`text-rose underline`), VoicePanel.tsx:130 (`hover:text-rose-300`), TemplatesList.tsx:140.
- **Fix:**
  - Use `aur-btn aur-btn-danger` for every Delete, Remove, Revoke and Reject, with the small size from finding 6 in rows.
  - Keep "×" chip removers as they are (SettingsClient.tsx:631 and :995).
  - The class already exists, so this is a find-and-replace on the six ghost-plus-rose sites and the two text-only removes.
- **Scope:** shared class, local edits.

### 6. Button text comes in four sizes, sometimes in the same row
- **Severity:** medium
- **Pages:** all routes in this area, both themes. It is clearest on /knowledge-base and /settings/templates/[id].
- **What you see:**
  - The /knowledge-base header row has "Embed missing" and "Score unscored" at 11px next to "Import corpus", "From USAspending" and "+ New entry" at 14px.
  - The template editor puts "Back" at 11px beside "Save template" at 14px.
  - /knowledge-base/import uses 12px for its search buttons.
  - Row actions on the import pages are 10px.
  - /users has one tall full-width primary button.
  - Tally across the area: 41 buttons at `text-[11px]`, 12 at `text-[10px]`, 3 at `text-[12px]` and about 37 at the 14px default.
- **Cause:**
  - knowledge-base/EmbedMissingEntriesButton.tsx:49 and RescoreEntriesButton.tsx:47 (`aur-btn aur-btn-ghost text-[11px]`), rendered in the PageHeader at knowledge-base/page.tsx:66-67.
  - EditTemplateClient.tsx:655 vs :662.
  - SemanticSearchClient.tsx:105 and :113.
  - ArtifactRow.tsx:171-188, TagManager.tsx:143-173, CandidateReviewClient.tsx:404-443.
  - UsersClient.tsx:404 (`py-2.5 text-sm`).
- **Fix:**
  - Add a size modifier after the button classes in globals.css: `.aur-btn-sm { @apply px-2.5 py-1 text-[12px]; }`.
  - Codemod `text-[10px]`, `text-[11px]` and `text-[12px]` on any `aur-btn*` className to `aur-btn-sm`.
  - Page-header actions and form submits keep the default size: drop `text-[11px]` at EmbedMissingEntriesButton.tsx:49 and RescoreEntriesButton.tsx:47, and drop `py-2.5 text-sm` at UsersClient.tsx:404.
  - Move the template "Back" into the PageHeader `actions` at templates/[id]/page.tsx:28-34, as the other detail pages do.
- **Scope:** shared.

### 7. Settings tab components stack their Panels with no gap
- **Severity:** medium
- **Pages:** /settings/integrations and /settings/ai-engine, both themes.
- **What you see:** On Integrations, the "Integrations", "Data sources", "AI providers", "Document output" and "Email" panels touch. Their borders double into a 2px seam and their rounded corners meet (visible in the integrations screenshot from y≈637). Every other page spaces panels 16px apart. The AI Engine tab component does the same with "Active AI provider", "AI features" and "Embeddings"; that part is below the screenshot crop, and I verified it in the code.
- **Cause:**
  - IntegrationsTab.tsx:28-80 and AIEngineTab.tsx:18-165 each return a bare `<>…</>` of sibling `<Panel>`s.
  - Their callers add no gap: integrations/page.tsx:51-52 and ai-engine/page.tsx:117-119.
- **Fix:**
  - Minimal: change the fragment to `<div className="flex flex-col gap-4">`, as in TemplatesList.tsx:44.
  - Better for Integrations: one Panel, with each category as an `aur-label` subhead over hairline rows (`ul className="divide-y divide-layer/10"`), so there are fewer boxes.
- **Scope:** local, in two files.

### 8. Notices use six recipes for three tones
- **Severity:** low
- **Pages:** /knowledge-base/import, /knowledge-base/import/[id], /settings/billing, /settings/templates/[id] and /users, both themes.
- **What you see:** The same error, success or warning box changes wash (5% or 10%), border (30% or 40%), corner (3px or 5px), size (10, 11 or 12.5px), font and ink (`text-rose` or `text-rose-300`) depending on the file. One file draws its warnings two ways.
- **Cause:**
  - Dominant: `rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose`.
  - Outliers:
    - `rounded border-rose-500/30 bg-rose-500/5 text-[10px] text-rose-300`: ArtifactRow.tsx:144 and :149, CorpusList.tsx:145, ClassifyBackfillButton.tsx:54 and :61.
    - `font-body text-[12.5px] text-rose-300`: billing/page.tsx:156.
    - Emerald-400 and amber-400 at `[0.06]`: billing/page.tsx:105-109.
    - Attention boxes: `amber-400/30 bg-amber-400/5` at CandidateReviewClient.tsx:218 and EditTemplateClient.tsx:867, vs `gold/40 bg-gold/10` at EditTemplateClient.tsx:250 and UsersClient.tsx:341.
- **Fix:**
  - Add this to globals.css and replace all of the above:
    ```
    .aur-notice { @apply rounded-md border px-3 py-2 font-body text-[13px] leading-[1.5]; }
    .aur-notice-danger { @apply border-rose/40 bg-rose/10 text-rose; }
    .aur-notice-success { @apply border-emerald/40 bg-emerald/10 text-emerald; }
    .aur-notice-attention { @apply border-gold/40 bg-gold/10 text-gold; }
    ```
  - This also applies the planned mono-to-body paragraph change once, centrally.
- **Scope:** shared.

### 9. The Audit-log retention text uses opacity instead of the ink tokens
- **Severity:** low
- **Pages:** /settings, both themes.
- **What you see:** The Audit-log retention paragraph is 14px and darker than the 12px muted paragraph in the "My writing voice" panel beside it in the same grid.
- **Cause:** AuditRetentionPanel.tsx:44 `mb-3 text-sm opacity-80`. Its status lines at :82 and :92 use `opacity-70`.
- **Fix:**
  - :44 → `mb-3 font-body text-[12px] leading-relaxed text-muted`, matching VoicePanel.tsx:68, HouseStylePanel.tsx:35 and ReviewReminderPanel.tsx:50.
  - :82 and :92: `opacity-70` → `text-muted`.
- **Scope:** local.

### 10. The first block on /knowledge-base/import isn't a Panel
- **Severity:** low
- **Pages:** /knowledge-base/import, both themes.
- **What you see:** The Semantic search block has a 9px corner, a tinted ground, and a title inline with its chip but no header rule. The Upload, Corpus and Tags Panels below it have a 5px corner, paper, and a hairline header. The upload-queue box uses the same off-scale 9px corner.
- **Cause:** SemanticSearchClient.tsx:69 `rounded-xl border border-layer/10 bg-layer/[0.015] p-4`, with the header at :70-86. CorpusUploader.tsx:197 `rounded-xl …`.
- **Fix:**
  - Wrap it as `<Panel title="Semantic search" eyebrow={\`Indexed: ${chunks} chunks across ${n} artifacts\`} actions={<stub pill/>}>`.
  - CorpusUploader.tsx:197: `rounded-xl` → `rounded-md`.
- **Scope:** local.

### 11. The "Registered entity" banner on /settings is a fourth figure-tile style
- **Severity:** low
- **Pages:** /settings, both themes.
- **What you see:** Under the page title is a card with its own 30px heading, plus four tinted mini-tiles with 9px keys and 13px mono values. They look like neither the PageHeader meta tiles on the sibling AI Engine, API and Templates pages nor the Panels.
- **Cause:** SettingsClient.tsx:443-458 (`aur-card px-6 py-5`, `font-display text-3xl font-semibold`) and BannerTag at :460-468 (`rounded-md border border-layer/10 bg-layer/[0.03]`).
- **Fix:**
  - Pass UEI, CAGE, Source and Last sync as `meta` to the PageHeader at SettingsClient.tsx:98, so they inherit the planned figure-tile fix.
  - Put the org name in the subtitle.
  - Delete EntityBanner and BannerTag.
- **Scope:** local, but it reuses the shared PageHeader.

### 12. The stub/live indicator is drawn three ways, and the shared component is barely used
- **Severity:** low
- **Pages:** /knowledge-base/import, /settings/ai-engine and /settings/integrations, both themes.
- **What you see:**
  - The KB import page says "STUB" in a 3px chip.
  - AI Engine and Integrations use fully round pills ("STUB MODE", "stub", "live") on the same screen as 3px chips such as "UNLIMITED".
  - The import page also has an ad-hoc 9px "live · provider" chip.
- **Cause:**
  - `StubModeBanner variant="pill"` (src/components/ui/StubModeBanner.tsx:47-55) is used only at SemanticSearchClient.tsx:74.
  - `aur-pill bg-amber-400/10 …` / `bg-emerald-400/10 …` at AIEngineTab.tsx:29, :33, :107, :111, :140, :144 and IntegrationsTab.tsx:84-94.
  - The ad-hoc chip is at SemanticSearchClient.tsx:76.
- **Fix:**
  - Add a `live` variant next to `pill` in StubModeBanner, using the same 3px recipe in green: `border-emerald/40 bg-emerald/10 text-emerald`.
  - Replace every `aur-pill` stub/live chip and the chip at SemanticSearchClient.tsx:76 with it.
- **Scope:** shared.

### 13. Tables use three header recipes, two of them on one page
- **Severity:** low
- **Pages:** /settings/ai-engine and /settings/api, both themes.
- **What you see:**
  - The model-routing table is mono 11px throughout, feature names included, with heavy `tracking-widest` headers in muted ink.
  - The eval tables lower on the same page use 10px `tracking-label` headers in subtle ink.
  - The API tokens table uses `tracking-wider` mono headers over a Host Grotesk body.
- **Cause:** AiControlPanel.tsx:255-266 (`font-mono text-[11px]`, th `font-semibold uppercase tracking-widest`), GoldenEvalPanel.tsx:122-123, RetrievalEvalPanel.tsx:95-96, ApiTokensClient.tsx:123-125.
- **Fix:**
  - Add `.aur-th { @apply px-2 py-1.5 text-left font-mono text-[10px] font-normal uppercase tracking-label text-subtle; }`.
  - Set table bodies to `font-body text-[13px]`, keeping `font-mono tabular-nums` only for ids, dates and counts.
  - In AiControlPanel.tsx:275-277, wrap `{r.label}` in `font-body text-[13px] text-text` and set the key line to `font-mono text-[10px] text-subtle`.
- **Scope:** shared.

### 14. Form controls: one unbranded checkbox and font overrides on `aur-input`
- **Severity:** low
- **Pages:** /users (ITAR orgs), /settings/ai-engine, /knowledge-base/import and /settings/integrations.
- **What you see:**
  - The ITAR attestation checkbox uses the browser's own blue. Every other checkbox uses brand blue through a per-instance `accent-teal-400` (7 sites).
  - The AI budget inputs and routing selects are set in mono.
  - The outcome select in corpus rows is 10px.
  - One label is a hand-rolled 9px style.
- **Cause:**
  - UsersClient.tsx:375-379 (`className="mt-0.5"`, no accent class).
  - AiControlPanel.tsx:139 and :150 (`aur-input mt-1 font-mono text-sm`), :291 (`font-mono text-[11px]`).
  - ArtifactRow.tsx:156 (`text-[10px]`), TagManager.tsx:41 and :121 (`text-[11px]`).
  - SamGovKeyPanel.tsx:104 (a `text-[9px]` label instead of `aur-label`).
- **Fix:**
  - In globals.css `@layer base`, add `input[type=checkbox], input[type=radio] { accent-color: rgb(var(--c-action)); }` and remove the per-instance `accent-teal-400` classes.
  - Drop `font-mono` from the two budget inputs; keep `tabular-nums`.
  - Set a 12px minimum on `aur-input` overrides (ArtifactRow.tsx:156, TagManager.tsx:41 and :121, AiControlPanel.tsx:291).
  - SamGovKeyPanel.tsx:104 → `aur-label`.
- **Scope:** shared (the accent rule) and local.

### 15. The six settings pages don't share one header pattern
- **Severity:** low
- **Pages:** /settings, /settings/ai-engine, /settings/api, /settings/billing, /settings/integrations and /settings/templates.
- **What you see:** These are sibling pages in the sidebar. Their eyebrows read "Settings", "Settings · API access", "Account · Billing" or "Settings · Templates". Two of them (AI Engine and Integrations) add a "← Settings" back button, which implies they sit under /settings. Billing adds an 11px "See all plans →".
- **Cause:** SettingsClient.tsx:99, ai-engine/page.tsx:77 and :81, api/page.tsx:39, billing/page.tsx:93 and :97, integrations/page.tsx:42 and :46, templates/page.tsx:21.
- **Fix:**
  - Use the eyebrow `Settings · <page name>` on all six, with "Organization & workspace" for /settings.
  - Remove the two "← Settings" back buttons, since the sidebar diamond marks the current page.
  - "See all plans" follows the planned `.aur-link` change.
- **Scope:** local.

---

## Handed to the shell reviewer (not counted above)

The settings sub-pages switch the whole sidebar as you move between them. /settings, /settings/ai-engine and /settings/integrations render the WORKSPACE nav. /settings/api, /settings/billing and /settings/templates render the COMPANY ADMIN nav, with its "Organization" group and diamond. The cause is `COMPANY_PATHS` in src/lib/nav-workspaces.ts:280-288, which lists billing, templates and api but not `/settings`, `/settings/integrations` or `/settings/ai-engine`. `resolveWorkspace` (:351-367) only keeps the company tree when the `forge.workspace` cookie says so. The screenshots show the switch: the Settings, AI Engine and Integrations shots show WORKSPACE, while the API, Billing and Templates shots show COMPANY ADMIN.

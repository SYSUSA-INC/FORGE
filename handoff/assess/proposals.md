# Visual uniformity: Proposals, Solicitations, external review

Scope: /proposals, /proposals/[id] (+ compliance, outcome, reviews, reviews/[reviewId], sections, voices), /proposals/new, /solicitations, /solicitations/[id] (+ diff, verify), /solicitations/new, /review/[token]. Both themes were checked for every route. Code is origin/main (4a6f0b4). PR A (`/home/user/forge-ui` diff) and the accepted findings in `themeverdicts.txt` are taken as given and not repeated. Where a finding extends one of them, it says so.

Seed data limits: the compliance matrix has 0 items, there is one proposal with no section content, one review with no reviewers, and only one editor in the section. So compliance rows, the heatmap, key-date timelines, track-change marks and presence carets do not appear in the screenshots. I checked those parts in code only, and each finding says when that is the case.

---

## 1. Patterns

**Page header.** Every app route uses the shared `PageHeader` (eyebrow, title, subtitle, actions, meta tiles). Proposal sub-routes inherit it from `proposals/[id]/layout.tsx:52-90`, so all six tabs match. That layout then adds a second boxed strip, "● CURRENT STAGE · PINK TEAM" (`layout.tsx:92-110`). It repeats the STAGE meta tile directly above it and the Workflow panel on Overview, so the stage shows three times. The outlier is `/review/[token]`, which has its own `Brand()` and no PageHeader. That is acceptable for a public page, but its cards are a different system (finding 13). Secondary header actions use `aur-btn aur-btn-ghost` together, which renders a boxed button with muted text (already covered by the accepted secondary-button finding).

**Tabs and segmented filters.** The dominant pattern is the mono uppercase tab with a 2px `border-teal-400` underline (`ProposalTabs.tsx:30`, `ProposalsClient.tsx:246`), which the accepted tab finding already covers. The selected state of filters and toggles is drawn seven ways in this area (finding 10). `ProposalTabs` also puts the active mark on the wrong tab on review detail (finding 9).

**Tables and list rows.** List rows are boxed `rounded-* border border-layer/10 bg-layer/[0.02]` items inside a Panel. This covers proposals, sections, compliance items, reviews, requirements, verify, amendments, recent renders and Brain stats, and is covered by the accepted list-row finding. The true tables use hairline rows, which is correct: diff fields (`DiffView.tsx:208`), section coverage (`CoveragePanel.tsx:58`), the compliance heatmap and Extracted facts (`solicitations/[id]/page.tsx:619`). The heatmap's sticky column `bg-[#0d1117]` is already known.

**Status chips and badges.** There are two mechanisms. One is inline `style={{color, backgroundColor:`${c}1A`}}`, whose tint is invalid CSS today (known). The other is class chips such as `border-amber-400/40 bg-amber-400/10 text-amber-200`. Both use 9px mono (known). The real problem here is meaning: the same word or hue means different things on different pages. "In progress" is brass in some places and cobalt in others (finding 2). Colour-team names reuse the status hues (finding 3). "Not addressed" is red on one tile and muted everywhere else (finding 4). Categories borrow status hues (finding 12). A plain due date is red (finding 7). Severity maps (red/brass/muted in `ProposalScanPanel.tsx:39-43`, `PageBudgetRing.tsx:15-20` and `TonePanel`) and diff hues (insert green, delete red in `globals.css:495-511`, `DiffView`, `DraftPreview`, `SnapshotDiffViewer` and `TrackChangesSidebar`) are consistent with each other, which is good.

**Alerts, banners and notices.** The dominant pattern is `rounded-md border border-X/40 bg-X/10 px-3 py-2 font-mono text-[11px] text-X`, with rose for errors, emerald for success and amber for warnings. It is used the same way in about 30 places. The outliers are:
- `StubModeBanner`, a shared component that is fine.
- `ExportPanel.tsx:305`, a violet "ready" notice (finding 15).
- `ExportPanel.tsx:350`, a neutral stub notice (finding 15).
- The indigo "Instructions to reviewers" box (`reviews/[reviewId]/page.tsx:221`).
- The cobalt left-rule "Note from…" on the public page (`ReviewClient.tsx:133`), which is the same concept as the indigo box but drawn differently.
- The `rounded-xl` `-500/30` result cards on the public page (`ReviewClient.tsx:48,61`, `page.tsx:18`).

**Buttons and links.** `aur-btn-primary` is used for the main action on every route, and `aur-btn-danger` for Delete / Remove section / Cancel review. Font sizes are overridden on almost every button (`text-[10px]`, `[11px]`, `[12px]` or `text-sm`), so buttons come in four heights. The outliers are:
- `VerifyClient.tsx:100`, which uses `aur-btn-primary` as a *selected filter* (finding 10).
- The public page's `RecButton` (`ReviewClient.tsx:227-245`): `rounded-lg`, semibold, `/70` translucent text.
- Two full-width primaries side by side on /proposals/new (finding 18).

Inline links are `text-teal underline`, in mono for "View linked opportunity →", "Diff →" and "Q&A →". That is consistent.

**Form fields.** `aur-input` and `aur-label` are used everywhere. This is the most uniform element in the area. Checkbox accents vary: the native default (Resolved, reviewer pick), `accent-teal-400` (`CoveragePanel.tsx:85`) and `accent-indigo-400` (`AiAssistantPanel.tsx:1222`). This is minor.

**Empty states.** Most are `font-mono text-[11px] text-muted` one-liners ("No proposals match.", "No items match the current filters.", "No reviewers yet.", "No renders yet."). The Voices empty state is sans 13px (`VoicesClient`), which is the target pattern under the accepted mono-paragraph finding. No new issue.

**Cards and panels.** The shared `Panel` (paper, hairline, 5px) is used throughout. PR A removes the plum gradient stripe from "Round debrief" (`ReviewSummaryPanel.tsx:63`). The outliers are:
- The public review page cards: `rounded-xl` (9px) with a `bg-layer/[0.02]` wash (finding 13).
- `LauncherCard` with an accent-blue eyebrow (finding 18).
- Nested sub-boxes in the expanded section and in Customer history (known).

**Charts and graphs.**
- Compliance rollup: a gradient progress bar (known) and a local stat row (findings 4 and 11).
- Compliance heatmap: cells are invalid `${c}CC` (known), and "Not addressed" and "N/A" collapse to one grey after PR A (finding 5).
- `PageBudgetRing`: tokenised and consistent.
- `KeyDateTimeline`: colours dates by type (finding 12).

**Modals and menus.**
- `AutoDraftButton` uses `aur-card-elevated` correctly, but with a `bg-black/60` scrim (known).
- `SnapshotDiffViewer` and `SendForReviewButton` are known.
- The chat slash picker and mention picker are in-flow lists, but the same kind of picker has a cobalt border in one place and indigo in the other (`AiAssistantPanel.tsx:1403` vs `:1431`). This is minor.

**Stat tiles.** Header meta tiles use the shared MetaTile. Four local clones reimplement stat tiles with four different value styles and colour every value, including zeros (finding 11).

**Editor chrome.** The toolbar is mono buttons. The active formatting state is `bg-teal/15 text-teal`, the open state of the sidebar toggles is grey `bg-layer/10`, and the mode picker is green/brass/muted by mode (finding 10). The writing surface is a grey wash rather than paper (finding 16). Track-change marks are tokenised (green insert, red delete) and match every diff view. The comment anchor is `brass-400` (`globals.css:520`), but the comment composer and the sidebar quote use Tailwind-default `yellow-400` (`RichSectionEditor.tsx:609`, `CommentsSidebar.tsx:190`). That is in the inventory's tailwindDefaultFamily codemod, so it is not listed again. Presence carets have no CSS at all (finding 1). Section-row chips: review comments, unread chat and unsaved are brass (correct as attention), presence is emerald, and voice/house style is plum (finding 14).

---

## 2. Findings

### 1. Collaboration carets have no styling: when two people edit, the caret line is invisible and the name label breaks into the prose
**Severity:** high
**Pages / themes:** /proposals/[id]/sections, both themes, whenever two or more people have the same section open (checked in code; the screenshots have one editor).

**What you see:** `CollaborationCaret` is configured at `src/components/editor/RichSectionEditor.tsx:296-309`. Its default render (`node_modules/@tiptap/extension-collaboration-caret/dist/index.js:29-39`) creates `<span class="collaboration-carets__caret" style="border-color:…">` with a `<div class="collaboration-carets__label" style="background-color:…">` inside it. No stylesheet defines either class: `src/app/globals.css` is the only CSS file and has no `carets` rule, and the package ships no CSS. As a result:
- The caret has a border colour but no border width or style, so it does not draw.
- The label is an unpositioned block `div`, so a full-width coloured bar with the teammate's name drops into the middle of the paragraph.
- The label text inherits the editor ink. In dark that is white on pale brass or green from `PRESENCE_PALETTE` (about 2.2:1). In light it is slate on deep blue (`cobaltDeep`, about 3.2:1).

**Cause:** missing CSS for the classes the extension renders. The palette is at `src/lib/theme-colors.ts:114-127`.

**Fix:** pass a `render` to `CollaborationCaret.configure` that emits `<span class="collab-caret" style="border-color:${color}"><span class="collab-caret__label"><span class="aur-diamond" style="background:${color}"></span>${name}</span></span>`. Then add to `globals.css`:
- `.collab-caret { position:relative; margin:0 -1px; border-left:1.5px solid; border-right:0; pointer-events:none; word-break:normal }`
- `.collab-caret__label { @apply absolute -top-[1.5em] left-[-1px] inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-layer/15 bg-paper px-1.5 font-mono text-[10px] text-text; box-shadow: var(--shadow-float); user-select:none }`

The person's hue stays on the caret and the diamond, and the name is ink on paper, readable in both themes.

**Shared or local:** shared (the editor component plus globals.css).

### 2. "In progress" is brass for sections, reviews and compliance owners, but cobalt for running jobs and in DESIGN_SYSTEM rule 4
**Severity:** medium
**Pages / themes:** /proposals/[id] (Sections panel), /sections, /reviews, /reviews/[reviewId], /compliance (owner status); both themes.

**What you see:** the "IN PROGRESS" chip is brass on the Overview Sections panel, on every section row and on the review row and review header. The same page family shows running AI jobs in cobalt (Solicitation AI review "running", Auto-draft "running"). Rule 4 says cobalt is in progress and brass is attention or partial. A section that is merely being written therefore reads as needing attention.

**Cause:**
- `src/lib/proposal-types.ts:122` sets `in_progress: THEME.brass`.
- `src/lib/review-types.ts:73` sets `in_progress: THEME.brass`.
- `src/lib/compliance-types.ts:84` sets `{ key: "in_progress", …, color: THEME.brass }`.
- In contrast, `solicitations/[id]/SolicitationReviewPanel.tsx:31` uses `running: … text-cobalt` and `sections/ai/AutoDraftButton.tsx:18` uses `running: "text-teal"`.

**Fix:**
- `review-types.ts:73` and `compliance-types.ts:84`: `THEME.brass` → `THEME.cobalt` (rule 4 pairs in progress with assigned).
- `proposal-types.ts:122-123`: swap the two values, so `in_progress: THEME.cobalt` and `draft_complete: THEME.brass`. A draft that is done but not approved reads as "partial", and the five section states keep five distinct hues.

**Shared or local:** shared (status maps).

### 3. Colour-team names reuse the status hues, so "Red Team" reads as lost or failed and "Gold Team" as needing attention
**Severity:** medium
**Pages / themes:** /proposals (row chip), /proposals/[id]/* (current-stage strip and Workflow), /reviews, /reviews/[reviewId]; both themes.

**What you see:**
- "RED TEAM" is in the same red as "Lost", "Fail" and "SHALL".
- "GOLD TEAM" is the same brass as "In progress", "Conditional" and "Partial".
- "Green Team" is the same green as "Pass" and "Complete".

A review row can show "Red Team · In progress · Trending: Fail" as red, brass and red. Two of those hues are stage identity and one is a verdict, and nothing distinguishes them. The section editor's review-comment panel shows the same colour-team label as a neutral grey chip (`sections/ReviewCommentsPanel.tsx:65`), so the label also changes look between pages.

**Cause:**
- The stage and team maps: `src/lib/proposal-types.ts:19-46` (pink plum, red `THEME.red`, gold `THEME.brass`, white `THEME.text`) and `src/lib/review-types.ts:17-52`.
- Where they are rendered as coloured text or chips: `ProposalsClient.tsx:280-289`, `proposals/[id]/layout.tsx:100-109`, `StageAdvancePanel.tsx:69-75`, `reviews/page.tsx:117-125`, `reviews/[reviewId]/page.tsx:175-184`.

**Fix:** carry team identity on a swatch, not on the text. Render colour-team and stage tags as the accepted `.aur-tag` with an ink label and the team hue only on the leading diamond: `<span className="aur-tag text-text"><span className="aur-diamond" style={{background: teamColor}} />Red Team</span>`. Use the same tag at `ReviewCommentsPanel.tsx:65`. Keep coloured text for status and verdict chips only. Make it one shared `ColorTeamTag` used at the five sites above.

The alternative is to colour every in-flight review stage indigo per rule 4. This is the owner's call. Either way, document it in DESIGN_SYSTEM §4, which today only names plum for pink team.

**Shared or local:** shared.

### 4. Compliance "Not addressed" is red on the rollup but muted on chips, the heatmap legend and the capability matrix; the rollup also bypasses StatTile
**Severity:** medium
**Pages / themes:** /proposals/[id]/compliance; both themes. Visible in the screenshots: the rollup's "NOT ADDRESSED 0" is red, "PARTIAL 0" orange and "COMPLETE 0" mint.

**What you see:** the same status has two colours on one page. The rollup is also a fourth stat-tile style: `text-2xl font-semibold` coloured numerals, even at 0.

**Cause:**
- `proposals/[id]/compliance/page.tsx:156-160` passes `color="#F43F5E"` for Not addressed. Lines 149 and 154 pass Tailwind hexes, and the local `Stat` is defined at 231-252.
- The matrix status map has `not_addressed: THEME.muted` (`src/lib/compliance-types.ts:61`), and so does the capability matrix (`solicitations/[id]/SolicitationReviewPanel.tsx:40`).
- The accepted "Tailwind-default hex" fix maps these hexes to THEME.green, brass and red one-for-one, which keeps the drift. This finding extends that one.

**Fix:** replace the local `Stat` with the shared tile (`StatTile` / the post-fix MetaTile) with no accent, so figures are ink per the accepted StatTile finding. If one figure must carry colour, take it from `STATUS_COLORS` in compliance-types, so "Not addressed" uses `THEME.muted`, never a literal.

**Shared or local:** local call site; shared component.

### 5. After PR A, the compliance heatmap draws "Not addressed" and "N/A" in the same grey
**Severity:** medium
**Pages / themes:** /proposals/[id]/compliance → Heatmap; light identical, dark nearly so. Checked in code; there are no items in the seed data.

**What you see:** heatmap cells and the legend are colour-only squares (`ComplianceClient.tsx:1177-1216`). "Not addressed" is `THEME.muted` and "N/A" is `THEME.subtle` (`compliance-types.ts:61,64`). PR A sets light `--c-muted` to equal `--c-subtle` (both `98 107 125`). So once the `${c}CC` tint is fixed by the codemod, the two states render the same colour in light. In dark, 143 155 176 and 118 128 148 are hard to tell apart at 5×5px.

**Cause:** `compliance-types.ts:64` (`not_applicable: THEME.subtle`) combined with PR A `globals.css` `:root --c-muted`.

**Fix:** `compliance-types.ts:64` `THEME.subtle` → `THEME.faint` (170 180 200 light, 64 80 107 dark), which reads as "absent". Keep `not_addressed: THEME.muted`.

**Shared or local:** shared (status map).

### 6. Sections that were never scanned show a green "Healthy" dot
**Severity:** medium
**Pages / themes:** /proposals/[id]/sections; both themes. Visible: every row, including 0-word "NOT STARTED" sections, has a green dot before its title.

**What you see:** green means done or healthy, but these sections were never checked. The code comment even says "no scan yet, which we render the same neutral colour", yet the colour used is green.

**Cause:**
- `sections/SectionsClient.tsx:1024-1031` falls back to `: THEME.green` when `severity` is null.
- `sections/page.tsx:156` passes `scanSeverity: issue?.severity ?? null`. The value is null both when no scan row exists and when the scan found nothing.

**Fix:** pass `scanned: !!scanRow` from `sections/page.tsx` (from the query at :97-104). In `ScanDot`, render `THEME.faint` with the label "Not scanned yet" when `!scanned`, and `THEME.green` only for a scanned section with no issue.

**Shared or local:** local.

### 7. "Due" is red on the solicitation page and ink everywhere else; the key-date timeline is red for every proposal due date
**Severity:** medium
**Pages / themes:** /solicitations/[id]; both themes. Visible: "DUE 2026-11-10" in red, 20 days out. On /proposals/[id] the same "DUE 2026-11-11" tile is ink, as are the proposal list and the public review page.

**What you see:** red means blocked, lost or mandatory. Here a normal future date reads as an alarm, and it is red on every solicitation that has any due date.

**Cause:**
- `solicitations/[id]/page.tsx:308`: `accent: s.responseDueDate ? "rose" : undefined`.
- `solicitations/[id]/KeyDateTimeline.tsx:21-25`: `proposal_due: { color: THEME.red … }`, by type rather than proximity.

**Fix:**
- `page.tsx:308`: remove the accent (ink), or set it by proximity with `past ? "rose" : daysLeft <= 7 ? "gold" : undefined`, and use the same rule on `proposals/[id]/layout.tsx:73`.
- `KeyDateTimeline`: colour by proximity in the same way, not by type (see finding 12).

**Shared or local:** local (two sites).

### 8. Hard-coded white `rgba(...)` borders vanish on the light theme, so the outcome picker and workflow strip lose their boxes
**Severity:** medium
**Pages / themes:** /proposals/[id] (Workflow) and /proposals/[id]/outcome; light only. Visible:
- Light: LOST / NO BID / WITHDRAWN are bare text beside a boxed WON, and the Workflow strip has no boxes.
- Dark: all outcome options are boxed, and only the *unreached* stages (RED, GOLD, WHITE, SUB.) are boxed, so future stages look more "present" than the current one.

**Cause:**
- `proposals/[id]/outcome/OutcomeClient.tsx:237`: `"rgba(255, 255, 255, 0.04)"` and `:240`: `"1px solid rgba(255, 255, 255, 0.10)"`.
- `proposals/[id]/StageAdvancePanel.tsx:80`: `"rgba(255,255,255,0.1)"`.

Neither appears in color-inventory.json, which does not scan `rgba(`.

**Fix:**
- OutcomeClient: drop the inline unselected style and use classes, `border border-layer/10 bg-layer/[0.03] text-muted` (as the reason pills at :322 do). For the selected style, use `withAlpha()`.
- StageAdvancePanel:80: `withAlpha(THEME.layer, 0.1)`.
- Better still, give the Workflow strip the accepted aur-tag form: ink labels, a diamond on the current stage, and no boxes.

**Shared or local:** local.

### 9. The proposal tab bar highlights "Overview" on a review's detail page
**Severity:** medium
**Pages / themes:** /proposals/[id]/reviews/[reviewId]; both themes. Visible: OVERVIEW is underlined while the page shows a review.

**What you see:** the "on" mark points to the wrong place, so the page reads as a different section.

**Cause:** `proposals/[id]/ProposalTabs.tsx:18-19` uses `pathname?.endsWith(`/${t.key}`)`, and `/reviews/<id>` matches no tab, so the fallback is "overview".

**Fix:** `TABS.find((t) => t.key !== "overview" && pathname?.startsWith(`${basePath}/${t.key}`))?.key ?? "overview"`. Keep this logic when the accepted diamond-tab restyle lands.

**Shared or local:** local.

### 10. "Selected" is drawn seven ways in this area, including a green Edit mode and a solid primary button used as a filter
**Severity:** medium
**Pages / themes:** /proposals, /compliance, /sections, /outcome, /solicitations/[id]/diff, /verify; both themes.

This extends the accepted tab and segmented-filter finding, which names only `ProposalTabs.tsx:30` and `ProposalsClient.tsx:244-256`. These sites are not named there and do not share a component:
- **Teal border box:** `ProposalsClient.tsx:165-168,181-184` and `ComplianceClient.tsx:145-148,161-164` (`border-teal-400 bg-teal-400/10`).
- **Teal tint:** `DiffView.tsx:139-141` and the editor `ToolbarBtn` at `RichSectionEditor.tsx:929-931` (`bg-teal/15 text-teal`).
- **Grey fill:** the compliance List/Heatmap toggle `ComplianceClient.tsx:199-213` and the editor sidebar toggles `RichSectionEditor.tsx:596-600, 793-797, 888-892` (`bg-layer/10 text-text`). In one toolbar, "¶ on" is blue but "comments open" is grey.
- **Solid primary:** `VerifyClient.tsx:100` (`filter === f ? "aur-btn-primary" : "aur-btn-ghost"`). The action blue fill is used as a selected filter, so "To review (4)" looks like a button to press.
- **Status hue:** the editor mode picker `RichSectionEditor.tsx:743-766` (Edit active = `THEME.green`, which reads as "done"), `OutcomeClient.tsx:232-240`, and the per-status tones on `DiffView.tsx:144-150`.
- **Indigo:** `SectionsClient.tsx:897-899` (Draft / Edits preview).
- **Teal pill:** `OutcomeClient.tsx:319-323` (pill shape already known).

**Fix:** build one shared `Segmented` / `FilterChip` (and editor `ToolbarToggle`) on the accepted tab spec: `text-text` with a leading `aur-diamond` when active, `text-muted hover:text-text` otherwise, and `aria-pressed`. Replace the sites above with it.
- Editor mode: use the same selected treatment for Edit and View, and keep brass only for Suggest, since it warns that edits are recorded.
- Verify: `aur-btn-ghost` + diamond instead of `aur-btn-primary`.

**Shared or local:** shared.

### 11. Four local stat-tile clones will not follow the shared StatTile fix, and they colour every figure, zeros included
**Severity:** medium
**Pages / themes:** /proposals/[id] (Brain mining), /compliance, /solicitations/[id] (Customer history), /solicitations/[id]/diff; both themes. Visible: the compliance and diff summaries show coloured 0s (green "ADDED 0", red "REMOVED 0", orange "PARTIAL 0").

**What you see:** each clone has a different value style:
- `compliance/page.tsx:231-252`: `aur-card`, `text-2xl font-semibold`, hex colours.
- `diff/DiffView.tsx:176-205` (`SummaryCell`): boxed `bg-layer/[0.02]`, `text-xl font-semibold`, THEME colours.
- `solicitations/[id]/CustomerHistoryPanel.tsx:243-268`: `text-[18px] font-semibold`, emerald/amber/rose classes.
- `proposals/[id]/BrainMinePanel.tsx:167-189`: 9px label, 12px **mono** value.

The header MetaTiles on the same pages are 30px regular ink. The pre-flight counts also colour zeros (`ComplianceClient.tsx:1297` `text-amber-200`, `:1301` `text-teal-300`).

**Cause:** the local `Stat` / `SummaryCell` components listed above.

**Fix:** replace all four with the shared `StatTile`, or a `dense` variant of it, after the accepted hairline-top / ink-figure change. Drop the colour props, and keep `text-rose` only for a non-zero error count. At `ComplianceClient.tsx:1297,1301` use `text-text`.

**Shared or local:** shared component; local call sites.

### 12. Category labels borrow the status hues: compliance category, evidence kind and key-date type
**Severity:** medium
**Pages / themes:** /proposals/[id]/compliance (every item row, the category filter dots and AutoMap/EvidenceDock) and /solicitations/[id] (Key dates); both themes. Checked in code; there are no items or key dates in the seed data.

**What you see:** each row shows a category chip in a status hue:
- Section L is plum (pink team).
- Section M is brass (attention).
- Section C is cobalt (in progress).
- FAR is indigo (review).

Evidence kinds are green, indigo and brass. Key-date types use six hues, from red for proposal due to green for expected award. On a compliance row, a brass "SECTION M" chip sits beside a brass "PARTIAL" chip and means something unrelated.

**Cause:**
- `src/lib/compliance-types.ts:14-43`, rendered at `ComplianceClient.tsx:767-775` and the dots at `:166-169`.
- `compliance/EvidenceDock.tsx:21-25`.
- `solicitations/[id]/KeyDateTimeline.tsx:17-60`.

**Fix:** categories carry no hue. Render them as `aur-tag text-muted`, an ink or mono label with no tint, and drop the filter dot. For KeyDateTimeline, colour by proximity, not type: past is `muted`, 7 days or fewer is `brass`, otherwise `text`. This extends the accepted "plum and indigo as general accents" finding to these maps.

**Shared or local:** shared (type maps).

### 13. The external reviewer page uses a different card system from the app
**Severity:** medium
**Pages / themes:** /review/[token]; both themes. Visible: the cards have a 9px radius and, in light, a grey wash. The title and "Your recommendation" are semibold. The three recommendation buttons are `rounded-lg` with faded text.

**What you see:** the only FORGE screen an outside reviewer sees does not look like the app: compare `Panel` on paper with a 5px corner and a 400-weight title. PR A fixes only the brand mark.

**Cause:**
- `src/app/review/[token]/ReviewClient.tsx:97,144`: `rounded-xl border border-layer/10 bg-layer/[0.02] p-5`.
- `:48,:61` and `page.tsx:18`: `rounded-xl border-*-500/30 bg-*-500/5` result cards.
- `:103,:145`: `font-semibold` headings.
- `:227-245` (`RecButton`): `rounded-lg … font-semibold`, inactive text at `text-*-300/70`.
- `:133`: a cobalt left-rule "Note from…" where the in-app equivalent, "Instructions to reviewers", is an indigo box (`reviews/[reviewId]/page.tsx:221`).

**Fix:**
- Cards: `aur-card p-5`.
- Result cards: `aur-card p-6`, with the title in `text-gold` / `text-emerald` / `text-rose` and `font-normal tracking-title` (no tinted box, matching the accepted Panel eyebrow-tone rule).
- Headings: `font-normal tracking-title`.
- RecButton: `rounded` (3px), `font-medium`, and inactive text at full `text-*-300` (drop `/70`).
- Note: the same `border-indigo-400/20 bg-indigo-400/5` treatment as "Instructions to reviewers", or both as a hairline-topped block with an `aur-label`.

**Shared or local:** local.

### 14. Plum is used for voice and house-style chips, next to the plum Pink Team stage
**Severity:** low
**Pages / themes:** /proposals/[id]/sections; both themes. Checked in code; the seed sections have no authors.

**What you see:** "✦ in Avery's voice" and "✦ house style" chips are plum. The Voice check panel's no-issue frame is plum. During Pink Team the stage strip above is also plum. This extends the accepted plum/indigo finding, which does not list these sites.

**Cause:** `sections/SectionsClient.tsx:773,779` (`border-plum-400/40 bg-plum-400/10 text-plum-300`) and `sections/ai/VoiceCheckPanel.tsx:68-69` (fallback `border-plum-400/30 bg-plum-400/5`, `text-plum-300`).

**Fix:**
- Chips: `aur-tag text-muted` (or `text-indigo-300` if they should read as AI settings).
- VoiceCheckPanel no-issue state: `border-layer/10 bg-bone` and `text-muted`.

**Shared or local:** local.

### 15. The Export panel shows the same state in different colours
**Severity:** low
**Pages / themes:** /proposals/[id] (Export); both themes.

**What you see:**
- "Ready" is emerald for PDF and DOCX (`pdf/ExportPanel.tsx:273,290`) but violet for the crosswalk (`:305,:316`).
- "Stub" is brass in `StubModeBanner` (`:145,:155`) and the DOCX→PDF notice (`:326-328`), neutral grey at `:350`, and red `text-rose` in Recent renders (`:389`).

**Fix:**
- `:305` and `:316` → the emerald classes used at `:273`.
- `:350` → `border-gold/40 bg-gold/10 text-gold` (or `<StubModeBanner variant="inline" />`).
- `:389` `text-rose` → `text-gold`.

**Shared or local:** local.

### 16. The section editor's writing surface is a grey wash, not paper
**Severity:** low
**Pages / themes:** /proposals/[id]/sections; mainly light (a grey well inside a grey section card inside a white Panel).

**What you see:** proposal prose, the "hero" per DESIGN_SYSTEM §1, sits on grey. Every other text input in the app (`aur-input`) is paper.

**Cause:** `src/components/editor/RichSectionEditor.tsx:364` uses `bg-layer/[0.03] … focus:border-teal/60 focus:bg-layer/[0.05]`.

**Fix:** `border border-layer/15 bg-paper … focus:border-cobalt/70`, matching `.aur-input`, and drop the focus background change.

**Shared or local:** shared (editor).

### 17. The same section title is mono on Overview and sans on the Sections tab
**Severity:** low
**Pages / themes:** /proposals/[id] vs /proposals/[id]/sections; both themes. Visible: "Executive summary" is 12px Geist Mono in the Overview Sections panel and 14px Host Grotesk in the editor list.

**Cause:** `proposals/[id]/page.tsx:151`: `font-mono text-[12px] text-text`.

**Fix:** `font-display text-[14px] font-medium text-text`, as at `SectionsClient.tsx:738`.

**Shared or local:** local.

### 18. /proposals/new has two equal primary buttons, and its card eyebrows are accent blue
**Severity:** low
**Pages / themes:** /proposals/new; both themes. Visible: full-width "Continue →" and "Start fresh →" side by side in action blue, with "PATH 1" and "PATH 2" eyebrows in blue.

**Cause:** `proposals/new/page.tsx:72` uses `aur-btn aur-btn-primary` for the second path, and `proposals/new/LauncherCard.tsx:19` uses `text-teal`, while Panel eyebrows are `text-muted`.

**Fix:**
- Path 2 button: `aur-btn` (light), so one primary per view.
- `LauncherCard.tsx:19`: `text-teal` → `text-muted`.

**Shared or local:** local.

### 19. The Raw text panel prints flush against its border
**Severity:** low
**Pages / themes:** /solicitations/[id]; both themes. Visible: "SECTION C – STATEMENT OF WORK…" touches the panel's left edge.

**Cause:** `solicitations/[id]/page.tsx:606` uses `<Panel … dense>`, which sets the body to `p-0` (`Panel.tsx:63`), and the `<pre>` at `:607` has no padding.

**Fix:** add `px-5 py-3` to the `<pre>`, or drop `dense`.

**Shared or local:** local.

### 20. An off-palette cyan chip that the inventory missed (8-digit hex)
**Severity:** low
**Pages / themes:** /solicitations/[id] (requirements merged from companion documents, such as the "PWS" source chip); both themes.

**Cause:** `solicitations/[id]/page.tsx:555-556` uses `backgroundColor: "#9BC9D91A"` and `border: "1px solid #9BC9D930"`. color-inventory.json lists no hex literal for this file, because its pattern matches 6-digit hex only.

**Fix:** `className="aur-tag text-muted"` (or `border border-layer/15 bg-layer/5 text-muted`) and remove the inline style. Widen the inventory or codemod regex to `#[0-9A-Fa-f]{8}`.

**Shared or local:** local.

---

**Counts:** high 1 · medium 12 · low 7 (20 findings).

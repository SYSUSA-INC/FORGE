# Capture + Intelligence + CRM — visual uniformity assessment

Scope: /opportunities (+ [id], activity, competitors, evaluation, similar, import, import/ebuy, import/gsa, new, scout), /intelligence (+ awards, firms, losses, saved-searches, watchlist), /companies (+ [id], new, search), /contacts (+ [id]). Both themes reviewed for every route. Code read at origin/main (`/home/user/FORGE`; the checkout's one extra commit touches only admin files, so line numbers match origin/main). PR A (`/home/user/forge-ui`) touches none of this area's files; where PR A changes a shared token or component, that is noted.

Not repeated here (already in themeverdicts.txt or the inventory): stage hues S1–S7 / brass due dates / StageWidget `border-2` and invalid tints; hex-alpha on THEME strings (OpportunitiesClient:251, [id]/layout:95, activity/page:85, Companies chips); OpportunityTabs + Watchlist/SavedSearches tabs; boxed list rows; tinted 9px chips; mono running text (SamKeyNotice, PwinPanel, provider notes, empty states); EvaluationForm.tsx:47 and OutcomeInsightsPanel.tsx:135,155 Tailwind hexes; ImportClient.tsx:238,271 pills; SendForReviewButton dark dialog; MetaTile multi-hue numerals and `padStart` (Scout "00"); outline secondary buttons; dark `--c-subtle`; `var(--text)`/`text-foreground`; semibold/bold and sub-10px mono.

---

## 1. Patterns

**Page header.** Dominant: `PageHeader` with eyebrow + 400-weight title + subtitle + right-aligned actions (21 of 22 routes). Outlier: **/intelligence renders no PageHeader at all** (`intelligence/page.tsx:50-103`), so the FORGE Brain landing starts with a bare panel, and its only action ("Cross-loss patterns →") floats alone above a panel (`:87-95`). Eyebrow text for the one nav group "Platform Intelligence" (`src/lib/nav-workspaces.ts:118`) appears as "Intel" (companies/*), "Intelligence · BD" (awards/firms/watchlist/saved-searches), "Platform intelligence · Loss intelligence" (`losses/page.tsx:46`). Back actions use seven labels and two sizes (finding 11).

**Tabs / segmented filters.** Opportunity tabs and Watchlist/SavedSearches tabs are known. Same pattern, not listed in the known finding: the Companies relationship filter (`CompaniesClient.tsx:103-134`, `rounded-md border … border-teal-400 bg-teal-400/10`), so add it to the planned tab fix. The StageWidget grid doubles as a filter (known).

**Tables and list rows.** Correct in-area model: Contacts (`ContactsClient.tsx:178`, `divide-y divide-layer/5`, no per-row box) and contact History (`ContactDetailClient.tsx:127`). Boxed rows (the known pattern) appear at OpportunitiesClient.tsx:237, CompaniesClient.tsx:186, ProviderStatusPanel.tsx:58, AgencyContactsPanel.tsx:44, activity/page.tsx:72, losses/page.tsx:110, ScoutClient.tsx:340, OpportunityDocsAndAIClient.tsx:107. Real tables come in three header styles: SectionSignalsPanel.tsx:77 (mono 10px, `tracking-label`, `text-subtle`, 13px body cells; closest to correct); losses/page.tsx:164-172 (everything mono 11px, semibold heads); ContactsImportPanel.tsx:239 (9px heads on a sticky `bg-canvas`, see finding 14). Opportunity and company rows label their columns in mixed-case mono ("Value", "Due", "Location") where other labels are uppercase `aur-label`.

**Status chips / badges.** Opportunity stage chips come from one map (`opportunity-types.ts`), so they match the Command Center and Pipeline. They do **not** match proposals today: opportunity "Submitted" is `plumDeep` (`opportunity-types.ts:58`), proposal "Submitted" is `cobalt` (`proposal-types.ts:50`). The planned S1–S7 → cobalt fix resolves that. New drifts in this area: company relationships and activity kinds reuse status hues as category colours (finding 2); warmth "hot" is red (finding 3); "Watch" is blue in Scout but brass in the brief and evaluation (finding 4); stub mode is red on /intelligence but brass everywhere else (finding 7). Consistent and correct: past-due/overdue red (StageWidget.tsx:100, NextTouchBadge `ContactsClient.tsx:37`), due-soon brass (`:38`), Incumbent brass (CompetitorsClient.tsx:231), required `*` red.

**Alerts / banners / notices.** Dominant error alert (about 20 sites): `rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose` (e.g. OpportunityForm.tsx:333, ImportClient.tsx:334). Variant: `rounded border-rose/30 … text-[12px] text-rose-200` (SimilarAwardsClient.tsx:99, WatchlistClient.tsx:62, FirmsSearchClient.tsx:329, SavedSearchesClient.tsx:53). `SamKeyNotice` is the only shared notice (rose for "off", gold for degraded, used correctly on Import and Scout). similar/page.tsx:137-138 puts a rose message in a `accent="hazard"` panel, so with PR A the eyebrow is brass while the text is red. A generic `Notice tone=` component (SamKeyNotice generalised) would collapse the roughly 25 hand-rolled boxes.

**Buttons and links.** Primary (`aur-btn-primary`) and danger (`aur-btn-danger`) are used correctly on opportunity and company detail. Outliers: the contact Delete is a ghost button with red text (finding 8); primaries come in four sizes (finding 12). Inline links use four colours (finding 9). Panel-header action buttons wrap onto two lines in narrow side panels (finding 12).

**Form fields.** Consistent: `aur-label` + `aur-input` in OpportunityForm, CompanyForm, ContactForm, GSA review, Competitors and Activity. Minor outliers: Scout's NAICS input is `font-mono text-sm` (ScoutClient.tsx, the NAICS field) while Import's NAICS input is sans. Contact "Log a touch" fields are shrunk to `text-[12px]` (ContactDetailClient.tsx:94-115) beside the 14px Details form on the same screen. Checkbox labels take four looks: mono-uppercase ImportClient "GSA-issued only", body-13 Scout "Run nightly", a bordered box for Competitors "Is incumbent", mono-11 Contacts "Follow-up owed". The eBuy/GSA paste textareas are mono, which is acceptable for raw pasted text.

**Empty states.** Four renderings (finding 10): a one-line mono div, a dashed mono box, a body paragraph, and the mono "Preview feature" panels. The correct one is the body paragraph (`losses/page.tsx:88`).

**Cards / panels.** `Panel` (paper + hairline) is used everywhere. Outliers: Panel-in-Panel-in-box on Import (finding 5); a boxed add-form inside the Competitors panel (`CompetitorsClient.tsx:98`, while Activity and Contact detail give the form its own Panel); and a boxed "Current stage" / relationship band that repeats the meta tile (finding 13).

**Charts / graphs.** Only PwinPanel factor bars are visible (green positive / red negative on a `bg-layer/[0.06]` track; PwinPanel.tsx:107-111). They are coherent and match the delta colouring. OutcomeInsightsPanel bars use Tailwind hexes (known).

**Modals / menus.** Only the Send-for-review dialog (known, high). Deletes use `window.confirm`.

**Stat tiles.** `PageHeader meta` on every list and detail page. Page-level accent choices that will survive a "keep rose for error counts" MetaTile fix and are semantically wrong: Companies "Competitors" rose (`CompaniesClient.tsx:97`), contact "Warmth" rose at 70+ (`ContactDetailClient.tsx:83`); see findings 2 and 3. The opportunity "PWin" tile is green/brass (`[id]/layout.tsx:74`) while the same page's PwinPanel shows its PWin in ink. The planned "value always text-text" fix covers this.

---

## 2. Findings

### 1. **FORGE Brain (/intelligence) has no page header** · medium
- **Pages / themes:** /intelligence, both themes.
- **What you see:** Every other route in the area opens with ◆ eyebrow, a large title and a subtitle. /intelligence opens straight into the "Pipeline brief" panel at the top of the content column, with no title naming the page. Its one action, "Cross-loss patterns →", sits alone, right-aligned, above the Outcome insights panel.
- **Cause:** `src/app/(app)/intelligence/page.tsx:50-103` returns sections only; it never imports or renders `PageHeader`. The action is a stray wrapper at `:87-95`.
- **Fix:** Add `<PageHeader eyebrow="Platform Intelligence" title="FORGE Brain" subtitle="…" actions={<Link href="/intelligence/losses" className="aur-btn aur-btn-ghost">Cross-loss patterns →</Link>} />` as the first child, and delete the `<div className="mb-3 flex items-center justify-end">` wrapper at `:88-95`. The title "FORGE Brain" is the nav label (`nav-workspaces.ts:124`) and the losses back link's label.
- **Shared or local:** Local.

### 2. **Company relationships (and activity kinds) are painted in status colours** · medium
- **Pages / themes:** /companies and /companies/[id], both themes. The activity timeline on /opportunities/[id]/activity is covered by code only (no events in the screenshots).
- **What you see:** A company tagged "Competitor" gets a red chip, a red dot in the filter, a red dot plus red chip in the detail band, and a red "Competitors 1" numeral. Red means lost/blocked everywhere else. The map also gives Prime green (= won/done), Subcontractor indigo (= analysis/review), Teaming partner plum (= pink team) and Customer cobalt (= in progress). That is a second categorical palette built from the status hues, the same mistake as the known six-hue stage sequence but in a different file. The activity-kind map does the same: "action" green, "competitor update" plum, "stage change"/"owner change" indigo, "gate decision" brass.
- **Cause:**
  - `src/lib/company-types.ts:13,19,25,31,37,43` (THEME.cobalt, green, indigo, red, plum, muted).
  - Consumed at `companies/CompaniesClient.tsx:127-130` (filter dot) and `:210-219` (row chip), and `companies/[id]/page.tsx:71-84` (band).
  - Tile accents `CompaniesClient.tsx:86` (`"emerald"` for Primes) and `:97` (`"rose"` for Competitors).
  - `src/lib/evaluation-types.ts:56-65` (ACTIVITY_KIND_COLORS), consumed at `opportunities/[id]/activity/page.tsx:74-90`.
- **Fix:** A relationship or activity kind is a category, not a status, so drop the hue. Set every `RELATIONSHIPS[].color` and every `ACTIVITY_KIND_COLORS` value to `THEME.subtle`, or remove the field and render the label as the planned `.aur-tag` with no tone marker. Remove `accent` at CompaniesClient.tsx:86 and :97. The label text already says "Competitor".
- **Shared or local:** Shared (two lib maps feed every consumer).

### 3. **Relationship warmth: "hot" (the best state) is red, "cool" is indigo** · medium
- **Pages / themes:** /contacts, /contacts/[id], and the "Who we know at…" panel on /opportunities/[id]; both themes. Every seeded contact is "COLD 0", so the screenshots show only the muted state; the red is verified in code.
- **What you see (from code):** A contact you speak to often shows a red "HOT 82" chip. On the same row a follow-up that is late shows a red "OVERDUE" badge (`ContactsClient.tsx:37`). The two reds mean opposite things. "Cool" uses indigo (the review hue). The contact page's Warmth stat tile turns red at 70 or more.
- **Cause:** `src/app/(app)/contacts/WarmthChip.tsx:4-7` (`hot: border-rose/40 bg-rose/10 text-rose`, `cool: … text-indigo-300`); `contacts/[id]/ContactDetailClient.tsx:83` (`accent: warmth >= 70 ? "rose" : warmth >= 40 ? "gold"`).
- **Fix:**
  - WarmthChip TONE: hot `border-emerald/40 bg-emerald/10 text-emerald`, warm keeps brass (partial), cool and cold `border-layer/10 bg-layer/5 text-muted`. Once the planned `.aur-tag` lands, the same tones move to the marker.
  - ContactDetailClient.tsx:83: `warmth >= 70 ? "emerald" : warmth >= 40 ? "gold" : undefined`. This mirrors the PWin tile thresholds (`[id]/layout.tsx:74`).
- **Shared or local:** Shared (WarmthChip is used by ContactsClient, ContactDetailClient and AgencyContactsPanel).

### 4. **The same bid verdict "Watch" is blue in Scout and brass elsewhere; Scout paints "due soon" red** · medium
- **Pages / themes:** /opportunities/scout (finds list), /opportunities/[id] (AI pursuit brief), /opportunities/[id]/evaluation; both themes. There are no finds and no brief in the screenshots, so this is verified in code.
- **What you see (from code):** Three surfaces give the same three-way verdict (Pursue / Watch / Skip or No-bid). Pursue is green and Skip/No-bid red on all three. "Watch" is cobalt (the action/in-progress blue) on Scout but brass on the brief and on the evaluation rollup. Scout also turns a due date red when it is fewer than 5 days away. Elsewhere red is reserved for overdue/past due, and upcoming is brass (NextTouchBadge; the planned StageWidget rule). Scout's "Expiring award" chip is indigo (review hue) for what is an attention signal.
- **Cause:**
  - `opportunities/scout/ScoutClient.tsx:265` (`watch: "border-cobalt/40 bg-cobalt/10 text-text"`) vs `opportunities/[id]/ai/OpportunityBriefPanel.tsx:105` (`border-amber-500/40 bg-amber-500/10 text-amber-200`) and `evaluation/EvaluationForm.tsx:45-47` ("Watch" → amber).
  - `ScoutClient.tsx:351` (`c.daysToDue < 5 ? "text-rose-300"`).
  - `ScoutClient.tsx:344` (`border-violet/40 bg-violet/10`).
- **Fix:**
  - ScoutClient.tsx:265 → `border-gold/40 bg-gold/10 text-gold`.
  - :351 → `c.daysToDue < 0 ? "text-rose" : c.daysToDue <= 7 ? "text-gold" : "text-muted"`.
  - :344 → `border-gold/40 bg-gold/10 text-gold` (or a neutral tag).
  - When EvaluationForm.tsx:47's hexes are codemodded, map "Watch" to `THEME.brass` so all three agree.
  - Better: one `VERDICT_TONE` map in `src/lib/brief-logic.ts` used by all three.
- **Shared or local:** Shared, if the map is centralised.

### 5. **Import page nests a panel inside a panel inside a box** · medium
- **Pages / themes:** /opportunities/import, both themes. This is the default state for a new org with no NAICS codes, as in the screenshots.
- **What you see:** The "No NAICS codes configured" card wraps a second card ("Active solicitations / Search SAM.gov"), which wraps a third bordered box ("GSA-issued only …"). That is three nested borders, while "hairlines not boxes" allows one card. On the Competitors tab the add-form is likewise a filled box inside the panel, while the sibling Activity tab and Contact detail give the form its own Panel.
- **Cause:** `opportunities/import/page.tsx:76-89` wraps `<ImportClient>` in `<Panel title="No NAICS codes configured">`, and ImportClient renders its own `<Panel title="Search SAM.gov">` (`ImportClient.tsx:210`) with a boxed block at `:211` (`mb-3 rounded-lg border border-layer/10 bg-layer/[0.015] p-3`). Competitors: `[id]/competitors/CompetitorsClient.tsx:98` (`rounded-lg border border-layer/10 bg-layer/[0.02] p-3`).
- **Fix:**
  - import/page.tsx: render the no-NAICS message as a one-line notice above an unwrapped client: `<div role="status" className="mb-4 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 font-body text-[13px] text-gold">No NAICS codes yet — add them in <Link href="/settings" className="underline">Settings → Classification</Link>, or search by keyword below.</div>`, then `<ImportClient defaultNaics={naics} autoSearch={naics.length > 0 && autoSearch} />`. A generalised SamKeyNotice is the shared home for this.
  - ImportClient.tsx:211 → `mb-4 border-b border-layer/10 pb-4`.
  - CompetitorsClient.tsx:98 → `grid … border-b border-layer/10 pb-4 md:grid-cols-2` (no rounded, bg or side borders).
- **Shared or local:** Local.

### 6. **Opportunity values printed as raw digits next to formatted ones** · medium
- **Pages / themes:** /opportunities (list rows), /opportunities/[id] and all its tabs (Value tile); both themes.
- **What you see:** On /opportunities the stage tiles read "$600k – $800k", and directly below them the row for the same opportunity reads "600000 – 800000". The detail header tile reads "4500000 – 6200000" in 30px type. Two number formats for one field on one screen.
- **Cause:** `opportunities/OpportunitiesClient.tsx:228-231` and `opportunities/[id]/layout.tsx:64-68` interpolate the free-text `valueLow`/`valueHigh` strings. The tiles go through `formatDollarRange` (`OpportunitiesClient.tsx:182`, `src/lib/money.ts:42`).
- **Fix:** At both sites use `formatDollarRange(parseDollars(o.valueLow), parseDollars(o.valueHigh)) ?? "—"` (import from `@/lib/money`). Same pattern outside the area at `src/app/review/[token]/ReviewClient.tsx:91-92`.
- **Shared or local:** Local (shared helper already exists).

### 7. **Stub mode is red on /intelligence and brass everywhere else** · medium
- **Pages / themes:** /intelligence, both themes (the "STUB (NO AI)" chip in the AI provider panel header).
- **What you see:** A red, danger-styled chip for the stub provider. `StubModeBanner`, the "unified stub-mode indicator", is brass, and its own comment says amber "signals 'degraded but functional', not 'error'". It is used by nine surfaces, including PipelineBriefPanel on this same page and both paste-import pages.
- **Cause:** `intelligence/ProviderStatusPanel.tsx:34-42` (`active.name === "stub" ? "border-rose/40 bg-rose/10 text-rose"`); compare `src/components/ui/StubModeBanner.tsx:12-14,47-53`.
- **Fix:** In ProviderStatusPanel actions, render `active.name === "stub" ? <StubModeBanner variant="pill" /> : <span className="… border-emerald/40 bg-emerald/10 text-emerald">{label}</span>`.
- **Shared or local:** Shared (reuse the existing component).

### 8. **Contact "Delete" is drawn differently from every other record delete** · low
- **Pages / themes:** /contacts/[id] vs /opportunities/[id] and /companies/[id]; both themes.
- **What you see:** Opportunity and company Delete are the tinted red danger button. Contact Delete is a neutral bordered button with red text (light), or red text on the dark wash (dark).
- **Cause:** `contacts/[id]/ContactDetailClient.tsx:77` (`aur-btn aur-btn-ghost text-rose-300`) vs `opportunities/[id]/DeleteOpportunityButton.tsx:35` and `companies/[id]/CompanyDetailActions.tsx:56` (`aur-btn aur-btn-danger`). The same ghost-plus-red pattern is at `intelligence/watchlist/WatchlistClient.tsx:176` (hidden behind the feature flag).
- **Fix:** `className="aur-btn aur-btn-danger"` at ContactDetailClient.tsx:77 and WatchlistClient.tsx:176 (drop `uppercase tracking-label text-[10px]` there too).
- **Shared or local:** Local.

### 9. **Inline links use four colours; CRM links are indigo, and an env var is styled like a link** · low
- **Pages / themes:** /contacts/[id], /opportunities/[id] (contacts panel empty state), /intelligence, /opportunities/import; both themes.
- **What you see:** Link colours vary across the area:
  - Indigo-300 (the review hue) in the CRM pieces.
  - `text-teal` (cobalt-500) on Import's "Settings → Classification".
  - `text-cobalt` mono on "Full results →".
  - `text-cobalt-300` on the pipeline-drill banner.

  On /intelligence the env var `AI_PROVIDER` is blue and reads as a link, while all seven other `<code>` tokens in the area are neutral `bg-layer/5` chips.
- **Cause:**
  - Indigo-300: `ContactDetailClient.tsx:135`, `contacts/AgencyHistoryPanel.tsx:63,149`, `src/components/crm/AgencyContactsPanel.tsx:37`.
  - Teal: `import/page.tsx:83`.
  - Cobalt: `OpportunityDocsAndAIClient.tsx:218`.
  - Cobalt-300: `OpportunitiesClient.tsx:123`.
  - Code token: `intelligence/ProviderStatusPanel.tsx:49` (`<code className="text-teal">`).
- **Fix:** All inline links → `text-accent hover:underline` (token added by PR A; `text-cobalt` until it merges). ProviderStatusPanel.tsx:49 → `<code className="rounded bg-layer/5 px-1.5 py-0.5">`.
- **Shared or local:** Local (class swaps).

### 10. **Empty states drawn four ways** · low
- **Pages / themes:** /opportunities/[id]/activity, /competitors, /intelligence (Section signals), /intelligence/losses, /contacts/[id]; both themes.
- **What you see:**
  - Activity: a single mono line floating in a tall empty panel.
  - Competitors and Section signals: a dashed-border mono box (Section signals' is centred).
  - Losses and Contact history: a body-text paragraph.
  - Awards, firms, watchlist, saved-searches and similar: mono 12px "Preview feature" panels.

  The mono font part is the known finding. The dashed box and centring are an extra shape that appears nowhere else in the system.
- **Cause:**
  - Mono line: `activity/page.tsx:59`, `OpportunitiesClient.tsx:212`, `CompaniesClient.tsx:150`.
  - Dashed box: `CompetitorsClient.tsx:37`, `SectionSignalsPanel.tsx:67`.
  - Body paragraph: `losses/page.tsx:88`, `ContactDetailClient.tsx:125`.
- **Fix:** One rendering, `<p className="font-body text-[13px] leading-[1.5] text-muted">` with no border, box or centring. Drop `rounded-md border border-dashed border-layer/10 … text-center` at the two dashed sites. Optionally add `.aur-empty` to globals.css so new code has a name for it.
- **Shared or local:** Shared (utility class), with local swaps.

### 11. **Wayfinding text varies: back links in seven spellings and two sizes, the eyebrow in three names, and eBuy/GSA twin pages laid out differently** · low
- **Pages / themes:** all detail and sub-pages in the area; both themes.
- **What you see:**
  - Back actions read differently on each page:
    - "Back" (`[id]/layout.tsx:55`, `companies/[id]/page.tsx:50`)
    - "← All contacts" (`ContactDetailClient.tsx:75`)
    - "← Back to import" (`import/gsa/page.tsx:25`)
    - "Back to opportunities" (`import/page.tsx:69`)
    - "Back to companies" (`companies/search/page.tsx:42`)
    - "← Intelligence" (`awards/page.tsx:28`, also firms, watchlist, saved-searches)
    - "← FORGE Brain" at `text-[11px]`, visibly smaller (`losses/page.tsx:50`).
  - eBuy puts its back link inside the step-1 panel header and "Extract with AI" under the textarea (`EbuyPasteClient.tsx:98-104,121-128`). Its twin, GSA, puts the back link in the page header and Extract in the panel header (`gsa/page.tsx:24`, `GsaPasteClient.tsx:163-170`).
  - Eyebrows for the "Platform Intelligence" nav group: "Intel", "Intelligence · BD", "Platform intelligence · Loss intelligence".
- **Fix:**
  - Back actions: `← <parent page name>` in PageHeader actions, using the planned `.aur-link`. "← FORGE Brain" on all intelligence sub-pages (matching nav). Drop `text-[11px]` at losses/page.tsx:50.
  - eBuy: move "Back to SAM.gov import" to `page.tsx` PageHeader actions, and move Extract into the step-1 Panel `actions`, matching GSA.
  - Eyebrows: "Platform Intelligence" for companies/*, "Platform Intelligence · BD" for awards/firms/watchlist/saved-searches, and "Platform Intelligence · Loss intelligence" (capital I) for losses, matching `reports/page.tsx:26`.
- **Shared or local:** Local.

### 12. **Primary buttons in four sizes; panel-header actions wrap to two lines** · low
- **Pages / themes:** /contacts/[id] vs /companies/[id]; /opportunities/[id]; /intelligence/losses; /opportunities/[id]/activity; both themes.
- **What you see:**
  - "Save changes" on a contact is a small 12px button, while "Save changes" on a company or opportunity is a 40px, 14px button.
  - "Add to timeline" and "Record decision" stretch full width; other form submits are content-width.
  - Companies "Search SAM.gov" is wider again.
  - In the 360px side column, "All contacts" (opportunity overview) and "Explain patterns" (losses) break onto two lines inside their buttons.
- **Cause:**
  - Size overrides at each call site:
    - `py-2.5 text-sm`: OpportunityForm.tsx:342, CompanyForm.tsx:275, EvaluationForm.tsx:147, CompetitorsClient.tsx:167, AddActivityForm.tsx:83, GateDecisionPanel.tsx:110.
    - `px-5 py-2.5`: SearchClient.tsx:161.
    - `text-[12px]`: ContactForm.tsx:95, ContactDetailClient.tsx:116, EbuyPasteClient.tsx:123, GsaPasteClient.tsx:166.
    - `text-[11px]`: panel actions.
  - The stretch comes from `flex flex-col` forms with no `self-start` (AddActivityForm.tsx:36, GateDecisionPanel).
  - The wrapping comes from `Panel.tsx`'s actions wrapper (`<div className="flex items-center gap-2">`), which has no `shrink-0`, and from `.aur-btn`/`.aur-btn-primary`, which have no `whitespace-nowrap`. It is triggered by `AgencyContactsPanel.tsx:30` and `LossNarrativePanel.tsx:47-52`.
- **Fix:**
  - globals.css: add `whitespace-nowrap` to `.aur-btn`, `.aur-btn-primary` and `.aur-btn-danger`, and add one `.aur-btn-sm` (`px-2.5 py-1 text-[12px]`) for panel-header actions.
  - Panel.tsx actions wrapper: `flex shrink-0 items-center gap-2` (this belongs to the Panel owner).
  - Remove the per-site `py-2.5 text-sm` / `px-5 py-2.5` / `text-[12px]` overrides so form submits share the default size.
  - Add `self-start` to the AddActivityForm and GateDecisionPanel submits.
- **Shared or local:** Shared.

### 13. **Stage and relationship shown twice: a meta tile, then a boxed band repeating it** · low
- **Pages / themes:** all /opportunities/[id]/* tabs and /companies/[id]; both themes.
- **What you see:** The "STAGE: Capture" tile is followed by a full-width filled band "● CURRENT STAGE · CAPTURE". On a company, "RELATIONSHIP: Competitor" is followed by a band with "● COMPETITOR". The band is an extra box between the tiles and the tabs and only restates the tile. Once the hex-alpha codemod lands, its chip gains a tinted box too, so it becomes a box inside a box.
- **Cause:** `opportunities/[id]/layout.tsx:83-101` and `companies/[id]/page.tsx:70-90` (`rounded-lg border border-layer/10 bg-layer/[0.02] px-4 py-3`).
- **Fix:** Delete both bands. Keep the Stage / Relationship meta tile (optionally with the planned tone diamond). Move the company "Last SAM.gov sync …" line (`:85-89`) into the PageHeader subtitle.
- **Shared or local:** Local.

### 14. **Two surfaces that break only in hidden states: an undefined `bg-bg` and a canvas-coloured sticky header in a paper panel** · low
- **Pages / themes:** /intelligence when `AWARDS_INTEL_ENABLED=1` (both themes); /contacts import preview (dark only). Neither state is in the screenshots; both are verified in code.
- **What you see (from code):**
  - The BD-links grid is drawn with the "1px gap shows the hairline" trick, but the cells have no background, so the grid's `bg-layer/5` fills every cell and no hairlines show.
  - In the contacts import preview, the sticky table header is `canvas` (#050608 in dark) inside a `paper` (#0B1019) panel, so it reads as a darker band when scrolling.
- **Cause:** `intelligence/page.tsx:57` (`<li className="bg-bg/95">`: no `bg` colour exists in `tailwind.config.ts`, so no CSS is generated; the inventory does not list it); `contacts/ContactsImportPanel.tsx:239` (`sticky top-0 bg-canvas`).
- **Fix:** `bg-bg/95` → `bg-paper`; `bg-canvas` → `bg-paper`. Add `/\bbg-bg\b/` to the theme-tokens test's undefined-token rules.
- **Shared or local:** Local.

---

## Incidental (not colour)
`intelligence/SectionSignalsPanel.tsx:69-70`: `<em>and</em>` followed by a line break renders "andthe" on /intelligence (JSX drops the newline). Add `{" "}` after `</em>`.

## Counts
High 0 · Medium 7 (findings 1–7) · Low 7 (findings 8–14). The area's high-severity problems (the Send-for-review dark dialog and the amber rollup score on white) are already in the known list.

# Visual uniformity: platform admin and signed-out pages

Scope: /admin and its 19 sub-routes, /platform/audit-log, the seven signed-out routes (sign-in, sign-up, forgot-password, reset-password, verify-email, request-trial, pricing), plus `not-found.tsx`, `(app)/error.tsx` and `global-error.tsx` (code only).

Baseline: origin/main `4a6f0b4`, with screenshots in both themes for every route. PR A (`/home/user/forge-ui`) was read first; nothing it already fixes is repeated here. PR A covers the auth-card gradient bars and float shadows, the brand tiles, the 600/700 → 500 remap, `font-synthesis-weight:none` on mono, the Panel stripe, StatTile glow, and the accent token.

Where a finding extends an accepted `UP` item or a sibling report (`assess/shell.md`, `assess/capture.md`, `assess/proposals.md`), it says so. It only adds the sites in this area.

## 1. Patterns

**Page header.** The dominant pattern is every admin and platform page using the shared `PageHeader`: diamond eyebrow, 48px title, a subtitle, actions on the right, and a meta-tile row. /admin uses it via `AdminClient.tsx:142`. Outliers:
- The eyebrow wording is "Platform Administration" at `platform/audit-log/page.tsx:60`; everywhere else it reads "Platform admin".
- The back links are inconsistent (Finding 11).
- The signed-out pages have no PageHeader. Each card opens with a 24px `font-display text-2xl font-semibold tracking-tight` h1, for example `sign-in/page.tsx:56`. After PR A that renders at 500 weight, while the app titles are 400.
- /pricing has a centred eyebrow in `text-teal` with no diamond (`pricing/page.tsx:93-95`, Finding 12).

**Tabs and segmented filters.** These have no dominant pattern. There are four treatments:
- The /admin hub tabs: mono uppercase with a `border-teal-400` underline (`AdminClient.tsx:240-243`).
- Indigo-tinted boxes on /admin/errors (`errors/page.tsx:245, 264`) and /admin/jobs (`jobs/page.tsx:135`).
- Cobalt-400 border boxes on /admin/source-requests (`SourceRequestTriageClient.tsx:81, 98`).
- A solid primary button as the "selected" state on /admin/gold-set (`AddGoldDocForm.tsx:54`).

The style is covered by the accepted tab finding and `proposals.md` #10. The indigo colour is Finding 4.

**Tables and list rows.** List rows are mostly rounded boxes (`rounded-lg border border-layer/10 bg-layer/[0.02] p-3`): `AdminClient.tsx:817, 1149`, `promo-codes/page.tsx:76`, `TrialRequestsClient.tsx:89`, `TenantUsersClient.tsx:236, 373`. Some rows are status-tinted boxes (`errors/page.tsx:146-151`, `jobs/page.tsx:163-168`), and /admin/tiers and /admin/promo-codes nest sub-boxes. All of this is already known ("List rows are boxes…").

Real `<table>`s appear on seven pages, and their headers are drawn six ways (Finding 8). The only header that follows the type rules is `PlatformAuditLogClient.tsx:293-299`.

**Status chips and badges.** There are about 25 inline chip renderings plus three local components: `errors/page.tsx:276` Tag, `TenantUsersClient.tsx:498` Tag and `IsolationCheckPanel.tsx:174` StatusBadge. They come in three shapes (3px, 5px, pill), three tint strengths (/10, /15, /20), and with or without a border. None uses the shared `StatusPill`. The colour meanings drift: Findings 3, 4, 5 and 10.

**Alerts, banners and notices.** The dominant error pattern is `rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose`. It appears on all auth forms (e.g. `SignInForm.tsx:62`) and in `AdminClient.tsx:426, 631, 728, 910, 1249`, `TenantUsersClient.tsx:197, 648` and `GoldReviewClient.tsx:72`, so the signed-out and signed-in errors match.

Outliers:
- Sba8a uses `rounded border-rose/30 … text-rose-200` (`Sba8aAdminClient.tsx:277, 333, 344, 430, 492`).
- `StartImpersonationForm.tsx:89` uses `rose-500/30 bg-rose-500/5 text-rose-300`.
- Some errors are an unboxed red paragraph: `samgov-keys/page.tsx:45, 48` and `StorageCheck.tsx:76`.

Success notices vary the same way: `emerald/40 /10 text-emerald` (`AdminClient.tsx:1072`), `text-emerald-300` (`TenantUsersClient.tsx:202`), `emerald-500/20 /5 text-emerald-200` (Sba8a:338…), and `text-text` (`RequestTrialForm.tsx:68`). Warning boxes alternate between the `gold` and `amber-400` aliases (`AdminClient.tsx:452, 860` vs `EnvMarkerClient.tsx:37`); these are the same family. All of these are readable in both themes; the exception is Finding 2.

**Buttons and links.**
- *Buttons, dominant:* `aur-btn aur-btn-ghost text-[11px]` for secondary actions (94 sites), `aur-btn aur-btn-primary text-[11px]` for primary actions, and `aur-btn-danger text-[11px]` for destructive ones (10 sites). This is the hybrid and size issue in `shell.md` #2.
- *Size outliers:* back links at the default 14px (`source-requests/page.tsx:28`, `migrations/page.tsx:48`, `sba-8a/page.tsx:35`, `audit-log/page.tsx:64`).
- *Shape outlier:* "Run isolation check" wraps into a three-line blue block, because the button has no `shrink-0 whitespace-nowrap` (`IsolationCheckPanel.tsx:76-83`).
- *Colour outliers:* the amber impersonation button (Finding 1) and red ghost buttons standing in for `aur-btn-danger` (Finding 7).
- *Signed-out buttons:* full-width `aur-btn aur-btn-primary py-3` with `aur-btn aur-btn-ghost` secondaries. Same classes, same blue.
- *Links:* auth and pricing use `text-teal` (= cobalt). Admin uses `text-violet` or `text-indigo-300` (Finding 4), or inherits ink with a hover underline (`AdminClient.tsx:460`, `orgs/[id]/page.tsx:474, 537`).

**Form fields.** These are uniform: `aur-input` and `aur-label` everywhere, signed-in and signed-out, and date and select inputs follow `color-scheme`. Outliers:
- Size overrides (`text-[11px]` / `[12px]`) sit next to default 14px fields on the same page: the /admin/orgs/[id]/users invite form (`TenantUsersClient.tsx:595-617`) vs the member-row select (`:300`).
- Native checkboxes are Chrome's #0075FF in light and #99C8FF in dark (pixels sampled on /admin/promo-codes/new), not #2953D7. This is already covered by `shell.md` #10; the admin sites are `PromoCodeForm`, `TierEditForm`, `AdminClient.tsx:620, 1231` and `TenantUsersClient.tsx:635`.

**Empty states.** The dominant pattern is a mono 11px muted sentence inside the Panel (`errors/page.tsx:136`, `jobs/page.tsx:156`, `TrialRequestsClient.tsx:21`, `sam-notices/page.tsx:50`, `gold-set/page.tsx:58`). Outliers:
- `font-body text-[13px]` (`samgov-keys/page.tsx:58`, `usage/page.tsx:276`). This is actually the target of the accepted mono finding.
- An emoji (`errors/page.tsx:138`, "🎉").
- An empty panel with no message at all ("Source files" on /admin/gold-set/[id], `gold-set/[id]/page.tsx:40-50`).

The shared fix is `shell.md` #13.

**Cards and panels.** The shared `Panel` is dominant. The auth cards are `aur-card-elevated`, which PR A changes to `aur-card`. Hand-rolled cards: `(app)/error.tsx:45` (`rounded-lg border border-layer/10 bg-layer/[0.02]`), `IsolationCheckPanel.tsx:65`, and `global-error.tsx`, which uses inline hex (Finding 6). The 404 page is known.

**Charts and graphs.** None in this area.

**Modals and menus.** There are no FORGE dialogs. Confirmations use 19 native `window.confirm` calls (e.g. `TrialRequestsClient.tsx:70`, `GoldReviewClient.tsx:98`) and inline expanders (impersonation, remove key). No colour issue beyond Finding 1.

**Stat tiles.** The PageHeader meta row is dominant on every admin page. Outliers:
- The local `StatTile` in `AdminClient.tsx:273-284`.
- `HealthRow` (`activity/page.tsx:345-350`).
- `RowField` (`promo-codes/page.tsx:153-161`).

These are covered in Finding 9. Coloured and zero-padded figures ("00", "01") are already known.

**Do the signed-out pages read as the same product?** Mostly yes, in both themes:
- The surfaces are the same (canvas/paper; navy-black in dark).
- Inputs (`aur-input`), labels (`aur-label`), the primary blue button, the rose error box and the theme toggle are the same.
- After PR A, the brand mark is the same solid `aur-brand-mark`.

The remaining differences:
- **Heading scale and weight:** 24px at 500 after PR A, vs 48px at 400 in the app.
- **Doubled brand on two cards:** sign-in and sign-up repeat the brand block inside the card, below the identical layout header. The other four cards don't (Finding 12).
- **Pricing eyebrow:** blue with no diamond (Finding 12).
- **Mono links on sign-in:** already known.
- **Root error page:** `global-error.tsx` is a different system entirely (Finding 6).

## 2. Findings

### 1. **Impersonation starts amber, with a gradient button that fails contrast, then turns red once active** · high
- **Pages / themes:** /admin/orgs/[id], both themes. The "🪪 Assume identity" button is visible in the screenshots. The open form is verified in code.
- **What you see:**
  - Among the neutral header buttons, one is brass with an emoji. Sampled text colour: 138 103 32 in light, 230 201 126 in dark.
  - Clicking it opens a brass box whose "Start session" button is a yellow-to-brown gradient (#FBBF24 → #B45309) with white text, about 2.8:1 where the label sits.
  - That button keeps the action-blue border.
  - Once the session starts, the sticky ImpersonationBanner is red.

  So one flow uses two status hues, a second accent, and a gradient.
- **Cause:**
  - `StartImpersonationForm.tsx:62, 65`: `aur-btn aur-btn-ghost text-[11px] text-amber-300 hover:text-amber-200` and "🪪".
  - `:70-71`: an `amber-400/30` box and a `text-amber-300` eyebrow.
  - `:108-109`: `className="aur-btn aur-btn-primary …"` with `style={{ background: "linear-gradient(180deg,#FBBF24,#B45309)" }}`. The border comes from `.aur-btn-primary { border-color: rgb(var(--c-action)) }` (`globals.css:285`).
  - Compare `ImpersonationBanner.tsx:50-51` (red).
- **Fix:**
  - `:62`: `aur-btn aur-btn-ghost text-[11px]`, dropping the amber classes and the 🪪.
  - `:70`: `border-rose/30 bg-rose/[0.04]`.
  - `:71`: `text-rose`.
  - `:108`: `className="aur-btn-danger text-[11px] disabled:opacity-60"` and delete the `style` prop.

  This matches the red banner that follows; the accepted ImpersonationBanner item keeps that banner red.
- **Shared or local:** local.

### 2. **SBA 8(a) "Diagnostic" box text is Tailwind's amber-100, invisible on light paper** · high
- **Pages / themes:** /admin/sba-8a, light theme. It appears when a SAM pull returns zero rows; verified in code and compiled CSS.
- **What you see:** The diagnostic body text ("Top-level keys returned…", "Raw response sample…") is #FEF3C7 on a 6% brass wash over white, about 1.06:1. It is fine in dark.
- **Cause:**
  - `Sba8aAdminClient.tsx:440` uses `text-amber-100`. `.next/static/css/app/layout.css:3143-3146` compiles it to a fixed `rgb(254 243 199)`, not a variable.
  - `tailwind.config.ts` puts `amber: brass` under `theme.extend.colors`, and Tailwind deep-merges `extend` with its default `amber`. Stops 50/100/800/900/950 therefore survive as theme-blind hex on every aliased family (amber, emerald, rose, teal, sky, violet…).
  - This is the inventory's `offScaleStop` category, which no planned codemod lists.
- **Fix:**
  - `:440`: `text-amber-100` → `text-text`, keeping the `text-amber-200` headings at `:441, :454`.
  - `:449, :457`: `text-amber-50`, already in the accepted `bg-black/30` item → `text-text`.
  - Guard: add a check to `tests/design/theme-tokens.test.ts` that rejects `\b(text|bg|border)-(amber|emerald|rose|teal|sky|violet|gold|hazard|blood|signal|magenta|cobalt|brass|green|red|indigo|plum)-(50|100|800|900|950)\b` in `src/`.
- **Shared or local:** local fix, shared guard.

### 3. **Isolation-check PASS / FAIL / N/A badges and the ITAR chip use raw Tailwind hex that is unreadable on light** · high
- **Pages / themes:** /admin/orgs/[id], light theme. The badges appear after "Run isolation check"; the chip appears when ITAR is on. Verified in code.
- **What you see:** On white with their own 10–12% tints:
  - PASS: #4ADE80, about 1.6:1.
  - N/A: #94A3B8, about 2.4:1.
  - FAIL and "ITAR-restricted": #F87171, about 2.6:1.

  All are 9px. In dark they read.
- **Cause:** `IsolationCheckPanel.tsx:174-208` (a `STYLE` map of hex and `rgba(...)` applied via `style`) and `ItarRestrictedToggle.tsx:73-81`. These are hex-literal inventory items. The point to carry into the codemod: mapping them to `THEME_HEX` would still fail on light, because those are the dark values (`theme-colors.ts:80-85`).
- **Fix:** Drop the inline styles and use classes:
  - pass: `border-emerald/40 bg-emerald/10 text-emerald`
  - fail: `border-rose/40 bg-rose/10 text-rose`
  - neutral: `border-layer/15 bg-layer/5 text-muted`

  Apply them on `rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-label`, or on the accepted `.aur-tag` once it exists. Use the same classes for the ITAR chip.
- **Shared or local:** local (two files); converges on the shared tag.

### 4. **Indigo is the admin area's de-facto second accent: selected filters, links, a role tag and neutral counts** · medium · *(extends the UP item "Plum and indigo used as general accents", `proposals.md` #10 and `capture.md` #9)*
- **Pages / themes:** /admin/errors, /admin/jobs, /admin/orgs/[id], /admin/orgs/[id]/users, /admin/orgs/[id]/activity, /admin/trial-requests; both themes.
- **What you see:**
  - The selected Status/Env and Show filters are lavender boxes: sampled fill 239 240 250 in light, 17 20 31 in dark.
  - Inline links ("→ SuperAdmin portal", "Workspace →", "Triage →") are indigo, while auth and pricing links are cobalt.
  - "Primary admin" is an indigo tag, while "Superadmin" on /admin is a cobalt tag (`AdminClient.tsx:1160`).
  - Neutral counts turn indigo: "Audit rows (30d)", "Pending invites", "Storage used".

  Rule 4 reserves indigo for analysis and review.
- **Cause:**
  - Selection: `errors/page.tsx:245, 264` and `jobs/page.tsx:135` (`border-violet/40 bg-violet/10`).
  - Links: `TenantUsersClient.tsx:221, 488`, `users/page.tsx:173`, `activity/page.tsx:359` (`text-violet`), and `TrialRequestsClient.tsx:48, 129` (`text-indigo-300`).
  - Tag: `TenantUsersClient.tsx:247` (`bg-violet/20 text-violet`).
  - Figures: `orgs/[id]/page.tsx:273` and `:435`, `users/page.tsx:155` (`accent: "violet"`).
- **Fix:**
  - Selection: → `border-cobalt/40 bg-cobalt-400/10 text-text` now, then the accepted tab spec (diamond plus `aria-pressed`).
  - Links: `text-violet` / `text-indigo-300` → `text-cobalt` (`text-accent` after PR A).
  - Primary-admin tag: → `bg-layer/10 text-muted`, the same as "You" and "Unverified" in `AdminClient.tsx:1155, 1170`.
  - Figures: `accent: "violet"` → remove (ink).
- **Shared or local:** local edits; the shared tab and filter component covers selection.

### 5. **The same state wears different colours from page to page: review, running, queued, informational, stale** · medium · *(extends `proposals.md` #2)*
- **Pages / themes:** /admin/gold-set, /admin/source-requests, /admin/jobs, /admin/usage, /admin/orgs/[id]/activity, /admin/sam-notices; both themes.
- **What you see:**
  - **In review:** brass on /admin/gold-set ("in review"), but cobalt on /admin/source-requests ("Under review" chip and tile). Rule 4 says indigo.
  - **Running / queued:** brass row tint for both queued and running jobs; the jobs "Running" meta tile is indigo; eval runs say "running" in brass. Rule 4 says cobalt for in progress and muted for not started.
  - **Informational:** every row on /admin/usage carries a blue "UNLIMITED" chip (21 blue chips in the screenshot). That is blue as decoration for a neutral fact.
  - **Stale or idle:** "never loaded" in large red on /admin/sam-notices. A tenant with no actions in 7 days, or "Never", is red on /activity. Red means blocked or lost; this is attention (brass).
- **Cause:**
  - `gold-set/page.tsx:15` (`in_review: "text-gold"`).
  - `SourceRequestTriageClient.tsx:27` (teal) and `source-requests/page.tsx:39` (`"cobalt"`).
  - `jobs/page.tsx:168` (amber row for every non-failed, non-done job), `:109` (`"violet"`) and `AccuracyPanel.tsx:134` (`text-gold`).
  - `usage/page.tsx:614-615` (`border-cobalt-400/40 bg-cobalt-400/10 text-cobalt`).
  - `sam-notices/page.tsx:30` and `activity/page.tsx:203, 219-224, 286-291` (`"rose"`).
- **Fix:**
  - `gold-set/page.tsx:15` → `"text-violet"`.
  - `SourceRequestTriageClient.tsx:27` → `border-violet/40 bg-violet/10 text-violet`.
  - `source-requests/page.tsx:39` → `"violet"`. Indigo is legitimate here, as review.
  - `jobs/page.tsx:168` → `r.status === "running" ? "border-cobalt/30 bg-cobalt-400/[0.04]" : "border-layer/10 bg-layer/[0.02]"`.
  - `jobs/page.tsx:109` → `"cobalt"`, which renders cobalt after PR A.
  - `AccuracyPanel.tsx:134` → `text-cobalt`.
  - `usage/page.tsx:615` → `border-layer/15 bg-layer/5 text-muted`.
  - `sam-notices/page.tsx:30` and the activity "Actions (7d)" / "Last activity" → `"gold"`. Keep red for unresolved errors.
- **Shared or local:** local edits. The real fix is one status → tone map, shared with `proposals.md` #2.

### 6. **The root error page is a separate, light-only design system** · medium
- **Pages / themes:** global-error (code only), both themes; a dark-theme user gets a light page.
- **What you see (from code):**
  - A #fafafa page with #1c1c1f text in system-ui.
  - A 600-weight h1.
  - A near-black, 6px-radius "Try again" button.

  It has none of FORGE's surfaces, fonts or blue, while `(app)/error.tsx` uses the app's card, mono eyebrow and `aur-btn-primary`.
- **Cause:** `global-error.tsx:47-101` (inline hex and `rgba` styles). It does not import `./globals.css` and has no theme bootstrap (compare `layout.tsx:3, 51`).
- **Fix:**
  - Add `import "./globals.css";`.
  - Move the theme-script string at `layout.tsx:51` into a shared module (e.g. `src/lib/theme-script.ts`) and render `<script dangerouslySetInnerHTML>` in both `<head>`s.
  - Body: `className="min-h-screen bg-canvas px-6 py-12 font-body text-text"`.
  - Content: reuse `(app)/error.tsx`'s markup inside `aur-card mx-auto max-w-xl p-6`, with an h1 of `font-display text-xl font-normal tracking-title` and a button of `aur-btn-primary`. Arial is the fallback via `globals.css:49-52`.
- **Shared or local:** shared markup with `(app)/error.tsx`.

### 7. **Destructive buttons are drawn two ways, and the red ghost ones turn blue on hover** · medium · *(extends `capture.md` #8)*
- **Pages / themes:** /admin/gold-set/[id] (Delete), /admin/orgs/[id] (Revoke, Revoke all tokens), /admin/samgov-keys (Remove key); both themes.
- **What you see:**
  - "Delete" on gold-set/[id] is a neutral bordered button with red text.
  - "Remove" on /admin/orgs/[id]/users is the pink-tinted `aur-btn-danger`.
  - On hover, the red label of the ghost variant turns action-blue, so a destructive control briefly looks like the primary action.
- **Cause:**
  - `GoldReviewClient.tsx:95`, `TenantApiTokensPanel.tsx:77, 103` and `SamgovKeyControls.tsx:90` use `aur-btn aur-btn-ghost … text-rose`.
  - `.aur-btn-ghost` carries `hover:text-cobalt` (`globals.css:294`). `.aur-btn-ghost:hover` has specificity (0,2,0), which beats `.text-rose` at (0,1,0).
  - Dominant elsewhere: `aur-btn-danger` (`AdminClient.tsx:498, 851, 1202, 1210, 1239`, `TenantUsersClient.tsx:343, 422, 450`, `TrialRequestsClient.tsx:121`).
- **Fix:** At the four sites, `aur-btn aur-btn-ghost text-[11px] text-rose` → `aur-btn-danger text-[11px]` (and `text-[10px]` → `text-[11px]` at SamgovKeyControls:90).
- **Shared or local:** local.

### 8. **Admin table headers are drawn six ways, with row rules at three strengths** · medium · *(extends `shell.md` #4; use its `.aur-table`)*
- **Pages / themes:** /admin/gold-set, /admin/samgov-keys, /admin/orgs/[id] (API tokens), /admin/usage, /admin/sba-8a, /platform/audit-log, /pricing; both themes.
- **What you see:**
  - Uppercase subtle headers on gold-set.
  - Uppercase muted headers with semibold weight on /usage.
  - Mixed-case headers on a tinted band on /sba-8a ("Cert Total Active…").
  - Different letter-spacing from page to page.
  - Row rules range from a clear hairline (/10) to barely there (/5, /0.04).
- **Cause:**
  - `gold-set/page.tsx:61` and `AccuracyPanel.tsx:97` (`text-subtle tracking-label`).
  - `samgov-keys/page.tsx:63` (`tracking-widest text-subtle`).
  - `TenantApiTokensPanel.tsx:51` (`tracking-wider text-muted`).
  - `usage/page.tsx:284-306, 387-431, 558-566` (`font-semibold … tracking-widest`, `text-muted`).
  - `Sba8aAdminClient.tsx:218, 510` (`bg-layer/[0.02] text-muted`, no `uppercase`).
  - `<th>` elements without `font-normal` inherit the UA bold, because preflight does not reset `th`.
  - Rules: `Sba8aAdminClient.tsx:228` (`divide-layer/5`), `activity/page.tsx:245` (`border-layer/5`), `pricing/page.tsx:181` (`border-layer/[0.04]`). The reference header is `PlatformAuditLogClient.tsx:293-299`.
- **Fix:** Give these tables `aur-table` per `shell.md` #4, and drop the per-`thead`/`th` classes and Sba8a's band. Rules: `divide-layer/5` / `border-layer/5` / `border-layer/[0.04]` → `border-layer/10`.
- **Shared or local:** shared.

### 9. **The /admin hub re-draws the header figures with a local, bolder StatTile** · low · *(extends `proposals.md` #11)*
- **Pages / themes:** /admin (Overview tab), both themes; /admin/orgs/[id]/activity and /admin/promo-codes in code.
- **What you see:** The header shows Organizations / Active orgs / Users as 21 / 21 / 21 in regular weight. The "Platform overview" panel directly below repeats the same three figures in semibold, inside a second box style.
- **Cause:**
  - `AdminClient.tsx:260-284`: local `StatTile` with `font-display text-2xl font-semibold`.
  - Similar clones: `HealthRow` (`activity/page.tsx:345-350`, `font-semibold` toned value) and `RowField` (`promo-codes/page.tsx:153-161`).
- **Fix:** Delete `AdminClient.tsx:273-284` and the three duplicated tiles. Add `{ label: "Active users", value: String(stats.activeUsers) }` to the header `meta` (`:212-231`) and drop the Overview panel. If the tab must stay, render `StatTile` from `src/components/ui/StatTile.tsx`.
- **Shared or local:** local.

### 10. **Chips: eight local renderings in three shapes, with or without borders** · low · *(extends the UP "Status chips are tinted boxes…" item, adding the admin migration list)*
- **Pages / themes:** /admin/orgs/[id]/users (bordered 5px chips), /admin/promo-codes ("USABLE", borderless 3px at /20), /admin/usage (bordered), /admin/errors (borderless grey), /admin (9px tags); both themes.
- **What you see:** On adjacent pages, the same kind of status tag changes radius, border and tint.
- **Cause:**
  - `errors/page.tsx:276-281`
  - `TenantUsersClient.tsx:498-519`
  - `AdminClient.tsx:823, 1155-1170`
  - `promo-codes/page.tsx:93-110`
  - `TrialRequestsClient.tsx:37`
  - `TenantApiTokensPanel.tsx:72`
  - `usage/page.tsx:608-633`
  - `SourceRequestTriageClient.tsx:25-30`
  - `IsolationCheckPanel.tsx:174` (Finding 3).
- **Fix:** Route all of them through the accepted `.aur-tag` (or `StatusPill` with a tone prop), with tones from rule 4. Delete the two local `Tag` components.
- **Shared or local:** shared.

### 11. **Back links: four labels, two sizes, and missing on three pages** · low · *(extends `capture.md` #11)*
- **Pages / themes:** all admin pages, both themes.
- **What you see:** The back link to /admin is labelled differently from page to page:
  - "← SuperAdmin portal" in 11px.
  - "← Platform admin" in 14px (visibly larger).
  - "Back to admin" in 14px with no arrow.
  - "← All organizations".
  - Nothing at all on /admin/sam-notices, /admin/samgov-keys and /admin/gold-set.
- **Cause:**
  - `jobs/page.tsx:100`, `errors/page.tsx:110`, `trial-requests/page.tsx:26`, `usage/page.tsx:235`, `tiers/page.tsx:69`, `promo-codes/page.tsx:45` (SuperAdmin portal).
  - `source-requests/page.tsx:28-29`, `migrations/page.tsx:48-49`, `sba-8a/page.tsx:35-36` (Platform admin, default size).
  - `platform/audit-log/page.tsx:64-65`.
  - `orgs/[id]/page.tsx:251-252`.
  - Eyebrow wording: `audit-log/page.tsx:60`.
- **Fix:** Add `back?: { href: string; label: string }` to `PageHeader` and render it in one style: the accepted `.aur-link`, or `aur-btn aur-btn-ghost text-[11px]` until that lands. Then use `back={{ href: "/admin", label: "SuperAdmin portal" }}` on every admin page, including the three missing ones, and set `eyebrow="Platform admin"` at audit-log:60.
- **Shared or local:** shared.

### 12. **Signed-out polish: two of six auth cards repeat the brand, and the pricing eyebrow has no diamond** · low
- **Pages / themes:** /sign-in and /sign-up vs /forgot-password, /reset-password, /verify-email, /request-trial; /pricing; both themes.
- **What you see:**
  - Sign-in and sign-up show the F tile and "FORGE / PROPOSAL OPS" twice: in the layout header and again inside the card. The other four cards open directly with the h1.
  - The /pricing eyebrows ("FORGE PRICING", "ADD-ONS") are blue with no diamond, while every app eyebrow carries `aur-diamond`.
- **Cause:** `sign-in/page.tsx:36-54` and `sign-up/page.tsx:92-110` (in-card brand block; the layout already renders it at `(auth)/layout.tsx:8-19`); `pricing/page.tsx:93-95, 225`.
- **Fix:**
  - Delete the in-card brand blocks, and change the h1 `mt-8` to no top margin, matching forgot-password:21.
  - Pricing eyebrow: `inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-label text-accent` (`text-cobalt` before PR A), with a leading `<span className="aur-diamond" />`.
- **Shared or local:** local.

**Counts:** high 3 · medium 5 · low 4.

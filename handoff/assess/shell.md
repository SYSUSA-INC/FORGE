# Visual uniformity: app shell, home and cross-cutting pages

Scope: `/`, `/pipeline`, `/pipeline/[id]` (it only redirects to `/opportunities/[id]`: `pipeline/[id]/page.tsx:9-15`, so nothing renders), `/reports`, `/notifications`, `/notifications/rules`, `/notifications/rules/[id]`, `/notifications/rules/new`, `/onboarding`, `/help`, `/help/user`, `/help/admin`, `/help/faq`, `/audit-log`. It also covers the shared chrome (sidebar, header, command palette, bell) and the `src/components/ui` kit, judged across all screenshots in both themes.

Baseline is origin/main `4a6f0b4`. Anything PR A (`/home/user/forge-ui`) already fixes is left out. So are the `UP` findings in `themeverdicts.txt` and the codemod categories in `color-inventory.json`, except where a finding below extends one of them; those are marked **(extends: …)**.

---

## 1. Patterns

**Page header.** The dominant pattern is `PageHeader`, used in 74 files and on every route in scope except Help: diamond eyebrow, a 48px title at weight 400, a muted subtitle, actions aligned to the bottom right, and a MetaTile row. It reads as one system across all screenshots. There are two outliers:
- `help/layout.tsx:15-33` hand-rolls its own header: an eyebrow with no diamond, a 24px `font-semibold` title, and a centred `max-w-4xl` column (Finding 3).
- `(app)/error.tsx:45-53` is a boxed error card with its own `h1`.

Eyebrow vocabulary also drifts from the nav (Finding 15).

**Tabs and segmented filters.** There are four selected-state looks:
- Cobalt-bordered box: the pipeline window buttons (`PipelineFilters.tsx:63-67`) and the rule role/channel toggles (`RuleEditorForm.tsx:474-478, 756-760`).
- Cobalt-tint pill: the Reports range (`ReportsClient.tsx:55`).
- Grey `bg-layer/10` fill: the pipeline mode switch (`PipelineFilters.tsx:84-88`), the Notifications Unread/All switch (`NotificationsClient.tsx:52-74`) and the command-palette row (`CommandPalette.tsx:286`).
- 2px gradient underline: `HelpTabs.tsx:30`.

On /pipeline the cobalt and grey conventions sit side by side in one row. These are covered by the accepted tabs, pills and palette findings. **(Extends the tabs finding:)** `NotificationsClient.tsx:52-74` is not in its site list and needs the same diamond treatment, because grey fill must not mean "selected".

**Tables and list rows.** The correct pattern is the Reports tables (`ReportsClient.tsx:82-105, 181-207`): no wrapper, `border-t border-layer/10` rows, a mono 10px muted head and 13px body. There are two outliers:
- Rules and Audit log wrap the table in a second box inside the Panel, with a `text-subtle` head and fainter `/5` row rules.
- Help markdown draws a full grid.

List rows on Home and Onboarding are boxed `rounded-md border bg-layer/[0.02]` items (`page.tsx:175, 220`; `onboarding/page.tsx:126`), which the accepted "list rows are boxes" finding already covers. See Finding 4 for tables.

**Status chips and badges.** Chips in scope are drawn differently on each page:
- Rules "ACTIVE": `rounded-md` tinted box, `rules/page.tsx:165-171`.
- Onboarding "admin active": bare coloured mono text, `onboarding/page.tsx:129-144`.
- Home "Stage: Writing" / "PWin": neutral bordered boxes, `page.tsx:130-139`.
- Stage chips with inline hex-alpha tints, which are invalid: `CommandCenterStageGrid.tsx:71-79`.

`ui/StatusPill.tsx` has no importers; `IntegrationsTab` defines its own `StatusPill`. Its map also contradicts rule 4 (`DRAFTING` and `VERIFIED` are violet), but it renders nowhere. All of this is covered by the accepted chips (`.aur-tag`) and stage-hue findings. Notification kind icons are a separate drift (Finding 6).

**Alerts, banners and notices.** There are five shapes for one job:
- Full-bleed bars: NonProd (amber), Trial (indigo for "info", Finding 12), Impersonation (red gradient, already accepted).
- Tinted boxes in mono 11px: `SamKeyNotice`, form errors and success notes (`RuleEditorForm.tsx:663-671`, `CreateWorkspaceForm.tsx:58`).
- Icon-badge callouts with a 13px body: `StubModeBanner` block, `PreviewBanner`.
- Bare coloured text with no box: `GettingStartedClient.tsx:114, 171, 309`; `ReportsClient.tsx:60`.
- Error strip: `CommandPalette.tsx:220`.

The mono and brass contrast parts are covered by accepted findings. A single `ui/Notice` (generalise `SamKeyNotice` with `tone` = danger/attention/success/info) would retire the other shapes; that is noted here, not raised as a finding.

**Buttons and links.** `aur-btn-primary` and `aur-btn` are the intended pair. In practice the most common button is the hybrid `aur-btn aur-btn-ghost` (307 sites), and roughly 350 `aur-btn*` elements carry ad-hoc `text-[10|11|12px]` sizes (Finding 2). Other outliers:
- The ad-hoc danger button at `RuleEditorForm.tsx:651`.
- The mono pill "SIGN OUT" at `UserMenu.tsx:63-68`.

Links come in four looks: `text-teal underline` inline (`page.tsx:147, 153, 208`), mono uppercase muted "VIEW ALL →" (`page.tsx:197`), cobalt arrows on link cards (`page.tsx:256`; `onboarding/page.tsx:218`), and `aur-btn-ghost` text links (`help/layout.tsx:29`, header Settings). The accepted `.aur-link` proposal covers this.

**Form fields.** These are uniform: `aur-input` everywhere (inputs, selects, dates, textareas) with `aur-label` or the equivalent mono label. `color-scheme` follows the theme (`globals.css:61, 137`), so dates and selects render correctly in dark. The one outlier is native checkboxes, which use the browser's blue (Finding 9).

**Empty states.** There are three looks (Finding 13):
- A dashed box with centred mono text: `NotificationsClient.tsx:88`.
- A plain 13–14px body paragraph with teal underlined links: `page.tsx:145, 167, 204`; `pipeline/page.tsx:80-95`; `ReportsClient.tsx:178`.
- A centred mono table row: `AuditLogClient.tsx:233-240`; `CommandPalette.tsx:228`.

**Cards and panels.** `Panel` (159 files) is consistent: hairline, `border-b` header with mono eyebrow over a 14px title. PR A removes the gradient stripe. The known nested-box issue remains (Home quick links `page.tsx:246-298` and Onboarding `OnboardingLink` are `aur-card`s inside a Panel; GettingStarted step cards), which is already accepted.

**Charts and graphs.** There are two grammars for the same "stage funnel" (Finding 5):
- /pipeline: h-9 boxed tracks with per-stage inline colours and gradient fills. These are currently invisible because of the hex-alpha bug, which is accepted.
- /reports: thin h-2 cobalt bars on a `bg-layer/5` track.

Home has the stage tile grid. `ui/BarMeter`, `Funnel`, `PieChart`, `Radar`, `DotMeter` and `Sparkline` have no importers.

**Modals and menus.**
- The command palette is glass: `rounded-xl bg-canvas/95 shadow-card-lg backdrop-blur-xl`, `CommandPalette.tsx:195`.
- The bell dropdown is `rounded-lg bg-canvas shadow-card`, a hairline-grade shadow, `NotificationBellClient.tsx:69`.
- The mobile drawer is glass, `MobileNav.tsx:82`.

The shadow mismatch is already accepted.

**Stat tiles.** MetaTile (inside PageHeader) is the dominant tile; StatTile is used only in `AdminClient`, with a larger number and more padding. Two inconsistencies remain:
- Values are zero-padded on some pages and not others: `08` on Pipeline, `8` on Reports, `02 / 1 / 100` on Audit log.
- Numerals are coloured by page-specific rules: Win rate is always green on Reports (`reports/page.tsx:50`) but threshold-coloured on Pipeline (`pipeline/page.tsx:131-136`); Onboarding shows "Platform admin: Yes" in green and "Workspaces 01" in brass.

The accepted "ink figures, drop padStart" finding resolves both, so they are not listed again.

**Shell chrome** (seen on every screenshot).
- Sidebar: icon tiles, boxed ±, a diamond hanging outside the active row, and wrapped two-line group labels. All already accepted.
- Header: pill clock and user block, two different "live" markers, and a double hairline. All already accepted. New items:
  - The console badge wraps (Finding 7).
  - The workspace switcher labels are truncated (Finding 8).
  - Unicode glyph icons sit next to the SVG bell (Finding 14).
- Footer: identical on every page and fine.

---

## 2. Findings

Severity counts: **high 1 · medium 6 · low 8**.

### 1. **Help manuals: every inline `code` breaks its sentence onto three lines** · high
- **Pages:** /help/user, /help/admin, /help/faq; both themes.
- **What you see:** "…pick from the synced feed under / `Opportunities → Import` / ." The code text sits alone on its own line with no chip, and the sentence's punctuation is orphaned on the line after it. FAQ items 1–3, "Can I try FORGE before buying?", every "Settings → …" path and the `docs/images/` note in both manuals all break this way. The docs contain about 980 backtick spans (USER 121, ADMIN 789, FAQ 71), so the help pages read as broken.
- **Cause:** `src/components/help/MarkdownRenderer.tsx:75-90` decides between inline and block code with `props.inline`. react-markdown is `^10.1.0` (`package.json:61`; `node_modules/react-markdown` reports 10.1.0), and versions 9 and later no longer pass `inline`. So `inline` is always undefined and every `code` element gets `className="block …"` (line 86).
- **Fix:** Style `code` as inline unconditionally and let `pre` restyle its child:
  - `code: ({ children }) => <code className="rounded border border-layer/10 bg-layer/5 px-1.5 py-0.5 font-mono text-[12.5px] text-text">{children}</code>`, deleting the `@ts-expect-error` and `inline` branch.
  - `pre` (line 92): `className="mt-4 overflow-x-auto rounded-md border border-layer/10 bg-bone p-4 [&>code]:block [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:leading-relaxed"`. The `bg-bone` also clears the accepted `bg-black/30` slab.
- **Shared or local:** shared by the 3 help pages (`MarkdownRenderer` is imported only there).

### 2. **Buttons: a fourth variant and four ad-hoc sizes** · medium · **(extends: "Secondary actions are outline buttons…")**
- **Pages:** all, both themes. In scope:
  - Home: "Open opportunity".
  - Reports: "Download CSV" ×5.
  - Notifications: "Mark all read".
  - Rules [id]: "Test send / Deactivate / Delete" next to "Save changes / Cancel".
  - Audit log: "Clear / Export CSV / Back to settings".
  - Onboarding: "Create my workspace".
  - Platform admin quick-link row.
- **What you see:**
  - Two different outline buttons. `aur-btn` has ink text ("New opportunity", "Import from SAM.gov"); `aur-btn aur-btn-ghost` is the same bordered bone box with muted grey text that turns blue on hover.
  - Buttons render at 10, 11, 12 and 14px with fixed padding, so heights run from about 26 to 34px. On rules/[id] three button sizes appear within 100px of each other.
  - Primary buttons are 14px in page headers but 12px on Audit log and Onboarding.
- **Cause:**
  - `globals.css:277-295`: `.aur-btn-ghost` comes after `.aur-btn` in the components layer, so on an element with both classes it overrides only text colour and transition. The border and `bg-bone` survive.
  - `grep`: `aur-btn aur-btn-ghost` appears 307 times. Size overrides on `aur-btn*` className strings: `text-[11px]` ×257, `text-[12px]` ×49, `text-[10px]` ×46. Examples: `ReportsClient.tsx:40`, `page.tsx:114`, `RuleEditorForm.tsx:630, 643, 651`, `NotificationsClient.tsx:80`, `AuditLogClient.tsx:195, 202, 210`, `CreateWorkspaceForm.tsx:49`.
  - The danger button is improvised as `aur-btn aur-btn-ghost text-[11px] border-rose/40 text-rose` (`RuleEditorForm.tsx:651`) instead of `aur-btn-danger`.
- **Fix:**
  - (a) In `globals.css`, add one compact size, `.aur-btn-sm { @apply px-2.5 py-1 text-[13px]; }`.
  - (b) Codemod: inside any className containing `aur-btn`, replace `text-[10px]`, `text-[11px]` and `text-[12px]` with `aur-btn-sm`.
  - (c) Codemod `aur-btn aur-btn-ghost` → `aur-btn` for in-panel actions. For header-level secondary actions ("Back to rules", "Back to settings", "Cancel"), use the accepted `.aur-link`.
  - (d) `RuleEditorForm.tsx:651` → `aur-btn-danger aur-btn-sm`.
- **Shared or local:** shared (globals.css plus a codemod).

### 3. **Help is a separate visual system: own header, smaller title than its first heading, shifted column, blue as decoration** · medium
- **Pages:** /help/user, /help/admin, /help/faq; both themes.
- **What you see:**
  - Every other page opens with the diamond eyebrow and a 48px title. Help instead shows a grey "FORGE · HELP" with no diamond, then a 24px semibold "User & administrator guide".
  - The markdown's own 30px "FORGE — User Manual" sits below it and is larger than the page title.
  - The whole page is a centred `max-w-4xl` column, so the eyebrow and title jump about 110px right of where they sit on every other page.
  - Every bullet, list number and blockquote rule is accent blue, as are the links. The blue stops signalling "action".
- **Cause:**
  - `src/app/(app)/help/layout.tsx:15` (`mx-auto w-full max-w-4xl` wraps the header too), `:18` (eyebrow), `:21` (`text-2xl font-semibold`).
  - `MarkdownRenderer.tsx:21` (h1 `text-3xl`), `:46, :51` (`marker:text-teal`), `:71` (`border-teal/50`).
- **Fix:**
  - `help/layout.tsx`: render `<PageHeader eyebrow="Help" title="User & administrator guide" actions={<a … className="aur-btn-ghost">View on GitHub →</a>} />`, then `<HelpTabs/>`, then `<article className="max-w-4xl">{children}</article>`. Keep the reading measure on the article only.
  - MarkdownRenderer h1: `font-display text-3xl font-normal tracking-title text-text`.
  - `marker:text-teal` → `marker:text-subtle`.
  - Blockquote `border-teal/50 bg-layer/[0.03]` → `border-layer/15 bg-bone`.
  - The tab underline gradient is already covered (accepted, `HelpTabs.tsx:30`).
- **Shared or local:** local (help layout and renderer) on the shared `PageHeader`.

### 4. **Tables drawn three ways** · medium · **(extends: "List rows are boxes inside a boxed panel")**
- **Pages:** /reports (correct), /notifications/rules, /audit-log, /help/*; both themes.
- **What you see:**
  - Reports: open hairline rows.
  - Rules and Audit log: a second rounded, washed box inside the Panel. Headers are a step fainter (`text-subtle`) and row rules fainter still (`border-layer/5`), with body text at 11–12px mono.
  - Help tables: a full grid with a border on every cell and a tinted head.
- **Cause:**
  - `notifications/rules/page.tsx:112` (wrapper), `:114` (head `text-subtle`), `:129` (`border-layer/5`).
  - `AuditLogClient.tsx:220, 222, 247` (the same three).
  - `MarkdownRenderer.tsx:99, 105, 108, 113` (`border` on the table, th and td, plus `bg-layer/[0.04]` head).
  - Reference: `ReportsClient.tsx:82-105`.
- **Fix:** Add a shared table class to `globals.css` components:
  ```css
  .aur-table { @apply w-full text-left font-body text-[13px]; }
  .aur-table th { @apply py-2 pr-3 font-mono text-[10px] font-normal uppercase tracking-label text-muted; }
  .aur-table tbody tr { @apply border-t border-layer/10; }
  .aur-table td { @apply py-2 pr-3; }
  ```
  - Rules :112 and Audit :220: wrapper becomes `overflow-x-auto` only, and the table becomes `aur-table min-w-[800px]`. Drop the per-th, td and tr classes.
  - MarkdownRenderer: table → `aur-table`, remove the th/td `border border-layer/10` and the thead `bg-layer/[0.04]`.
  - Reports tables adopt the same class.
- **Shared or local:** shared.

### 5. **The "Stage funnel" exists twice in two chart grammars, and Won is cobalt on Reports but green everywhere else** · medium · **(extends: hex-alpha and stage-hue findings)**
- **Pages:** /pipeline vs /reports (also Home stage tiles); both themes.
- **What you see:**
  - /pipeline: 36px-tall boxed tracks, coloured mono "S1 · IDENTIFIED" labels, and a 2px coloured right edge. The gradient fill is currently invisible.
  - /reports: the same stages as sentence-case labels with 8px solid blue bars.
  - Pipeline's "W · WON" and the Home "W" tile are green, but Reports draws "Won" in cobalt: the funnel's Won row bar, the "Won" legend swatch, and the month Won bars.
  - Fixing the accepted hex-alpha and stage-hue items only recolours /pipeline; the two shapes still differ.
- **Cause:**
  - `pipeline/PipelineFunnel.tsx:65-81` (label `style={{color}}`, `h-9 … border` track, gradient fill) and `:137-155` (outcome rows).
  - `reports/ReportsClient.tsx:216-223` (`Bar`: `h-2 rounded bg-layer/5`, fill `bg-teal`), `:99` (funnel incl. Won), `:126` (Won swatch `bg-teal`), `:147`.
- **Fix:**
  - Promote `ReportsClient`'s `Bar` to `src/components/ui/BarMeter.tsx`, replacing the current gradient BarMeter, which has 0 importers. Give it `tone: "accent" | "base" | "won" | "lost" | "muted"` mapping to `bg-cobalt`, `bg-layer/30`, `bg-green`, `bg-red` and `bg-faint`.
  - PipelineFunnel: label → `font-body text-[13px] text-text` with the code in `font-mono text-[10px] text-subtle`, delete the inline `style` colours, and render `<BarMeter … />`. Outcome rows use tone won, lost and muted.
  - Reports: tone `won` for the Won month series, the funnel `won` row, and a legend swatch of `bg-green`.
- **Shared or local:** shared component, two consumers.

### 6. **Notification kind colours contradict the status rule** · medium
- **Pages:** /notifications list and the header bell dropdown on every page; both themes. Verified in code only, because the seed has no notifications.
- **What you see:**
  - The three "you were assigned" kinds are three different colours: review = indigo, section = cobalt, solicitation role = brass ("attention").
  - The two "completed" kinds differ: review = green, opportunity review = cobalt.
  - A comment @mention uses plum, which is reserved for pink team.
- **Cause:** `src/lib/notification-types.ts:22-29`, consumed at `NotificationsClient.tsx:107-116` and `NotificationBellClient.tsx:102-112`. Their tints and borders are also invalid hex-alpha; the codemod covers that.
- **Fix:**
  - `review_assigned`, `review_section_assigned`, `solicitation_role_assigned`, `review_comment_mentioned` → `THEME.cobalt` ("assigned", rule 4).
  - `review_completed`, `opportunity_review_completed` → `THEME.green`.
- **Shared or local:** shared map.

### 7. **Won, Lost and Submitted tiles show a red "● 1 past due"** · medium
- **Pages:** / (Command Center stage grid); both themes. The same logic feeds `StageWidget` on /opportunities.
- **What you see:** The Won tile carries the red "blocked/lost" colour, and so do Lost and Stage 7 Submitted. All three are stages where the response date is meant to have passed.
- **Cause:** `src/app/(app)/opportunities/stage-stats.ts:52-55` counts any elapsed `responseDueDate` as past due regardless of stage. It is rendered red at `CommandCenterStageGrid.tsx:109-113` (and `StageWidget.tsx:99-103`).
- **Fix:** In `buildStageStats`, skip the past-due and soonest-due bookkeeping when the row's stage has `phase === "closed"` or is `submitted` (from `STAGES` in `opportunity-types.ts`).
- **Shared or local:** shared helper.

### 8. **Header console badge wraps onto two lines and uses indigo as an identity colour** · low
- **Pages:** every /admin/* and /platform/* page, for example `admin--light/dark.png`; both themes.
- **What you see:** "PLATFORM / ADMIN" breaks into a two-line, 40px-tall lavender box in a 56px header, while the description beside it truncates. The company console badge is cobalt, the platform one indigo, a colour that means "analysis/review".
- **Cause:** `src/components/shell/HeaderWorkspace.tsx:71-79`. The badge `span` has no `shrink-0 whitespace-nowrap`, so the long description at :80 squeezes it. It uses `border-violet/40 bg-violet/10` for platform.
- **Fix:** Badge className: `shrink-0 whitespace-nowrap rounded-md border border-layer/15 bg-bone px-2 py-1 font-mono text-[10px] uppercase tracking-label text-text`, the same for both consoles, optionally with a leading `aur-diamond`.
- **Shared or local:** shared (shell).

### 9. **Workspace switcher labels are truncated for platform admins** · low
- **Pages:** every page, both themes, for superadmins (3 workspaces). Org admins see 2 workspaces and are fine (`fshots/wide-light-notifs.png`).
- **What you see:** "WORKSP…", "COMPAN…" and "PLATFO…" under the brand on every page.
- **Cause:** `src/components/shell/NavContent.tsx:357` (`grid-cols-3` in a 216px column, so about 69px per cell) and `:555` (`truncate px-2`). The labels are the full names from `src/lib/nav-workspaces.ts:54-67`. The accepted tabs fix for this control (drop the box, add a diamond) takes more width, not less.
- **Fix:** Add `short: "Work" | "Company" | "Platform"` to `WORKSPACES`. Render `m.short` in the expanded switcher with `px-1`, and keep `m.label` in `title` and `aria-label`.
- **Shared or local:** shared (shell).

### 10. **Native checkboxes in the browser's blue, not the brand blue** · low
- **Pages:** /notifications/rules/[id] and /new ("Active", "Escalate"), and about 40 files with checkboxes; both themes.
- **What you see:** A checked box is #0075FF in light and #99C8FF in dark (pixels sampled on rules/[id]), neither of which is the brand's #2953D7 or the accent. A few screens use `accent-teal-400` instead, so checkboxes differ between pages.
- **Cause:** There is no `accent-color` anywhere in `globals.css`. Per-site overrides: `EvaluationForm.tsx:112`, `CompetitorsClient.tsx:116, 290`, `ImportClient.tsx:216`.
- **Fix:** In `@layer base`, add `input[type="checkbox"], input[type="radio"], input[type="range"] { accent-color: rgb(var(--c-action)); }` and remove the `accent-teal-400` overrides. Keep `accent-rose` on the destructive MigrationsClient toggle.
- **Shared or local:** shared.

### 11. **Audit log: plain text in the accent blue, while the clickable control is grey** · low
- **Pages:** /audit-log (and /platform/audit-log); both themes.
- **What you see:** "tenant.view_users" is accent blue and reads as a link, but it isn't one. The only interactive control in the row, "DETAIL", is grey.
- **Cause:** `AuditLogClient.tsx:260` (`text-cobalt` on a `<td>`), `:280` (Detail button `text-muted`). The same pattern is at `PlatformAuditLogClient.tsx:338`.
- **Fix:** The action cell → `text-text`. The Detail button → `text-muted hover:text-accent` (`text-cobalt` until PR A lands).
- **Shared or local:** local (two files).

### 12. **Trial banner's neutral "info" tone is indigo** · low
- **Pages:** every app page while a workspace is on a trial with more than 3 days left; both themes. Verified in code only.
- **What you see:** A lavender full-width bar under the header reading "Trial: N days left". Indigo means analysis/review, and rule 4 makes informational content `muted`.
- **Cause:** `src/components/shell/TrialBanner.tsx:23` (`border-indigo-400/30 bg-indigo-400/10 text-indigo-300`).
- **Fix:** info → `border-layer/10 bg-bone text-muted`. Keep brass for `warn` and red for `ended`.
- **Shared or local:** shared (shell).

### 13. **Empty states drawn three ways** · low
- **Pages:** /notifications (dashed box), / (plain paragraph with blue underlined links), /pipeline (Panel and buttons), /reports (paragraph), /audit-log (mono table row), command palette (mono); both themes.
- **What you see:** The same "nothing here yet" moment looks different on each page. The dashed box on Notifications is the only dashed outline in the app outside the help screenshot placeholders.
- **Cause:** `NotificationsClient.tsx:88`; `page.tsx:145-158, 167-169, 204-213`; `pipeline/page.tsx:80-95`; `ReportsClient.tsx:178`; `AuditLogClient.tsx:233-240`; `CommandPalette.tsx:228`.
- **Fix:** Add `src/components/ui/EmptyState.tsx`, `({ message, action }) => <div className="py-8 text-center"><p className="font-body text-[13px] leading-relaxed text-muted">{message}</p>{action ? <div className="mt-3">{action}</div> : null}</div>`, and use it at the sites above. For a table row, wrap it in `<td colSpan>`.
- **Shared or local:** shared.

### 14. **Header icons mix Unicode glyphs with an SVG** · low
- **Pages:** every page, both themes (header strip of `home--light.png` / `home--dark.png`).
- **What you see:** The theme toggle's ☾ (and ☀) and the search box's ⌕ render smaller and thinner than the stroked SVG bell beside them, in identical 36px boxes.
- **Cause:** `ThemeToggle.tsx:54-56` (text glyph at `text-[14px]`), `HeaderWorkspace.tsx:48, 57` (⌕), `NotificationBell.tsx:27-43` (SVG 16px, stroke 1.7).
- **Fix:** Inline SVG moon, sun and search icons at `width/height 16`, `stroke="currentColor" strokeWidth="1.7"`, matching `BellIcon`. A small `src/components/shell/icons.tsx` can export all four.
- **Shared or local:** shared (shell).

### 15. **Eyebrow names a nav group that doesn't contain the page** · low
- **Pages:** /notifications/rules, /notifications/rules/[id], /notifications/rules/new, /audit-log; both themes.
- **What you see:** The eyebrow reads "◆ OPERATIONS MANAGEMENT", but the sidebar shows these pages under "Governance" in the company console, and under "Administration" in the workspace nav. Onboarding tells the user to go to "Operations Management → Users & Roles", but Users & Roles sits under "People" or "Administration".
- **Cause:**
  - `rules/page.tsx:64`, `rules/[id]/page.tsx:43`, `rules/new/page.tsx:23`, `audit-log/page.tsx:59`, `onboarding/page.tsx:117`.
  - Groups in `src/lib/nav-workspaces.ts:139` (Operations Management holds Settings, Integrations, AI Engine and Notifications), `:151` (Administration), `:203` (Governance).
- **Fix:** Use `eyebrow="Governance"` on the four pages, and change the onboarding copy to "…from Users & Roles in the admin console".
- **Shared or local:** local.

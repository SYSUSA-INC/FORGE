# Handoff for New Session

## Environment
- **Project:** FORGE — Next.js 14 App Router, TypeScript, Tailwind, government-procurement-response SaaS
- **Working dir:** `/home/user/FORGE`
- **Platform:** Linux sandbox, Claude Code CLI
- **Repo:** `sysusa1nc/forge` (GitHub MCP restricted to this repo only)
- **Production:** Vercel → `https://forge-ten-xi.vercel.app/`
- **Prior session ID:** `2b8d77e3-0432-4b9a-903c-4c4a4e31759f` (transcript at `/root/.claude/projects/-home-user-FORGE/2b8d77e3-0432-4b9a-903c-4c4a4e31759f.jsonl`)

## Git State
- **Current local branch:** `claude/org-settings-ui-B68Y8` (off `main` at `e9ee409`, working tree clean)
- **Remote branch:** exists, empty (same SHA as main)
- **Push workaround:** Sandbox `git push` returns HTTP 503 reliably. **Use `mcp__github__push_files` instead of `git push`** for every commit.
- **Target branch for this work:** `claude/org-settings-ui-B68Y8`

## Already Deployed to Production (do NOT redo)
- Aurora teal-dominant palette (`tailwind.config.ts`, `src/app/globals.css`)
- Mobile hamburger nav (`src/components/shell/MobileNav.tsx`, `NavContent.tsx`, `SideNav.tsx`, `AppShell.tsx`)
- `src/lib/orgStore.ts` — `useOrg()` hook, `orgStore.{save,patch,applySamGovFields,clear}`, types `OrgProfile`/`ClearanceLevel`/`Address`/`ContractingVehicle`/`PastPerformance`, `DEFAULT_VEHICLES`, `EMPTY_ORG`
- `src/app/api/samgov/health/route.ts` — validated (`apiReachable:true, totalRecords:735864`)
- `src/app/api/samgov/entity/route.ts` — `GET?uei=…` or `?cage=…` returns `{ok, profile}` or `{ok:false, error}`
- `SAMGOV_API_KEY` env var set on Vercel

## The ONE Pending Task (Phase 1b)
**Write `src/app/settings/page.tsx`** — single client component, rewrite the existing brutalist SYSUSA-hardcoded page.

**Requirements:**
- `"use client"` directive
- Tabs: `Organization` (default) · `Users & Roles` (placeholder) · `Integrations` (placeholder) · `AI Engine` (placeholder)
- Use `useOrg()` for initial state, clone into local `useState` draft, commit via `orgStore.save(draft)` on Save
- SAM.gov sync panel: UEI input → `fetch('/api/samgov/entity?uei=' + uei)` → on success call `orgStore.applySamGovFields(data.profile)` and refresh draft
- Organization sections:
  - Entity banner (reads from `org.name`, `org.uei`, `org.cageCode`, `org.syncSource`, `org.lastSyncedAt`)
  - SAM.gov sync (UEI input, sync button, status)
  - Identity (name, website)
  - Contact (contactName, contactTitle, phone, email)
  - Address (line1, line2, city, state, zip, country)
  - Registration IDs (uei, cageCode, dunsNumber)
  - Security & Compliance (companySecurityLevel + employeeSecurityLevel selects with `ClearanceLevel` values, dcaaCompliant toggle)
  - Classification (primaryNaics input, naicsList chips with add/remove, pscCodes chips)
  - Socio-Economic (6 checkboxes bound to `socioEconomic.sba8a/smallBusiness/sdb/wosb/sdvosb/hubzone`)
  - Contracting Vehicles (civilian + DoW chip groups seeded from `DEFAULT_VEHICLES`, custom add)
  - Past Performance (add/remove rows with customer/contract/value/periodStart/periodEnd/description)
  - Search Keywords (tag input)
  - Save / Reset actions

**Design system (already in `globals.css`):** `aur-card`, `aur-card-elevated`, `aur-btn`, `aur-btn-primary`, `aur-btn-ghost`, `aur-btn-danger`, `aur-input`, `aur-label`, `aur-chip`, `aur-pill`. Components available: `PageHeader`, `Panel` at `src/components/ui/`.

## Ship Sequence
1. `Write` the file in ONE call (no narration between tool calls)
2. `mcp__github__push_files` to `claude/org-settings-ui-B68Y8` with commit msg: `feat(settings): org profile UI with SAM.gov sync (phase 1b)`
3. `mcp__github__create_pull_request` as **draft**, base `main`, title `Phase 1b: Organization settings UI`
4. Wait for Vercel check, then `mcp__github__merge_pull_request` as squash
5. Report PR URL + merged SHA

## Next Phases (after Phase 1b merges)
- Phase 2: User Management
- Phase 3a: Opportunity Capture
- Phase 3b: Opportunity Evaluation
- Phase 4: Proposal Management rework (Pink → Red → Gold → White Gloves)
- Phase 5: Proposal Output (Win/Loss + Debrief)
- Deferred: `src/lib/ai.ts` (Bedrock/Azure/vLLM gateway), `/intelligence` page, empty-state rewrites for legacy pages

## User's Explicit Ground Rules
- **One group = one PR**, merge to production before starting next phase
- **Palette is teal-dominant aurora** (already set — do not change)
- **Mobile must keep hamburger nav** (already set — do not change)
- User has been waiting 20+ hours on Phase 1b → **no further narration, just ship the file**

---

**Instruction for new session:** Resume from this handoff. Start by writing `src/app/settings/page.tsx`.

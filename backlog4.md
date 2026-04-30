# Backlog 4 — Session Handoff (2026-04-30)

Branch: `claude/continue-previous-work-1zd7y`
PR: [#8 — Settings: full Organization form with SAM.gov sync](https://github.com/SYSUSA-INC/FORGE/pull/8) (draft)

---

## What shipped this session

**Settings page rebuilt as a live, editable Organization form.**

- New file: `src/components/settings/OrgSettingsForm.tsx`
- Rewired: `src/app/settings/page.tsx`
- Backed by existing `orgStore` (localStorage, `useSyncExternalStore`)
- Typecheck + `next build` green (12 routes, `/settings` = 5.75 kB)

### Field groups in the form

| Panel | Fields |
|---|---|
| Identity | Legal business name, Website |
| Primary contact | Contact name, Title, Phone, Email |
| Address | Line 1, Line 2, City, State, ZIP, Country |
| Registration IDs · SAM.gov sync | UEI, CAGE, DUNS, sync-source readout, **Sync from SAM.gov** button |
| Security & compliance | Facility clearance, Employee max clearance, DCAA-compliant |
| Socio-economic set-asides | Small Business, 8(a), SDB, WOSB, SDVOSB, HUBZone |
| Classification | Primary NAICS, Secondary NAICS (tag editor), PSC codes (tag editor), Search keywords (tag editor) |
| Contracting vehicles | Civilian + DoD catalog chips + custom add |
| Past performance | Repeatable rows: customer, contract, value, period, scope |

### SAM.gov sync wiring

- Button calls `/api/samgov/entity?uei=...` (or `?cage=...` fallback) — endpoint shipped in PR #5.
- Returned profile patches the draft: Name, Website, Address, POC, Primary/Secondary NAICS, socio-economic flags.
- Surfaces `registrationStatus` + `registrationExpirationDate` inline.
- User reviews and presses **Save** to commit to `orgStore`.

### UX patterns

- **Draft pattern**: local state, commits to `orgStore` only on Save (partial edits don't leak).
- **Sticky save bar**: unsaved-changes pill, last-synced timestamp, Discard / Save / Clear.
- Tag editor: Enter or `,` to add, × to remove.

---

## What is NOT in this PR (intentional)

- AI engine / Integrations / Users panels — kept as static placeholders.
- Postgres backing — still localStorage. Backend scaffolding is the next big block.
- No changes to API routes or mock data.

---

## Open question / blocker

**The user referenced a "FORGE Frontend" session/spec that defines the intended structure.** It was not shared into this session. The current form structure was inferred from:

1. `OrgProfile` type in `src/lib/orgStore.ts` (from PR #5).
2. The follow-up bullet in PR #5's description.
3. The normalized response of `/api/samgov/entity`.

**Action for next session**: get the FORGE Frontend spec (URL, paste, or commit to repo) and reshape the form to match. The plumbing (orgStore, draft pattern, SAM.gov sync, save bar) can stay; only the field groupings / labels / order may need to change.

---

## Recommended next threads (in order)

1. **Reconcile form with FORGE Frontend spec** — once it's shared. Likely a UI-only pass.
2. **Backend scaffolding (PLAN.md Phase 1)** — Prisma schema, Postgres+pgvector, NextAuth, MinIO upload, ingestion worker. Replaces `orgStore` localStorage with a real `org.*` tRPC router. This unblocks every other phase.
3. **Wire Claude API into Editor + Intelligence** — currently `src/lib/intelligence.ts` is localStorage-only; section generation isn't hooked up. Needs at least a thin backend (router + queue) to be useful.
4. **Clean up PR #7** — has an inverted base (head=`main`, base=`claude/brutalist-design-pages-I1tas`); not mergeable as-is.
5. **Fix Next.js security advisory** — `npm install` warned about `next@14.2.15` having a security vulnerability ([advisory](https://nextjs.org/blog/security-update-2025-12-11)). Bump to a patched 14.2.x.

---

## Repo state at handoff

- Working tree clean on `claude/continue-previous-work-1zd7y`.
- 1 commit ahead of `main`: `6de9c39 Settings: full Organization form with SAM.gov sync`.
- Pushed to origin; PR #8 open as draft.
- No conversation-only state to recover — everything is in the PR diff and this file.

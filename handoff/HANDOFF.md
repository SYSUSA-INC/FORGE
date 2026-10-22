# Handoff — UI uniformity (BL-UI-UNIFORM) and what follows

Parking branch only: never open a PR from it, never merge it. Take the
PR A commit from it (below); the `handoff/` folder stays here.

## Where things stand (2026-10-22)

- **PR #399** (BL-STAB-11, superadmin pages crashing on `ANY(${array})`)
  is open as a draft and waiting for the owner's merge.
- **PR A** is the first commit on this branch:
  `fix(ui): BL-UI-UNIFORM — one accent, readable ink and status tones,
  no leftover chrome`.
  - It is built on main `eb0192f` and passes `tsc` and the design and font
    tests.
  - It is not yet a PR.
  - It adds `CLAUDE.md`, which holds the owner's EnableNow palette.

## Finish PR A (next session, after #399 merges)

1. Start the working branch from `origin/main` and cherry-pick the PR A
   commit.
2. Apply the confirmed findings of the PR A review
   (`handoff/pr-a-review.json`, the "confirmed" array; its verifiers
   upheld them). The main one: restore light `--c-muted` to
   `64 80 107` (slate-600) in `src/app/globals.css`.
   - Slate-500 drops tinted chips (`bg-layer/10 … text-muted`, 12 sites)
     below AA.
   - It also merges the muted and subtle tiers.
   - Fix the doc lines to match: the DESIGN_SYSTEM.md ink row and its
     "`muted` 5.4:1" claim, and the commit message.
3. Root-cause fix for palette leaks. Colour families sit in
   `theme.extend.colors`, so Tailwind merges them with its stock palette,
   and undefined stops (`amber-100`, `yellow-400`) render stock hex.
   - Move the colours to `theme.colors`, adding `transparent`, `current`,
     `inherit`, `white` and `black`.
   - Fix the last leak, `Sba8aAdminClient.tsx:440` (`text-amber-100`).
   - Add a test that fails on any colour class naming an undefined
     family or stop, and on arbitrary `[#hex]` colour classes (none
     remain).
   - `tests/design/theme-tokens.test.ts` (~line 97) reads
     `theme.extend.colors`; update it.
   - `handoff/run/palette-scan.cjs` shows the scan.
4. In `docs/BACKLOG.md`:
   - Mark row 3be (BL-UI-ENABLENOW) as shipped in #398.
   - Add a BL-UI-UNIFORM row and a detail entry.
5. Run `tsc`, ESLint on the changed files, `vitest tests/design
   tests/fonts`, and a sample screenshot check. Then open a draft PR
   (template: Summary, the 17-row self-review table, Test plan, Risk).

## After PR A (serial, each under 1,500 changed lines)

- **B — codemods:**
  - Hex alpha appended to `THEME.*` var strings (`${c}1A`, 106 sites,
    invalid CSS) → `withAlpha(c, a)`.
  - Off-palette status hex → `THEME` roles. Not `THEME_HEX`: it holds
    the dark values.
  - Mono 8/9px → 10px.
  - Counts per file: `handoff/color-inventory.json`.
- **C — shared components and patterns:** sidebar, tabs with the
  diamond, hairline stat tiles and list rows, mono paragraphs → sans,
  secondary actions as links, one small button size, one table style,
  chips. Sources: `handoff/themeverdicts.txt` (UP = accepted) and the
  area reports.
- **D — the HTML emails** in the EnableNow style.

**Area reports:** `handoff/assess/{shell,capture,proposals,settings,admin}.md`.
They hold 98 findings across 95 pages, both themes. Each finding gives
file:line, a fix and a severity.
- The verify-and-plan run hit the spend limit. 50 findings were upheld.
- The "refuted" list in `handoff/verify-and-plan.json` is NOT valid:
  those checks errored and never ran. Re-check a finding when you fix it.

**Owner questions to ask** (from the reports):
- Colour-team names (Red, Gold, Green, Pink Team) reuse status hues.
  Ink labels with a team diamond, or all review stages indigo?
- The default template is marked in the tenant's brand colour (unreadable
  teal on white, and a second accent).
- Category and relationship tags (competitor, prime, knowledge kinds)
  use status hues.

## Later

- **BL-STAB-8a (MFA):** round-1 owner decisions are in
  `handoff/bl-stab-8-decisions.md` and BACKLOG. The auth-code map is in
  `handoff/map8*.txt`. Round-2 questions are still to ask:
  - passkeys
  - preview policy
  - an emergency switch
  - OAuth auto-link
  - SIGNUP_MODE
  - the pending-session TTL
  - notification emails
  - factor counts
- Then BL-STAB-3 (map: `handoff/map3*.txt`), 4b and 5.

## Running FORGE locally (screenshots)

- `handoff/withpg.sh '<cmd>'` starts the test Postgres for one command.
  Never run Postgres as a long-lived service.
- `handoff/run/seed.mjs` and `seed2.mjs` seed the demo org
  `enablenow-demo`. The superadmin is `demo@forge.test` /
  `ForgeDemo!2026`, local only.
- `run/run-check.sh <script> [args]` runs `next dev` in its own process
  group, runs the script, then kills the group.
  - `all-pages.cjs <outdir> <routes.txt>` screenshots routes in both
    themes.
  - `routes.txt` lists all 95.
- Scripts expect `node_modules` symlinked next to them, and hard-code the
  old scratchpad path (`/tmp/claude-0/.../scratchpad`); point `S` at the
  new one.

## Keep cost down

- Ultracode is off by the owner's choice. Don't run workflows or agent
  fan-outs unless asked; ask before using more than a handful of agents.
- Screenshot only the pages a change touches, cropped. Prefer code reads
  to image reads.

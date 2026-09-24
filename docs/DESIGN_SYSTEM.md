# FORGE design system — "Boardroom Navy"

> BL-UI-THEME. How colour works in the FORGE UI, where it is defined, and
> the rules that keep it coherent. Read this before adding a colour to a
> component.

## 1. Direction

FORGE is a capture and proposal platform for federal contractors. The
interface is a dark, restrained corporate surface: the proposal text and
the data are the hero, chrome stays quiet, and colour is spent on
meaning, not decoration.

| Family | Role | Where you see it |
|---|---|---|
| **Navy surfaces** (`canvas`, `paper`, `bone`, `concrete`) | Backgrounds and layered panels | Page, sidebar, cards, inputs |
| **Cobalt** (primary) | Actions, links, focus, "in progress", the main data series | Primary buttons, active nav, selection, focus ring |
| **Brass** (signature) | Brand mark, AI moments, attention / warning, highlights | The "F" tile, the hairline on the top chrome, `mark`, comment anchors, warning pills |
| **Green** | Success, won, complete | Status pills, deltas, won stages |
| **Red** | Danger, lost, blocked, mandatory | Danger buttons, failed states, deletions |
| **Indigo** | Analysis and review stages, AI suggestions | Drafting / final-review pills, "AI suggests" |
| **Plum** | Pink-team review | Pink team pill, funnel review stages |

Type: `text` (near-white), `muted` (steel), `subtle` (dim steel), `faint`
(hairlines). Fonts stay Inter (display and body) and JetBrains Mono
(labels, IDs, numbers) — they are self-hosted for CI stability
(BL-QC-fonts) and are not part of this theme.

## 2. Where colour is defined

**One source for CSS, one mirror for JavaScript, tested against each
other.**

1. `src/app/globals.css` — `:root` declares every colour as an RGB
   triplet: `--c-cobalt-500: 76 141 255;`. Families have stops 200–700
   (plum 300–600); surfaces and type are single values.
2. `tailwind.config.ts` — every Tailwind colour is
   `rgb(var(--c-<name>) / <alpha-value>)`, so `bg-canvas/70`,
   `text-emerald-300`, `border-teal/40` all resolve to the variables
   above and alpha modifiers keep working.
3. `src/lib/theme-colors.ts` — `THEME.*` hex constants for anything that
   has to be a JavaScript value: SVG chart fills, inline `style` status
   maps (`src/lib/*-types.ts`), presence cursor colours, PDF template
   defaults. `THEME_VAR_MAP` names the CSS variable each constant
   mirrors and `tests/design/theme-tokens.test.ts` asserts they match.

Email templates (`src/lib/email.ts`, `src/lib/notification-email.ts`)
carry literal hex because mail clients cannot read CSS variables; they
use the same values.

## 3. Names you can use in `className`

Semantic names first; the legacy aliases stay so existing components did
not have to change:

| Use this | Legacy aliases that resolve to the same family |
|---|---|
| `cobalt`, `cobalt-200…700` | `teal`, `teal-NNN`, `sky`, `sky-200…400` |
| `brass`, `brass-200…700` | `gold`, `hazard`, `amber`, `amber-NNN` |
| `green`, `green-200…700` | `emerald`, `emerald-NNN`, `signal` |
| `red`, `red-200…700` | `rose`, `rose-NNN`, `blood` |
| `indigo`, `indigo-200…700` | `violet`, `violet-NNN` |
| `plum`, `plum-300…600` | `magenta` |
| `canvas`, `paper`, `bone`, `concrete`, `text`, `muted`, `subtle`, `faint` | `ink` (= canvas) |

Every family has a `DEFAULT` (`text-emerald`) **and** numbered stops
(`text-emerald-300`, `bg-emerald-500/15`). Before BL-UI-THEME the config
set these families to flat strings, which deleted the numbered stops
from the generated CSS — about 340 class usages (status pills, "AI
suggests" chips, deltas) rendered unstyled. Keep families as scales.

Utility classes in `globals.css`: `aur-card`, `aur-card-elevated`,
`aur-btn`, `aur-btn-primary`, `aur-btn-ghost`, `aur-btn-danger`,
`aur-input`, `aur-label`, `aur-chip`, `aur-pill`, `aur-divider`,
`aur-ring`, `aur-brand-mark` (cobalt → brass tile), `aur-brand-dot`,
`aur-topline` (brass hairline on the top chrome).

## 4. Rules

1. **No hex in components.** Use a Tailwind class, or `THEME.*` when the
   value must be JavaScript (SVG, inline style). The theme-tokens test
   fails on a `#RRGGBB` literal in `src/components/ui`,
   `src/components/shell`, the status-map modules and the retouched
   panels. Third-party brand marks (SSO buttons) are the only exception
   and live outside those paths.
2. **Alpha via Tailwind** (`bg-cobalt/15`) or `withAlpha(THEME.cobalt, 0.15)`
   in JS. Never hand-write `rgba(...)` with palette numbers.
3. **One primary.** Cobalt is the only action colour. Brass is for the
   brand mark, AI and attention; it is not a second button colour.
4. **Status means the same thing everywhere.** Green = done / won,
   red = blocked / lost / mandatory, brass = attention / partial /
   desired, cobalt = in progress / assigned, indigo = under analysis or
   review, plum = pink team, `muted` = not started / informational.
5. **Adding a colour:** add the `--c-*` triplet(s) in `globals.css`, the
   Tailwind entry in `tailwind.config.ts`, and, if JavaScript needs it,
   the `THEME` constant plus its `THEME_VAR_MAP` entry. Run
   `npx vitest run tests/design`.
6. **Light theme later:** redefine the `--c-*` triplets under a
   `[data-theme="light"]` selector; components need no change. Alpha
   white layers (`bg-white/5`) would need a `--c-layer` variable first.

## 5. Not in this pass

- PDF renderers (`src/lib/pdf-template-render.ts`,
  `src/lib/compliance-crosswalk-render.ts`) keep their own document
  palette; only the starter template defaults moved to the theme.
- `src/components/editor/RichSectionEditor.tsx` keeps one `rgba` comment
  highlight; the editor gets its own pass with BL-AIP-6.

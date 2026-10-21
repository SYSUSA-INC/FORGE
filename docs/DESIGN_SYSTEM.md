# FORGE design system — EnableNow

> BL-UI-THEME, BL-UI-ENABLENOW. How colour, type and shape work in the
> FORGE UI, where they are defined, and the rules that keep them
> coherent. Read this before adding a colour to a component.

## 1. Direction

FORGE follows the EnableNow design system
(enablenow-website.vercel.app/design-system), at the owner's request
(2026-10-21): "a quiet system, with one recurring mark". The proposal
text and the data are the hero; chrome stays quiet.

- **One accent.** Blue means action, selection and emphasis. Everything
  else is ink, slate and paper, so the blue is always saying something.
- **Hairlines, not boxes.** Structure comes from 1px rules and mono
  labels. Cards are paper with a hairline and a 5px corner; only things
  that float (menus, dialogs) get a shadow.
- **Two voices.** Host Grotesk for what you read; Geist Mono for what
  you scan — labels, numbers, times, metadata. Headings are Regular
  (400) with tight tracking: weight comes from size, not boldness.
- **The diamond marks "on".** The small rotated square (`aur-diamond`)
  marks the current nav item, the selected tab, the page eyebrow.

**Two themes, one set of names.** The default is **light**: white paper,
slate ink, the brand blue. The **dark** theme is EnableNow's: cinema
black ground, navy-black panels, pale blue accents. It sits behind the
header toggle (☾ / ☀), is stored per viewer in `localStorage` as
`forge.theme`, and is applied as `data-theme="dark"` on `<html>` before
first paint. Every component is written once; the variables do the work.

| Family | Role | EnableNow source |
|---|---|---|
| **Surfaces** (`canvas`, `paper`, `bone`, `concrete`) | Page, cards, quiet panels, cool panels | white, white, slate-25, slate-50 · dark: dark-ground, dark-wash, dark-cool, slate-700 |
| **Ink** (`text`, `muted`, `subtle`, `faint`) | Body, secondary, tertiary, hairline-grade | slate-800, -600, -500, -300 · dark: white, slate-400, -500, -600 |
| **Cobalt** (primary) | Actions, links, focus, selection, "in progress" | The brand blue scale: 500 = blue-600 `#2953d7` (dark: blue-400) |
| **Green** | Success, won, complete | Supporting teal-700 `#096f64` (dark: signal-300 `#a7e7b5`) |
| **Signal** (`signal-live`) | Something live (the header clock) | signal-300 |
| **Brass** | Attention, warning, partial | FORGE's own: EnableNow has no amber |
| **Red** | Danger, lost, blocked, mandatory | FORGE's own |
| **Indigo** | Analysis and review stages, AI suggestions | FORGE's own: EnableNow's indigo-600 is too close to the brand blue to tell apart |
| **Plum** | Pink-team review | FORGE's own |

## 2. Where it is defined

**One source for CSS, one mirror for JavaScript, tested against each
other.**

1. `src/app/globals.css`: `:root` (light) and `:root[data-theme="dark"]`
   each declare every colour as an RGB triplet, for example
   `--c-cobalt-500: 41 83 215;`. Families have stops 200–700 (plum
   300–600); surfaces and type are single values. The two blocks declare
   the same names (tested). `--c-action` is the primary-button fill:
   blue-600 on every ground, as on EnableNow.
2. `tailwind.config.ts`: every Tailwind colour is
   `rgb(var(--c-<name>) / <alpha-value>)`, so `bg-canvas/70`,
   `text-emerald-300`, `border-layer/10` resolve to the variables above
   and alpha modifiers keep working. It also holds EnableNow's radius
   scale (`rounded-sm` 3px, `rounded-md`/`-lg` 5px, `-xl` 9px, `-2xl`
   14px), its tracking (`tracking-label` 0.06em, `tracking-meta` 0.04em,
   `tracking-title` −0.032em, `tracking-headline` −0.042em; `widest` and
   `wider` follow the labels) and the fonts.
3. `src/lib/theme-colors.ts`: `THEME.*` are **variable references**
   (`rgb(var(--c-cobalt-500))`) for anything in the page that has to be
   a JavaScript value (SVG chart fills, inline status maps, presence
   cursors); they follow the active theme. `THEME_HEX.*` are literal
   hex (the dark values) for contexts with no page variables: HTML
   emails, PDF template defaults, stored data. `withAlpha()` tints
   either kind.
4. `src/app/fonts/`: Host Grotesk (variable, wght 300–800) and Geist Mono
   (Regular), self-hosted with their OFL licences; `layout.tsx` binds
   them to `--font-display` and `--font-mono`. The `:root` fallbacks sit
   in a zero-specificity `:where(:root)` block so the loaded fonts
   always win.

**Stops are roles, not lightness.** `200`/`300` are text-on-a-tint tones
(dark on the light theme, light on the dark theme), `400` is a solid mid
tone or gradient start, `500` (`DEFAULT`) is a readable solid on the
canvas, `600`/`700` are deep. So `bg-emerald-500/15 text-emerald-300`
reads correctly on both themes without a `dark:` variant anywhere.

**`layer` is the ink for translucent layers**: EnableNow navy (blue-900)
on light, white on dark. `border-layer/10` lands on EnableNow's hairline
(slate-100) and `border-layer/15` on its strong hairline (slate-200).
Never use `bg-white/5`: it is invisible on the light theme, and the token
test rejects it.

## 3. Names you can use in `className`

Semantic names first; the legacy aliases stay so existing components did
not have to change:

| Use this | Legacy aliases that resolve to the same family |
|---|---|
| `cobalt`, `cobalt-200…700` | `teal`, `teal-NNN`, `sky`, `sky-200…400` |
| `brass`, `brass-200…700` | `gold`, `hazard`, `amber`, `amber-NNN` |
| `green`, `green-200…700` | `emerald`, `emerald-NNN`, `signal` (plus `signal-live`, `signal-soft`) |
| `red`, `red-200…700` | `rose`, `rose-NNN`, `blood` |
| `indigo`, `indigo-200…700` | `violet`, `violet-NNN` |
| `plum`, `plum-300…600` | `magenta` |
| `canvas`, `paper`, `bone`, `concrete`, `text`, `muted`, `subtle`, `faint`, `layer`, `action` | `ink` (= canvas) |

Utility classes in `globals.css`:

- **Cards:** `aur-card` (paper, hairline, 5px), `aur-card-flat` (the bone
  wash), `aur-card-elevated` (the float shadow, for what lifts off the
  page).
- **Buttons:** EnableNow's three: `aur-btn-primary` (solid action blue),
  `aur-btn` (the light button), `aur-btn-ghost` (text). Also
  `aur-btn-danger`.
- **Forms and labels:** `aur-input` (Host Grotesk, strong hairline),
  `aur-label` (Geist Mono, uppercase, 0.06em).
- **Chips and dividers:** `aur-chip`, `aur-pill`, `aur-divider`.
- **Marks:** `aur-diamond` (the "on" mark), `aur-brand-mark` (the "F"
  tile in the action blue).

## 4. Rules

1. **No hex in components.** Use a Tailwind class, or `THEME.*` when the
   value must be JavaScript (SVG, inline style). The theme-tokens test
   fails on a `#RRGGBB` literal in `src/components/ui`,
   `src/components/shell`, the status-map modules and the retouched
   panels. Third-party brand marks (SSO buttons) are the only exception
   and live outside those paths.
2. **Alpha via Tailwind** (`bg-cobalt/15`) or `withAlpha(THEME.cobalt, 0.15)`
   in JS. Never hand-write `rgba(...)` with palette numbers.
3. **One accent.** Cobalt is the only action and emphasis colour. Brass
   is attention, not a second accent or a brand colour.
4. **Status means the same thing everywhere.** Green = done / won,
   red = blocked / lost / mandatory, brass = attention / partial /
   desired, cobalt = in progress / assigned, indigo = under analysis or
   review, plum = pink team, `muted` = not started / informational.
5. **Hairlines before shadows.** A card is a hairline on paper; reach
   for `aur-card-elevated` only for something that floats over the page.
6. **Type roles.** Headings are `font-normal` (400) with
   `tracking-title` or `tracking-headline`; small titles and UI are
   `font-medium` (500). Mono labels use `tracking-label`, not wide
   arbitrary tracking.
7. **Adding a colour:** add the `--c-*` triplet(s) to **both** blocks in
   `globals.css`, the Tailwind entry in `tailwind.config.ts`, and, if
   JavaScript needs it, the role in `THEME_VAR_MAP` plus its `THEME_HEX`
   value. Run `npx vitest run tests/design`.
8. **Theme switching:** `ThemeToggle` (`src/components/shell/`) sets
   `data-theme` and `localStorage["forge.theme"]`; the inline script in
   `app/layout.tsx` re-applies it before paint. Never branch on the
   theme in a component; put the difference in the variables.

## 5. Not in this pass

- PDF renderers (`src/lib/pdf-template-render.ts`,
  `src/lib/compliance-crosswalk-render.ts`) keep their own document
  palette and fonts; tenants style their documents through templates.
- `src/components/editor/RichSectionEditor.tsx` keeps one `rgba` comment
  highlight; the editor gets its own pass with BL-AIP-6.

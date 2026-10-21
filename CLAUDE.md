# CLAUDE.md — FORGE

Read `AGENTS.md` first: it holds the agent guidelines, the conventions
and the pointers to `docs/ENGINEERING_STANDARDS.md`. This file adds the
brand palette so it is in front of you whenever you touch the UI.

@AGENTS.md

## Brand palette (EnableNow, owner 2026-10-21)

FORGE follows the EnableNow design system. These are its colours as the
owner gave them. In components, never write the hex: use the FORGE
token on the right (a Tailwind class, or `THEME.*` in JavaScript). The
rules and the full token list are in `docs/DESIGN_SYSTEM.md`.

**Core brand colours**

| Colour | Hex | FORGE token |
|---|---|---|
| Brand Blue | `#2953D7` | `action`, `accent` (light), `cobalt` / `cobalt-500` (light) |
| Deep Blue | `#06268F` | `cobalt-200`, `cobalt-700` (light): blue text on a pale tint |
| Navy | `#0C1F59` | `layer` (light): hairlines and washes as `border-layer/10`, `bg-layer/5` |
| Night Blue | `#030C22` | not a token (the dark ground is slate-950 `#050608`) |
| Bright Blue | `#4583FF` | `cobalt-400` (dark) |

**Light backgrounds**

| Colour | Hex | FORGE token |
|---|---|---|
| White | `#FFFFFF` | `canvas`, `paper` (light) |
| Slate 25 | `#F6F7FA` | `bone` (light): quiet panels |
| Slate 50 | `#EEF1F7` | `concrete` (light): cool panels |
| Blue 50 | `#EEF3FF` | `cobalt-200` (dark) |
| Blue 100 | `#DCE5FF` | `cobalt-300` (dark) |
| Blue 200 | `#B8C9FF` | `accent`, `cobalt` / `cobalt-500` (dark) |

**Supporting colours** — used selectively, not on every screen.

| Colour | Hex | FORGE token |
|---|---|---|
| Teal | `#096F64` | `green` / `green-500` (light), `signal-live` (light): success, done, won |
| Indigo | `#254AC4` | not a token: too close to Brand Blue to read as a separate status; FORGE's `indigo` family (analysis, review) is its own |
| Spark Blue | `#1D52F9` | not a token: one blue carries action and emphasis |
| Signal Light Green | `#E5FFE8` | `signal-soft`, `green-200` (dark) |
| Signal Green | `#A7E7B5` | `signal-live` (dark), `green-300` (dark) |

Light and dark use the same names. Where a row says "(light)" or
"(dark)", that theme's `globals.css` block holds the value. The other
theme holds the matching colour for its ground.

**The rules that make it read as one system** (`docs/DESIGN_SYSTEM.md` §4):

- **One accent.** Blue means action, selection and emphasis. Everything
  else is ink, slate and paper.
- **Hairlines, not boxes.** A card is paper with a 1px hairline. Only
  menus and dialogs float with a shadow.
- **Status means the same thing everywhere.**
  - green: done or won;
  - red: blocked, lost or mandatory;
  - brass: attention or partial;
  - cobalt: in progress;
  - indigo: analysis or review;
  - plum: pink team;
  - muted: not started.
- **No hex or `rgba(...)` palette values in components.** For alpha, use
  `bg-cobalt/15` in classes and `withAlpha(THEME.cobalt, 0.15)` in
  JavaScript. Never append hex alpha to a `THEME.*` value: it is a
  `var()` reference, so `${THEME.cobalt}1A` is invalid CSS.

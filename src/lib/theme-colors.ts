/**
 * BL-UI-THEME — FORGE "Boardroom Navy" corporate palette.
 *
 * The single source of truth for every color that has to live in
 * JavaScript: SVG chart fills, inline `style` status maps, presence
 * cursors, PDF template defaults. Everything rendered through Tailwind
 * uses the CSS variables in `src/app/globals.css` instead (the two are
 * kept in step by tests/design/theme-tokens.test.ts).
 *
 * Direction: a dark, restrained corporate surface for a federal capture
 * platform. One primary (cobalt) for actions and focus, one signature
 * accent (brass — the forge) for brand marks, AI moments and attention,
 * and muted green / red for outcomes. No neon, no pink, nothing that
 * competes with the proposal text.
 *
 * Pure constants — no "server-only" so client components and charts can
 * import it.
 */

export const THEME = {
  // Surfaces
  canvas: "#0B1220",
  paper: "#111A2B",
  bone: "#182338",
  concrete: "#243452",
  // Type
  text: "#EEF2F8",
  muted: "#A3B1C6",
  subtle: "#6B7A93",
  faint: "#4B586E",
  // Primary — actions, links, focus, "in progress"
  cobalt: "#4C8DFF",
  cobaltLight: "#93B8FF",
  cobaltDeep: "#2F6FE0",
  // Signature — brand mark, AI, attention / warning
  brass: "#D3A84C",
  brassLight: "#E6C97E",
  brassDeep: "#B98C36",
  // Outcomes
  green: "#3FB88A",
  greenLight: "#8AD8B8",
  greenDeep: "#2F9A72",
  red: "#E0606E",
  redLight: "#EE9BA4",
  redDeep: "#C24957",
  // Secondary accents — analysis / review stages
  indigo: "#8090E8",
  indigoLight: "#B3BCF5",
  plum: "#B984CC",
  plumDeep: "#9D6AB0",
} as const;

export type ThemeColor = keyof typeof THEME;

/**
 * Which `--c-*` variable in globals.css each JS constant mirrors. The
 * theme-tokens test asserts the hex above equals the RGB triplet in CSS
 * so the two sources cannot drift apart.
 */
export const THEME_VAR_MAP: Record<ThemeColor, string> = {
  canvas: "canvas",
  paper: "paper",
  bone: "bone",
  concrete: "concrete",
  text: "text",
  muted: "muted",
  subtle: "subtle",
  faint: "faint",
  cobalt: "cobalt-500",
  cobaltLight: "cobalt-300",
  cobaltDeep: "cobalt-600",
  brass: "brass-500",
  brassLight: "brass-300",
  brassDeep: "brass-600",
  green: "green-500",
  greenLight: "green-300",
  greenDeep: "green-600",
  red: "red-500",
  redLight: "red-300",
  redDeep: "red-600",
  indigo: "indigo-500",
  indigoLight: "indigo-300",
  plum: "plum-500",
  plumDeep: "plum-600",
};

/**
 * Ordered categorical series for charts (funnel stages, pie slices).
 * Alternates hue families so adjacent series stay distinguishable
 * without leaving the corporate register.
 */
export const CHART_SERIES: readonly string[] = [
  THEME.cobaltLight,
  THEME.cobalt,
  THEME.cobaltDeep,
  THEME.brassLight,
  THEME.brass,
  THEME.indigo,
  THEME.plum,
  THEME.plumDeep,
  THEME.green,
];

/**
 * Collaboration presence cursors. Twelve hues a viewer can tell apart on
 * the navy canvas; deliberately brighter than the UI palette because a
 * 2px caret has to be found at a glance.
 */
export const PRESENCE_PALETTE: readonly string[] = [
  THEME.cobalt,
  THEME.brass,
  THEME.green,
  THEME.plum,
  THEME.red,
  THEME.indigo,
  THEME.cobaltLight,
  THEME.brassLight,
  THEME.greenLight,
  THEME.redLight,
  THEME.indigoLight,
  "#7CC4E8", // steel blue — completes the dozen without repeating a family
];

/** `#RRGGBB` → `r g b` (the `--c-*` variable format). */
export function hexToRgbTriplet(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a 6-digit hex color: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** `#RRGGBB` + alpha (0..1) → `rgba(...)` for inline styles. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgbTriplet(hex).split(" ");
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

import type { Config } from "tailwindcss";

/**
 * BL-UI-THEME — every color resolves to a CSS variable declared in
 * src/app/globals.css (`--c-<name>: r g b`), so the palette can be
 * re-tuned (or a light theme added) without touching a component.
 *
 * Why scales and not flat strings: Tailwind's `extend.colors` REPLACES a
 * default palette key when the extension is a string. The previous
 * config set `teal`, `emerald`, `rose`, `violet` and `sky` to single hex
 * strings, which deleted `teal-300`, `emerald-500/15`,
 * `rose-300` … from the generated CSS — roughly 340 class usages across
 * the app rendered nothing. Each key below is an object with a DEFAULT
 * and numbered stops, so both `text-emerald` and `text-emerald-300`
 * resolve.
 *
 * BL-UI-ENABLENOW — the values behind the variables follow the EnableNow
 * design system (see globals.css); this file only names them. The radius
 * scale below is EnableNow's too (3 / 5 / 9 / 14 px), so `rounded-lg`
 * on a card renders the 5px corner without touching the component.
 *
 * Semantic mapping (legacy names kept so no component has to change):
 *   teal / cobalt / sky      → cobalt (primary)
 *   gold / hazard / amber    → brass (signature + attention)
 *   emerald / signal         → green (success)
 *   rose / blood             → red (danger)
 *   violet                   → indigo (analysis / review)
 *   magenta / plum           → plum (pink team)
 */
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const scale = (family: string, stops: number[], defaultStop: number) => {
  const out: Record<string, string> = { DEFAULT: v(`${family}-${defaultStop}`) };
  for (const s of stops) out[String(s)] = v(`${family}-${s}`);
  return out;
};

const SIX = [200, 300, 400, 500, 600, 700];

const cobalt = scale("cobalt", SIX, 500);
const brass = scale("brass", SIX, 500);
const green = scale("green", SIX, 500);
const red = scale("red", SIX, 500);
const indigo = scale("indigo", SIX, 500);
const plum = scale("plum", [300, 400, 500, 600], 500);

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"),
        ink: v("canvas"),
        paper: v("paper"),
        bone: v("bone"),
        concrete: v("concrete"),
        text: v("text"),
        muted: v("muted"),
        subtle: v("subtle"),
        faint: v("faint"),
        // Translucent-layer ink: white on the dark theme, navy on the
        // light one. `bg-layer/5`, `border-layer/10` replace the old
        // white-alpha layer classes so depth reads in both themes.
        layer: v("layer"),
        // The primary-button fill (EnableNow blue-600 on every ground) and
        // the live signal green (the office clocks).
        action: v("action"),
        signal: { ...green, live: v("signal"), soft: v("signal-soft") },

        cobalt,
        brass,
        green,
        red,
        indigo,
        plum,

        // Legacy semantic aliases (see header).
        teal: cobalt,
        sky: { ...cobalt, DEFAULT: v("cobalt-200") },
        gold: brass,
        hazard: brass,
        amber: brass,
        emerald: green,
        rose: red,
        blood: red,
        violet: indigo,
        magenta: plum,
      },
      fontFamily: {
        display: ["var(--font-display)", "Host Grotesk", "Arial", "ui-sans-serif", "system-ui", "sans-serif"],
        stencil: ["var(--font-stencil)", "Host Grotesk", "Arial", "sans-serif"],
        mono: ["var(--font-mono)", "Geist Mono", "ui-monospace", "SF Mono", "Menlo", "monospace"],
        body: ["var(--font-body)", "Host Grotesk", "Arial", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      // EnableNow radii: s 3px (controls), m 5px (cards), glass 9px, l 14px.
      borderRadius: {
        sm: "3px",
        DEFAULT: "3px",
        md: "5px",
        lg: "5px",
        xl: "9px",
        "2xl": "14px",
        "3xl": "14px",
      },
      // EnableNow tracking: labels 0.06em, meta 0.04em; titles tighten.
      // `widest` / `wider` (FORGE's mono label classes) follow the labels.
      letterSpacing: {
        label: "0.06em",
        meta: "0.04em",
        widest: "0.06em",
        wider: "0.04em",
        title: "-0.032em",
        headline: "-0.042em",
      },
      // EnableNow has no drop shadows on the page: hairlines carry the
      // structure, and only what floats (menus, dialogs) gets the float
      // shadow. The old glow names stay so components keep compiling.
      boxShadow: {
        glow: "none",
        "glow-teal": "none",
        "glow-emerald": "none",
        "glow-gold": "none",
        "glow-magenta": "none",
        card: "0 1px 2px rgb(var(--c-shadow) / var(--shadow-a))",
        "card-lg": "var(--shadow-float)",
        brut: "0 1px 2px rgb(var(--c-shadow) / var(--shadow-a))",
        "brut-sm": "0 1px 2px rgb(var(--c-shadow) / var(--shadow-a))",
        "brut-lg": "var(--shadow-float)",
        float: "var(--shadow-float)",
      },
      animation: {
        aurora: "aurora 18s ease-in-out infinite",
        pulseSoft: "pulseSoft 2.6s ease-in-out infinite",
        blink: "blink 1.2s steps(2, start) infinite",
        marquee: "marquee 40s linear infinite",
      },
      keyframes: {
        aurora: {
          "0%,100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(20px,-10px,0) scale(1.05)" },
        },
        pulseSoft: {
          "0%,100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        blink: { to: { visibility: "hidden" } },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;

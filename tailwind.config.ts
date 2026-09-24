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
        signal: green,
        rose: red,
        blood: red,
        violet: indigo,
        magenta: plum,
      },
      fontFamily: {
        display: ["var(--font-display)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        stencil: ["var(--font-stencil)", "Inter", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "SF Mono", "Menlo", "monospace"],
        body: ["var(--font-body)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 32px rgb(var(--c-cobalt-500) / 0.22)",
        "glow-teal": "0 0 32px rgb(var(--c-cobalt-500) / 0.26)",
        "glow-emerald": "0 0 32px rgb(var(--c-green-500) / 0.18)",
        "glow-gold": "0 0 32px rgb(var(--c-brass-500) / 0.22)",
        "glow-magenta": "0 0 32px rgb(var(--c-plum-500) / 0.18)",
        card: "0 1px 0 rgb(255 255 255 / 0.04) inset, 0 8px 24px rgb(0 0 0 / 0.35)",
        "card-lg": "0 1px 0 rgb(255 255 255 / 0.04) inset, 0 16px 48px rgb(0 0 0 / 0.45)",
        brut: "0 1px 0 rgb(255 255 255 / 0.04) inset, 0 8px 24px rgb(0 0 0 / 0.35)",
        "brut-sm": "0 1px 0 rgb(255 255 255 / 0.04) inset, 0 4px 12px rgb(0 0 0 / 0.3)",
        "brut-lg": "0 1px 0 rgb(255 255 255 / 0.04) inset, 0 16px 48px rgb(0 0 0 / 0.45)",
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

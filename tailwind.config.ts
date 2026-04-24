import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#041827",
        ink: "#041827",
        paper: "#07273D",
        bone: "#0B3754",
        concrete: "#134867",
        text: "#E8FAFF",
        muted: "#9BC9D9",
        subtle: "#5B8AA0",
        violet: "#8B5CF6",
        cobalt: "#8B5CF6",
        plum: "#EC4899",
        magenta: "#EC4899",
        emerald: "#34D399",
        signal: "#34D399",
        teal: "#2DD4BF",
        sky: "#A5F3FC",
        gold: "#2DD4BF",
        hazard: "#2DD4BF",
        rose: "#F472B6",
        blood: "#F472B6",
      },
      fontFamily: {
        display: ["var(--font-display)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        stencil: ["var(--font-stencil)", "Inter", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "SF Mono", "Menlo", "monospace"],
        body: ["var(--font-body)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 40px rgba(45, 212, 191, 0.28)",
        "glow-emerald": "0 0 40px rgba(52, 211, 153, 0.22)",
        "glow-gold": "0 0 40px rgba(45, 212, 191, 0.24)",
        "glow-teal": "0 0 40px rgba(45, 212, 191, 0.32)",
        "glow-magenta": "0 0 40px rgba(236, 72, 153, 0.22)",
        card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.35)",
        "card-lg": "0 1px 0 rgba(255,255,255,0.04) inset, 0 16px 48px rgba(0,0,0,0.45)",
        brut: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.35)",
        "brut-sm": "0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 12px rgba(0,0,0,0.3)",
        "brut-lg": "0 1px 0 rgba(255,255,255,0.04) inset, 0 16px 48px rgba(0,0,0,0.45)",
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

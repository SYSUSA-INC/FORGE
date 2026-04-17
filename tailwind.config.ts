import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0A0A0A",
        paper: "#F5F1E8",
        bone: "#EDE5D3",
        concrete: "#D4CBB5",
        hazard: "#FFD500",
        blood: "#E63026",
        signal: "#00E676",
        cobalt: "#1E40FF",
        plum: "#7C2D92",
      },
      fontFamily: {
        display: ["var(--font-display)", "Arial Black", "Impact", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "Menlo", "monospace"],
        body: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        brut: "6px 6px 0 0 #0A0A0A",
        "brut-sm": "3px 3px 0 0 #0A0A0A",
        "brut-lg": "10px 10px 0 0 #0A0A0A",
        "brut-hazard": "6px 6px 0 0 #FFD500",
        "brut-blood": "6px 6px 0 0 #E63026",
        "brut-signal": "6px 6px 0 0 #00E676",
      },
      animation: {
        marquee: "marquee 30s linear infinite",
        blink: "blink 1s steps(2, start) infinite",
        scan: "scan 4s linear infinite",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        blink: { to: { visibility: "hidden" } },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;

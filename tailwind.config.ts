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
        rust: "#B24A1F",
        teal: "#0E9488",
      },
      fontFamily: {
        display: ["var(--font-display)", "Arial Black", "Impact", "sans-serif"],
        stencil: ["var(--font-stencil)", "Arial Black", "Impact", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "Menlo", "monospace"],
        body: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        brut: "6px 6px 0 0 #0A0A0A",
        "brut-sm": "3px 3px 0 0 #0A0A0A",
        "brut-lg": "10px 10px 0 0 #0A0A0A",
        "brut-xl": "14px 14px 0 0 #0A0A0A",
        "brut-hazard": "6px 6px 0 0 #FFD500",
        "brut-blood": "6px 6px 0 0 #E63026",
        "brut-signal": "6px 6px 0 0 #00E676",
        "brut-cobalt": "6px 6px 0 0 #1E40FF",
        "inset-brut": "inset 4px 4px 0 0 #0A0A0A",
      },
      animation: {
        marquee: "marquee 40s linear infinite",
        "marquee-fast": "marquee 18s linear infinite",
        blink: "blink 1s steps(2, start) infinite",
        scan: "scan 4s linear infinite",
        pulse__: "pulse__ 2.2s ease-in-out infinite",
        shake__: "shake__ 0.4s ease-in-out infinite",
        teletype: "teletype 3.4s steps(40, end) infinite",
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
        pulse__: {
          "0%,100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.05)", opacity: "0.82" },
        },
        shake__: {
          "0%,100%": { transform: "translate(0,0)" },
          "25%": { transform: "translate(-0.5px,0.5px)" },
          "50%": { transform: "translate(0.5px,-0.5px)" },
          "75%": { transform: "translate(-0.5px,-0.5px)" },
        },
        teletype: {
          "0%": { width: "0%" },
          "60%,100%": { width: "100%" },
        },
      },
      backgroundImage: {
        "grid-paper":
          "linear-gradient(rgba(10,10,10,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(10,10,10,0.06) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};

export default config;

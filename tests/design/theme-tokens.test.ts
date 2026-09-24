/**
 * BL-UI-THEME — the palette has two sources (CSS variables for Tailwind,
 * THEME constants for JavaScript). These tests keep them identical, make
 * sure every colour family is a real scale (the flat-string override that
 * deleted `emerald-300` & co. can't come back), and keep hex literals out
 * of the themed component paths.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import tailwindConfig from "../../tailwind.config";
import {
  CHART_SERIES,
  PRESENCE_PALETTE,
  THEME,
  THEME_VAR_MAP,
  hexToRgbTriplet,
  withAlpha,
} from "@/lib/theme-colors";

const ROOT = join(__dirname, "..", "..");
const GLOBALS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

function cssVars(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of GLOBALS.matchAll(/--c-([a-z0-9-]+):\s*(\d{1,3}) (\d{1,3}) (\d{1,3});/g)) {
    out.set(m[1]!, `${m[2]} ${m[3]} ${m[4]}`);
  }
  return out;
}

describe("theme tokens — CSS ↔ JS parity", () => {
  const vars = cssVars();

  it("declares the palette as RGB triplets in globals.css", () => {
    expect(vars.size).toBeGreaterThanOrEqual(40);
    expect(vars.get("canvas")).toBe("11 18 32");
    expect(vars.get("cobalt-500")).toBe("76 141 255");
    expect(vars.get("brass-500")).toBe("211 168 76");
  });

  it("every THEME constant equals the CSS variable it mirrors", () => {
    for (const [key, hex] of Object.entries(THEME)) {
      const varName = THEME_VAR_MAP[key as keyof typeof THEME];
      expect(vars.has(varName), `--c-${varName} missing for THEME.${key}`).toBe(true);
      expect(hexToRgbTriplet(hex), `THEME.${key}`).toBe(vars.get(varName));
    }
  });

  it("hex helpers", () => {
    expect(hexToRgbTriplet("#4C8DFF")).toBe("76 141 255");
    expect(withAlpha("#4C8DFF", 0.15)).toBe("rgba(76, 141, 255, 0.15)");
    expect(withAlpha("#4C8DFF", 2)).toBe("rgba(76, 141, 255, 1)");
    expect(() => hexToRgbTriplet("#fff")).toThrow();
  });

  it("chart and presence palettes are distinct hexes", () => {
    expect(new Set(CHART_SERIES).size).toBe(CHART_SERIES.length);
    expect(PRESENCE_PALETTE.length).toBe(12);
    expect(new Set(PRESENCE_PALETTE).size).toBe(12);
    for (const c of [...CHART_SERIES, ...PRESENCE_PALETTE]) {
      expect(c).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe("theme tokens — Tailwind config", () => {
  const colors = (tailwindConfig.theme?.extend?.colors ?? {}) as Record<
    string,
    string | Record<string, string>
  >;
  const vars = cssVars();

  it("every colour family is a scale with a DEFAULT and numbered stops", () => {
    const families = [
      "cobalt", "brass", "green", "red", "indigo", "plum",
      "teal", "sky", "gold", "hazard", "amber", "emerald", "signal", "rose", "blood", "violet", "magenta",
    ];
    for (const f of families) {
      const entry = colors[f];
      expect(typeof entry, `${f} must be an object scale, not a flat string`).toBe("object");
      const scale = entry as Record<string, string>;
      for (const stop of ["DEFAULT", "300", "400", "500"]) {
        expect(scale[stop], `${f}-${stop}`).toBeDefined();
      }
    }
  });

  it("every colour resolves to a declared --c-* variable with an alpha slot", () => {
    const values: string[] = [];
    for (const entry of Object.values(colors)) {
      if (typeof entry === "string") values.push(entry);
      else values.push(...Object.values(entry));
    }
    expect(values.length).toBeGreaterThan(50);
    for (const v of values) {
      const m = /^rgb\(var\(--c-([a-z0-9-]+)\) \/ <alpha-value>\)$/.exec(v);
      expect(m, `unexpected colour value ${v}`).not.toBeNull();
      expect(vars.has(m![1]!), `--c-${m![1]} is not declared in globals.css`).toBe(true);
    }
  });
});

describe("theme tokens — no hex literals in themed paths", () => {
  const HEX = /#[0-9a-fA-F]{6}\b/g;
  const FILES = [
    "tailwind.config.ts",
    "src/app/globals.css",
    "src/app/(auth)/layout.tsx",
    "src/lib/collab-user.ts",
    "src/lib/proposal-types.ts",
    "src/lib/compliance-types.ts",
    "src/lib/review-types.ts",
    "src/lib/opportunity-types.ts",
    "src/lib/evaluation-types.ts",
    "src/lib/notification-types.ts",
    "src/lib/company-types.ts",
    "src/app/(app)/solicitations/[id]/KeyDateTimeline.tsx",
    "src/app/(app)/solicitations/[id]/SolicitationDocumentsPanel.tsx",
    "src/app/(app)/solicitations/[id]/page.tsx",
    "src/app/(app)/solicitations/[id]/diff/DiffView.tsx",
    "src/app/(app)/proposals/[id]/ProposalScanPanel.tsx",
    "src/app/(app)/proposals/[id]/outcome/ProtestViabilityPanel.tsx",
    "src/app/(app)/proposals/[id]/sections/SectionsClient.tsx",
    "src/components/editor/TrackChangesSidebar.tsx",
    "src/components/editor/SnapshotsSidebar.tsx",
    "src/components/auth/UserMenu.tsx",
    "src/app/(public)/layout.tsx",
    "src/app/(public)/pricing/page.tsx",
    "src/app/review/[token]/page.tsx",
    "src/app/(app)/users/UsersClient.tsx",
    "src/app/(app)/knowledge-base/KnowledgeBaseClient.tsx",
    "src/app/(app)/knowledge-base/import/SemanticSearchClient.tsx",
    "src/app/(app)/proposals/[id]/sections/ai/BrainSuggestPanel.tsx",
    "src/app/(app)/proposals/[id]/compliance/AutoMapPanel.tsx",
    "src/app/(app)/proposals/[id]/compliance/EvidenceDock.tsx",
    "src/app/(app)/proposals/[id]/BrainMinePanel.tsx",
  ];
  const DIRS = ["src/components/ui", "src/components/shell", "src/app/(auth)"];

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.(tsx?|css)$/.test(name)) out.push(p);
    }
    return out;
  }

  // Palette numbers hand-written as rgba(...) are the other way colour
  // drifts; black / white overlays (shadows, hairlines) are fine.
  const PALETTE_RGBA = /rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,/g;

  it("components, shell, status maps and retouched panels use tokens, not hex", () => {
    const paths = [
      ...FILES.map((f) => join(ROOT, f)),
      ...DIRS.flatMap((d) => walk(join(ROOT, d))),
    ];
    const offenders: string[] = [];
    for (const p of paths) {
      const src = readFileSync(p, "utf8");
      const hits: string[] = [...(src.match(HEX) ?? [])];
      for (const m of src.matchAll(PALETTE_RGBA)) {
        const [r, g, b] = [m[1], m[2], m[3]].map(Number);
        const mono = (r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255);
        if (!mono) hits.push(m[0]);
      }
      if (hits.length > 0) offenders.push(`${p.replace(ROOT + "/", "")}: ${hits.join(", ")}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

/**
 * BL-UI-THEME — the palette has two themes (light default, dark under
 * `data-theme="dark"`) and two consumers (Tailwind via CSS variables,
 * JavaScript via THEME / THEME_HEX). These tests keep them coherent:
 * both themes declare the same variables, every Tailwind colour points
 * at a declared variable and is a real scale, THEME references only
 * declared variables, THEME_HEX matches the dark block, and no hex or
 * white-alpha literal creeps back into the themed component paths.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import tailwindConfig from "../../tailwind.config";
import {
  CHART_SERIES,
  PRESENCE_PALETTE,
  THEME,
  THEME_HEX,
  THEME_VAR_MAP,
  hexToRgbTriplet,
  withAlpha,
} from "@/lib/theme-colors";

const ROOT = join(__dirname, "..", "..");
const GLOBALS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

/** `--c-*` triplets declared inside one selector block. */
function blockVars(selector: string): Map<string, string> {
  const start = GLOBALS.indexOf(`${selector} {`);
  expect(start, `${selector} block missing`).toBeGreaterThanOrEqual(0);
  const end = GLOBALS.indexOf("\n}", start);
  const body = GLOBALS.slice(start, end);
  const out = new Map<string, string>();
  for (const m of body.matchAll(/--c-([a-z0-9-]+):\s*(\d{1,3}) (\d{1,3}) (\d{1,3});/g)) {
    out.set(m[1]!, `${m[2]} ${m[3]} ${m[4]}`);
  }
  return out;
}

const LIGHT = blockVars(":root");
const DARK = blockVars(':root[data-theme="dark"]');

describe("theme tokens — CSS", () => {
  it("light and dark declare the same colour variables", () => {
    expect(LIGHT.size).toBeGreaterThanOrEqual(40);
    expect([...LIGHT.keys()].sort()).toEqual([...DARK.keys()].sort());
  });

  it("the two themes actually differ where they should", () => {
    expect(LIGHT.get("canvas")).not.toBe(DARK.get("canvas"));
    expect(LIGHT.get("layer")).toBe("15 27 45");
    expect(DARK.get("layer")).toBe("255 255 255");
    expect(DARK.get("cobalt-500")).toBe("76 141 255");
  });
});

describe("theme tokens — JavaScript palette", () => {
  it("THEME values are variable references to declared variables", () => {
    for (const [key, value] of Object.entries(THEME)) {
      const m = /^rgb\(var\(--c-([a-z0-9-]+)\)\)$/.exec(value);
      expect(m, `THEME.${key} = ${value}`).not.toBeNull();
      expect(LIGHT.has(m![1]!), `--c-${m![1]} undeclared (THEME.${key})`).toBe(true);
      expect(THEME_VAR_MAP[key as keyof typeof THEME_VAR_MAP]).toBe(m![1]);
    }
  });

  it("THEME_HEX mirrors the dark theme's variables", () => {
    for (const [key, hex] of Object.entries(THEME_HEX)) {
      const varName = THEME_VAR_MAP[key as keyof typeof THEME_VAR_MAP];
      expect(hexToRgbTriplet(hex), `THEME_HEX.${key} vs --c-${varName}`).toBe(DARK.get(varName));
    }
  });

  it("withAlpha handles both value kinds", () => {
    expect(withAlpha(THEME.cobalt, 0.15)).toBe("rgb(var(--c-cobalt-500) / 0.15)");
    expect(withAlpha("#4C8DFF", 0.15)).toBe("rgba(76, 141, 255, 0.15)");
    expect(withAlpha("#4C8DFF", 2)).toBe("rgba(76, 141, 255, 1)");
    expect(() => withAlpha("#fff", 0.5)).toThrow();
  });

  it("chart and presence palettes are distinct", () => {
    expect(new Set(CHART_SERIES).size).toBe(CHART_SERIES.length);
    expect(PRESENCE_PALETTE.length).toBe(12);
    expect(new Set(PRESENCE_PALETTE).size).toBe(12);
    for (const c of PRESENCE_PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe("theme tokens — Tailwind config", () => {
  const colors = (tailwindConfig.theme?.extend?.colors ?? {}) as Record<
    string,
    string | Record<string, string>
  >;

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
    expect(colors.layer).toBe("rgb(var(--c-layer) / <alpha-value>)");
  });

  it("every colour resolves to a declared --c-* variable with an alpha slot", () => {
    const values: string[] = [];
    for (const entry of Object.values(colors)) {
      if (typeof entry === "string") values.push(entry);
      else values.push(...Object.values(entry));
    }
    expect(values.length).toBeGreaterThan(50);
    for (const val of values) {
      const m = /^rgb\(var\(--c-([a-z0-9-]+)\) \/ <alpha-value>\)$/.exec(val);
      expect(m, `unexpected colour value ${val}`).not.toBeNull();
      expect(LIGHT.has(m![1]!), `--c-${m![1]} is not declared in globals.css`).toBe(true);
    }
  });
});

describe("theme tokens — no literals in themed paths", () => {
  const HEX = /#[0-9a-fA-F]{6}\b/g;
  // Palette numbers hand-written as rgba(...) are the other way colour
  // drifts; black / white overlays (shadows, scrims) are fine.
  const PALETTE_RGBA = /rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,/g;
  // `bg-white/5`-style layers are invisible on the light theme; the
  // `layer` token replaces them.
  const WHITE_ALPHA = /\b(bg|border|divide|text)-white\/\[?[0-9.]+\]?/g;

  const FILES = [
    "tailwind.config.ts",
    "src/app/globals.css",
    "src/app/layout.tsx",
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

  it("components, shell, status maps and retouched panels use tokens, not literals", () => {
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
      hits.push(...(src.match(WHITE_ALPHA) ?? []));
      if (hits.length > 0) offenders.push(`${p.replace(ROOT + "/", "")}: ${hits.join(", ")}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no white-alpha layer utilities remain anywhere in the app", () => {
    const paths = walk(join(ROOT, "src"));
    const offenders = paths.filter((p) => WHITE_ALPHA.test(readFileSync(p, "utf8")));
    expect(offenders.map((p) => p.replace(ROOT + "/", ""))).toEqual([]);
  });
});

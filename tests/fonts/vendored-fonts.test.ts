/**
 * BL-QC-fonts — `next build` reads the woff2 files under src/app/fonts
 * instead of fetching Google Fonts. Next's local font loader swallows
 * font-parse errors (it logs and continues), so a corrupt or silently
 * swapped file would still build. Pin the bytes here so it fails CI.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FONTS_DIR = path.resolve(__dirname, "../../src/app/fonts");

const MANIFEST = [
  {
    file: "inter-latin-wght.woff2",
    bytes: 48432,
    sha256: "c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4",
  },
  {
    file: "jetbrains-mono-latin-wght-400-600.woff2",
    bytes: 31340,
    sha256: "2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4",
  },
];

describe("vendored fonts (src/app/fonts)", () => {
  for (const { file, bytes, sha256 } of MANIFEST) {
    it(`${file} matches the README manifest`, () => {
      const buf = readFileSync(path.join(FONTS_DIR, file));
      expect(buf.subarray(0, 4).toString("latin1")).toBe("wOF2");
      expect(buf.byteLength).toBe(bytes);
      expect(createHash("sha256").update(buf).digest("hex")).toBe(sha256);
    });
  }

  it("ships the OFL licence text for each family", () => {
    for (const name of ["OFL-Inter.txt", "OFL-JetBrainsMono.txt"]) {
      const text = readFileSync(path.join(FONTS_DIR, name), "utf-8");
      expect(text).toContain("SIL Open Font License");
    }
  });

  it("layout.tsx imports next/font/local and no longer imports next/font/google", () => {
    const layout = readFileSync(path.resolve(__dirname, "../../src/app/layout.tsx"), "utf-8");
    // Match import statements, not prose: the file's header comment names
    // next/font/google while explaining why it was removed.
    expect(layout).not.toMatch(/from\s+["']next\/font\/google["']/);
    expect(layout).toMatch(/from\s+["']next\/font\/local["']/);
  });
});

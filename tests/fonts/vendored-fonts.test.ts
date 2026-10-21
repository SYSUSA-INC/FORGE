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
    file: "host-grotesk-latin-wght.woff2",
    bytes: 20296,
    sha256: "ce9c9db8a488852eb7e4a52f51fd8ce0c93ef61a8d3bfa054b509ec92958dcfe",
  },
  {
    file: "geist-mono-latin-400.woff2",
    bytes: 9864,
    sha256: "3f98383b122fe015a48536cd4a1cda855a201718923ffe74931a01597107b9b5",
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
    for (const name of ["OFL-HostGrotesk.txt", "OFL-GeistMono.txt"]) {
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

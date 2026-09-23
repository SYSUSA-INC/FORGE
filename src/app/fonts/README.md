# Vendored web fonts

`next build` must not depend on fonts.googleapis.com (BL-QC-fonts). These are the
latin-subset variable WOFF2 files Google Fonts serves for the families FORGE uses;
`next/font/local` in `src/app/layout.tsx` hashes and emits them to
`/_next/static/media/` exactly as the Google loader did, so the rendered fonts are
byte-identical to before.

| File | Family / axes | Source URL | Fetched | Bytes | SHA-256 |
|---|---|---|---|---|---|
| `inter-latin-wght.woff2` | Inter v20 (Google Fonts), latin, wght 100–900 | https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2 | 2026-09-23 | 48432 | `c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4` |
| `jetbrains-mono-latin-wght-400-600.woff2` | JetBrains Mono v24 (Google Fonts), latin, wght 400–600 | https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwgknk-4.woff2 | 2026-09-23 | 31340 | `2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4` |

## Licences

Both families are under the SIL Open Font License 1.1. The licence texts ship next to
the fonts, as the OFL requires: `OFL-Inter.txt` (Copyright (c) 2016 The Inter Project
Authors) and `OFL-JetBrainsMono.txt` (Copyright 2020 The JetBrains Mono Project
Authors). Do not rename the font families.

## Why these files

Before this change `src/app/layout.tsx` made four `next/font/google` calls (three
Inter weight sets and one JetBrains Mono set). Google serves the same variable file
for every Inter weight request, so one Inter file covers display, body and stencil;
`globals.css` aliases `--font-body` and `--font-stencil` to `--font-display`.

## Refreshing

1. Request the CSS the way the Next loader does, with a Chrome user agent:
   `curl -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36' 'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap'`
   (and `family=JetBrains+Mono:wght@400;500;600`).
2. Take the `src: url(...)` under the `/* latin */` block and download it.
3. Update this table and the manifest in `tests/fonts/vendored-fonts.test.ts`.

## Coverage

Latin only (U+0000–00FF plus common punctuation and currency). Characters outside
that range fall back to the system sans or mono, which is what the preloaded latin
subset did before as well.

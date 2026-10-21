# Vendored web fonts

`next build` must not depend on fonts.googleapis.com (BL-QC-fonts). `next/font/local`
in `src/app/layout.tsx` hashes these files and emits them to `/_next/static/media/`.

BL-UI-ENABLENOW (2026-10-21): FORGE uses the EnableNow design system's two families.
The files are the Google Fonts latin subsets that the EnableNow site self-hosts
(its `/assets/fonts/fonts.css` maps Host Grotesk 300, 400 and 500 to the same
variable file, and Geist Mono 400 to its own).

| File | Family / axes | Source URL | Fetched | Bytes | SHA-256 |
|---|---|---|---|---|---|
| `host-grotesk-latin-wght.woff2` | Host Grotesk v1.003, latin, variable wght 300–800 | https://enablenow-website.vercel.app/assets/fonts/enablenow-8.woff2 | 2026-10-21 | 20296 | `ce9c9db8a488852eb7e4a52f51fd8ce0c93ef61a8d3bfa054b509ec92958dcfe` |
| `geist-mono-latin-400.woff2` | Geist Mono v1.701, latin, Regular 400 | https://enablenow-website.vercel.app/assets/fonts/enablenow-6.woff2 | 2026-10-21 | 9864 | `3f98383b122fe015a48536cd4a1cda855a201718923ffe74931a01597107b9b5` |

The family, version and copyright above are read from each file's `name` table.

## Licences

Both families are under the SIL Open Font License 1.1. The licence texts ship next to
the fonts, as the OFL requires: `OFL-HostGrotesk.txt` (Copyright 2023 The Host
Grotesk Project Authors) and `OFL-GeistMono.txt` (Copyright 2024 The Geist Project
Authors). Do not rename the font families.

## How they are used

One Host Grotesk file covers display, body and stencil; `globals.css` aliases
`--font-body` and `--font-stencil` to `--font-display`. Geist Mono ships Regular only,
as EnableNow uses it: heavier mono text is synthesised by the browser.

## Refreshing

1. Download the files above (or the `/* latin */` subsets from
   `https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@300..800` and
   `family=Geist+Mono`, requested with a Chrome user agent).
2. Update this table and the manifest in `tests/fonts/vendored-fonts.test.ts`.

## Coverage

Latin only (U+0000–00FF plus common punctuation and currency). Characters outside
that range fall back to Arial or the system mono.

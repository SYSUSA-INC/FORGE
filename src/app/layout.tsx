import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// BL-QC-fonts — fonts are self-hosted via next/font/local.
//
// next/font/google fetched fonts.googleapis.com during every `next build`.
// Google intermittently returns a font URL without a file extension, and
// Next 14.2.15's loader dereferences a regex match on that URL with no
// null guard (@next/font/dist/google/loader.js:112), which redded the
// Next build gate on PR #264 with no code cause. The woff2 files below are
// the exact latin variable files the Google loader used to download and
// re-serve from /_next/static/media; provenance, checksums and OFL
// licences live in ./fonts/README.md, and tests/fonts pins the bytes.
//
// Keep these calls below the globals.css import so the generated
// `.variable` classes come after the `:root` fallbacks in the cascade.

// One Inter file covers display, body and stencil: globals.css aliases
// --font-body and --font-stencil to --font-display. Variable wght axis.
const inter = localFont({
  src: "./fonts/inter-latin-wght.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-display",
});

// The file Google serves for wght@400;500;600 is instanced to that range;
// declare it so heavier mono keeps today's synthetic-bold rendering.
const mono = localFont({
  src: "./fonts/jetbrains-mono-latin-wght-400-600.woff2",
  weight: "400 600",
  style: "normal",
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "FORGE — Proposal Ops",
  description:
    "Framework for Optimized Response Generation & Execution — capture, compliance, and proposal collaboration for federal and commercial procurement.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

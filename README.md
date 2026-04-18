# FORGE

**Framework for Optimized Response Generation & Execution** — a brutalist-styled
workspace for responding to government and commercial procurement solicitations
(RFP / RFI / RFQ / Sources Sought).

See [`PLAN.md`](./PLAN.md) for the full product & architecture plan.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Structure

- `src/app/` — Next.js 14 App Router pages
  - `/` — **Command** dashboard
  - `/solicitations`, `/solicitations/[id]` — solicitation intake & triage
  - `/proposals`, `/proposals/[id]/...` — proposal editor, compliance, review, export
  - `/knowledge-base` — semantic KB
  - `/settings` — org / AI / integrations config
- `src/components/` — UI primitives + app shell
- `src/lib/mock.ts` — sample data while the backend/Prisma layer is scaffolded

## Aesthetic

Brutalist: stark paper/ink palette, hazard-yellow accents, 2px hard borders,
offset box shadows, uppercase display type (Space Grotesk), monospace metadata
(JetBrains Mono), grid-paper backgrounds, and diagonal hazard stripes on edges
and caution zones.

# `@forge/collab` — Hocuspocus collaboration service

**BL-9 Slice 1.** Self-hosted Yjs-over-WebSocket service that backs
collaborative editing of FORGE proposal sections. NextAuth JWT auth,
Postgres-backed persistence via `yjs_doc`. See
`docs/architecture/collab-editor.md` for the full design.

## Layout

```
services/collab/
  package.json         dependencies + scripts (separate from the Next app)
  tsconfig.json        ES2022 / strict / NodeNext
  Dockerfile           multi-stage; non-root runtime
  src/
    server.ts          HTTP + WebSocket bootstrap, Hocuspocus config
    auth.ts            NextAuth JWT verification + doc_name parsing
```

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `AUTH_SECRET` | yes | Same value as the Next app uses for NextAuth JWT signing. Token shape must match what the Next app issues. |
| `DATABASE_URL` | yes | Postgres connection string. Use a dedicated DB role whose grants cover only `yjs_doc` + `organization` (read-only). |
| `PORT` | no (default `1234`) | HTTP listen port. |

## Local development

```sh
cd services/collab
npm install
AUTH_SECRET=… DATABASE_URL=… npm run dev
```

`npm run dev` uses `tsx watch` so edits hot-reload. `npm run build`
emits `dist/server.js`; `npm start` runs the compiled output.

## Deploy (Slice 1 — Fly.io commercial)

Not deployed in this PR. See Slice 1 of the architecture doc for the
deploy plan; Slice 2 wires the client and Slice 6 adds the AWS
GovCloud path for FedRAMP.

import { createServer } from "node:http";
import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";
import { Pool } from "pg";
import { parseDocName, verifyCollabToken, type CollabClaims } from "./auth.js";

/**
 * BL-9 Slice 1 — Hocuspocus collaboration service entrypoint.
 *
 * Boots an HTTP server that:
 *   - GET  /health             → 200 "ok" for the container healthcheck.
 *   - GET  /collab?token&doc=  → upgrades to WebSocket; Hocuspocus
 *                                handles the protocol from there.
 *
 * Auth:
 *   `onAuthenticate` verifies the NextAuth JWT (HS256, AUTH_SECRET)
 *   and confirms the requested doc_name's row in `yjs_doc` (if it
 *   exists) belongs to the JWT's organizationId. If the row does not
 *   exist yet, the connection is permitted — the first save creates
 *   it under the JWT's org.
 *
 * Persistence:
 *   `@hocuspocus/extension-database` is wired with custom fetch/store
 *   functions that read and upsert `yjs_doc.state`. We do not use
 *   the default RocksDB extension — Postgres is the canonical store.
 *
 * Not yet in Slice 1:
 *   - Redis fan-out for horizontal scaling (Slice 4).
 *   - Production_error_log shipping (handled by Fly's log shipper +
 *     Slice 2 ingest endpoint).
 *   - Track changes / comments / suggestion mode.
 */

const PORT = Number(process.env.PORT || 1234);
const AUTH_SECRET = process.env.AUTH_SECRET || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

if (!AUTH_SECRET) {
  console.error("[collab] AUTH_SECRET is required");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("[collab] DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Conservative pool — Hocuspocus serializes per-doc writes, so we
  // don't need a fat pool. Right-size in Slice 4 with load data.
  max: 10,
  idleTimeoutMillis: 30_000,
});

type ConnectionContext = CollabClaims & { docKey: string };

const hocuspocus = Server.configure({
  // Hocuspocus's default WebSocket path is `/collab` when mounted on
  // an HTTP server (see attachHttp below).
  name: "forge-collab",

  async onAuthenticate(data): Promise<ConnectionContext> {
    const token = (data.token || "").trim();
    const claims = await verifyCollabToken(token, AUTH_SECRET);
    const docKey = data.documentName;

    const parsed = parseDocName(docKey);
    if (!parsed) {
      throw new Error(`invalid doc name: ${docKey}`);
    }

    // If a yjs_doc row already exists, its organization_id must match
    // the JWT's org. Otherwise the user is trying to open someone
    // else's document.
    const { rows } = await pool.query<{ organization_id: string }>(
      `SELECT organization_id FROM yjs_doc WHERE doc_name = $1 LIMIT 1`,
      [docKey],
    );
    const existingOrgId = rows[0]?.organization_id;
    if (existingOrgId && existingOrgId !== claims.organizationId) {
      throw new Error("doc belongs to a different organization");
    }

    return { ...claims, docKey };
  },

  // Hocuspocus calls extensions in the order they are configured.
  extensions: [
    new Database({
      // Load: return null when no row exists; Hocuspocus then creates
      // a fresh Y.Doc and the first store call inserts the row.
      fetch: async ({ documentName, context }) => {
        const ctx = context as ConnectionContext;
        const { rows } = await pool.query<{ state: Buffer }>(
          `SELECT state FROM yjs_doc
            WHERE organization_id = $1 AND doc_name = $2
            LIMIT 1`,
          [ctx.organizationId, documentName],
        );
        const state = rows[0]?.state;
        if (!state) return null;
        return new Uint8Array(state);
      },

      // Store: upsert the new state + bump version + updated_at.
      store: async ({ documentName, state, context }) => {
        const ctx = context as ConnectionContext;
        await pool.query(
          `INSERT INTO yjs_doc (organization_id, doc_name, state, version, created_at, updated_at)
           VALUES ($1, $2, $3, 1, now(), now())
           ON CONFLICT (organization_id, doc_name)
           DO UPDATE SET state = EXCLUDED.state,
                         version = yjs_doc.version + 1,
                         updated_at = now()`,
          [ctx.organizationId, documentName, Buffer.from(state)],
        );
      },
    }),
  ],

  // Structured logging — Fly's log shipper picks these up; Slice 2
  // adds an ingest endpoint that funnels server-side errors into the
  // main production_error_log table.
  async onLoadDocument({ documentName, context }) {
    const ctx = context as ConnectionContext;
    console.log(
      JSON.stringify({
        level: "info",
        evt: "collab.load",
        org: ctx.organizationId,
        user: ctx.userId,
        doc: documentName,
      }),
    );
    return undefined;
  },
  async onStoreDocument({ documentName, context }) {
    const ctx = context as ConnectionContext;
    console.log(
      JSON.stringify({
        level: "info",
        evt: "collab.store",
        org: ctx.organizationId,
        user: ctx.userId,
        doc: documentName,
      }),
    );
  },
  async onDisconnect({ documentName, context }) {
    const ctx = context as ConnectionContext | undefined;
    console.log(
      JSON.stringify({
        level: "info",
        evt: "collab.disconnect",
        org: ctx?.organizationId ?? "",
        user: ctx?.userId ?? "",
        doc: documentName,
      }),
    );
  },
});

const http = createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

// Hocuspocus attaches its WebSocket upgrade handler to the same HTTP
// server. Clients connect to `ws(s)://host:PORT/<doc-name>?token=...`.
http.on("upgrade", (request, socket, head) => {
  hocuspocus.handleConnection(socket as never, request, head);
});

http.listen(PORT, () => {
  console.log(
    JSON.stringify({
      level: "info",
      evt: "collab.ready",
      port: PORT,
    }),
  );
});

function shutdown(signal: string) {
  console.log(
    JSON.stringify({ level: "info", evt: "collab.shutdown", signal }),
  );
  http.close();
  pool.end().catch(() => undefined);
  setTimeout(() => process.exit(0), 1_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

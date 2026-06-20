import { Server } from "@hocuspocus/server";
import type {
  onAuthenticatePayload,
  onDisconnectPayload,
  onLoadDocumentPayload,
  onRequestPayload,
  onStoreDocumentPayload,
  storePayload,
  fetchPayload,
} from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { Pool } from "pg";
import * as Y from "yjs";
import { parseDocName, verifyCollabToken, type CollabClaims } from "./auth.js";

/**
 * BL-9 Slice 1 — Hocuspocus collaboration service entrypoint.
 *
 * Boots an HTTP server that:
 *   - GET  /health → 200 "ok" for the container healthcheck.
 *   - WS  Hocuspocus WebSocket protocol for all other connections.
 *
 * Auth:
 *   `onAuthenticate` verifies the NextAuth JWT (HS256, AUTH_SECRET)
 *   and confirms the requested doc_name's row in `yjs_doc` (if it
 *   exists) belongs to the JWT's organizationId.
 *
 * Persistence:
 *   `@hocuspocus/extension-database` reads/upserts `yjs_doc.state`.
 *
 * BL-9 Slice 2d — after each debounced store, the Yjs XML fragment is
 *   projected back to ProseMirror JSON and written to
 *   `proposal_section.body_doc` so PDF exports and AI drafts always
 *   read current content from the DB, even without the editor open.
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
  // Conservative pool — Hocuspocus serializes per-doc writes.
  max: 10,
  idleTimeoutMillis: 30_000,
});

type ConnectionContext = CollabClaims & { docKey: string };

// ---------------------------------------------------------------------------
// BL-9 Slice 2d — Yjs → ProseMirror JSON projection helpers
// ---------------------------------------------------------------------------
// TipTap's Collaboration extension stores the document in a Y.XmlFragment
// named "default". These helpers project it back to ProseMirror JSON so
// proposal_section.body_doc stays current after each debounced store.
// No prosemirror-model dependency needed — the conversion is a structural
// walk of the Y.Xml tree (mirrors y-prosemirror's yDocToProsemirrorJSON).

type PmNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

type Delta = { insert: string; attributes?: Record<string, unknown> };

function xmlFragmentToJson(fragment: Y.XmlFragment): PmNode[] {
  const nodes: PmNode[] = [];
  fragment.forEach((item) => {
    if (item instanceof Y.XmlElement) {
      const attrs = item.getAttributes() as Record<string, unknown>;
      const content = xmlFragmentToJson(item);
      const node: PmNode = { type: item.nodeName };
      if (Object.keys(attrs).length > 0) node.attrs = attrs;
      if (content.length > 0) node.content = content;
      nodes.push(node);
    } else if (item instanceof Y.XmlText) {
      const delta = item.toDelta() as Delta[];
      for (const d of delta) {
        if (!d.insert) continue;
        const marks: { type: string; attrs?: Record<string, unknown> }[] = [];
        if (d.attributes) {
          for (const [markType, value] of Object.entries(d.attributes)) {
            marks.push(
              value === true
                ? { type: markType }
                : { type: markType, attrs: { [markType]: value } },
            );
          }
        }
        const textNode: PmNode = { type: "text", text: d.insert };
        if (marks.length > 0) textNode.marks = marks;
        nodes.push(textNode);
      }
    }
  });
  return nodes;
}

function ydocToBodyDoc(ydoc: Y.Doc): PmNode {
  const fragment = ydoc.getXmlFragment("default");
  return { type: "doc", content: xmlFragmentToJson(fragment) };
}

// Recursively extract plain text from a ProseMirror node tree.
function extractPlainText(node: PmNode): string {
  if (node.type === "text") return node.text ?? "";
  const parts: string[] = [];
  for (const child of node.content ?? []) {
    const t = extractPlainText(child);
    if (t) parts.push(t);
  }
  return parts.join("\n");
}

// Project Yjs state into proposal_section.body_doc after each debounced
// store. Non-fatal: Yjs binary state is already persisted; next store retries.
async function writebackSection(
  organizationId: string,
  sectionId: string,
  ydoc: Y.Doc,
): Promise<void> {
  const bodyDoc = ydocToBodyDoc(ydoc);
  // Skip if the Y.Doc is still empty (freshly initialised, no content yet).
  if (!bodyDoc.content || bodyDoc.content.length === 0) return;

  const content = extractPlainText(bodyDoc);
  const wordCount = content
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  // Scope update through `proposals` join to prevent cross-tenant writes
  // even if the JWT were somehow misconfigured.
  await pool.query(
    `UPDATE proposal_section ps
        SET body_doc   = $1::jsonb,
            content    = $2,
            word_count = $3,
            updated_at = now()
       FROM proposals p
      WHERE ps.id             = $4
        AND ps.proposal_id    = p.id
        AND p.organization_id = $5`,
    [JSON.stringify(bodyDoc), content, wordCount, sectionId, organizationId],
  );
}

// ---------------------------------------------------------------------------
// Hocuspocus server
// ---------------------------------------------------------------------------

const server = new Server<ConnectionContext>({
  name: "forge-collab",

  // Health-check endpoint — used by the Fly.io container health probe.
  async onRequest({ request, response }: onRequestPayload) {
    if (request.url === "/health" || request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("ok");
    } else {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("not found");
    }
  },

  async onAuthenticate(
    data: onAuthenticatePayload<ConnectionContext>,
  ): Promise<ConnectionContext> {
    const token = (data.token || "").trim();
    const claims = await verifyCollabToken(token, AUTH_SECRET);
    const docKey = data.documentName;

    const parsed = parseDocName(docKey);
    if (!parsed) {
      throw new Error(`invalid doc name: ${docKey}`);
    }

    // If a yjs_doc row already exists, its organization_id must match.
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

  extensions: [
    new Database({
      fetch: async ({ documentName, context }: fetchPayload<ConnectionContext>) => {
        const { rows } = await pool.query<{ state: Buffer }>(
          `SELECT state FROM yjs_doc
            WHERE organization_id = $1 AND doc_name = $2
            LIMIT 1`,
          [context.organizationId, documentName],
        );
        const state = rows[0]?.state;
        if (!state) return null;
        return new Uint8Array(state);
      },

      store: async ({ documentName, state, lastContext }: storePayload<ConnectionContext>) => {
        await pool.query(
          `INSERT INTO yjs_doc (organization_id, doc_name, state, version, created_at, updated_at)
           VALUES ($1, $2, $3, 1, now(), now())
           ON CONFLICT (organization_id, doc_name)
           DO UPDATE SET state = EXCLUDED.state,
                         version = yjs_doc.version + 1,
                         updated_at = now()`,
          [lastContext.organizationId, documentName, Buffer.from(state)],
        );
      },
    }),
  ],

  async onLoadDocument({ documentName, context }: onLoadDocumentPayload<ConnectionContext>) {
    console.log(
      JSON.stringify({
        level: "info",
        evt: "collab.load",
        org: context.organizationId,
        user: context.userId,
        doc: documentName,
      }),
    );
    return undefined;
  },

  // BL-9 Slice 2d: after Hocuspocus debounces and persists the Yjs binary,
  // project the Y.Doc to ProseMirror JSON and write it back to the source
  // proposal_section row so PDF exports / AI drafts read current content.
  async onStoreDocument({
    documentName,
    document,
    lastContext,
  }: onStoreDocumentPayload<ConnectionContext>) {
    console.log(
      JSON.stringify({
        level: "info",
        evt: "collab.store",
        org: lastContext.organizationId,
        user: lastContext.userId,
        doc: documentName,
      }),
    );

    const parsed = parseDocName(documentName);
    if (parsed?.namespace === "section") {
      writebackSection(lastContext.organizationId, parsed.entityId, document).catch(
        (err) => {
          console.error(
            JSON.stringify({
              level: "error",
              evt: "collab.writeback_failed",
              doc: documentName,
              org: lastContext.organizationId,
              error: String(err),
            }),
          );
        },
      );
    }
  },

  async onDisconnect({
    documentName,
    context,
  }: onDisconnectPayload<ConnectionContext>) {
    console.log(
      JSON.stringify({
        level: "info",
        evt: "collab.disconnect",
        org: context.organizationId,
        user: context.userId,
        doc: documentName,
      }),
    );
  },
});

server.listen(PORT).then(() => {
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
  server.destroy().catch(() => undefined);
  pool.end().catch(() => undefined);
  setTimeout(() => process.exit(0), 1_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

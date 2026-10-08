<!--
BL-STAB-2 design of record (2026-10-08). Produced by a design review: three independent
proposals (security-first, simplicity-first, operability-first), scored by two judges, then
synthesized. Phase status lives in docs/BACKLOG.md (BL-STAB-2); where this document and the
backlog differ, the backlog wins. Phase 2a shipped in PR #361 and #362 (follow-ups #363).
-->

# BL-STAB-2: final design and implementation plan

Files go from the browser straight to R2 using a short-lived presigned PUT. A tenant-scoped upload ledger (`file_upload`) records every key the server signs. The server checks each object with HEAD plus a magic-byte sniff, then hands it to a typed domain action that claims it. Parses read the bytes from storage through the existing durable jobs. File limits become policy (per file and per tenant). The plan is six serial PRs, and the owner's main path (new solicitation and amendments) ships in PR 3.

## 0. Base design, grafts, and the flaws removed

**Base.** The operability design, which both judges chose. It contributes:
- a crash-safe claim without transactions (`stored → claiming → claimed`, a pre-allocated `resource_id`, `onConflictDoNothing` inserts, and the open-job reuse in `enqueueJob`)
- a content type chosen by the server, never the browser's
- an ETag pin instead of copying the object
- parse budgets
- `maxDuration` on the pages that host uploaders
- knowledge extraction as a durable job
- contacts parsed in the browser
- a rollout gated on a storage readiness check

**Grafted from the security design:**
- a mandatory magic-byte sniff that refuses OLE2, HTML, SVG and executables
- an OOXML central-directory check done with ranged reads (no copy)
- `assertKeyInOrg` on every storage read and delete
- `import "server-only"` in `storage.ts`
- production and staging refuse uploads when R2 is missing
- per-user and per-org caps, plus a daily ingress cap
- a display-name sanitiser that strips bidi and control characters
- a `tmp/` prefix for transient bytes, with an R2 lifecycle rule as backstop
- the corrected BACKLOG root cause
- its test fixtures

**Grafted from the simplicity design:**
- typed domain actions that take an `uploadId`, so gates and audits stay in their own files (no generic jsonb-params registry)
- `runDurableBatch`
- a static test that keeps any File out of a server action
- the 1 MB action limit kept as a tripwire (no `bodySizeLimit` change)
- a 500 MiB default per file
- `purpose` and `status` as text columns, not pg enums

**Flaws removed:**
- No CopyObject, staging copy, or verifying lease.
- The sweeper never deletes an object a live resource might reference. Claims carry a pre-allocated `resource_id`, and the sweeper checks the resource exists first.
- No quota recheck at complete, so nothing is counted twice.
- Template intents are admin-gated at the intent step.
- Production never falls back to memory silently.
- The memory cache moves to `globalThis`.
- GSA keeps validate-before-create; there is no create-then-upload.
- No global `bodySizeLimit` raise.
- The `/admin/uploads` dashboard and the hourly probe are deferred.
- The sweeper's budget fits inside the 300 s cron.

## 1. Facts checked against the code (they shape the design)

1. **Next 14.2.15 does not cap file parts.** In `node_modules/next/dist/server/app-render/action-handler.js` (around lines 389–398), multipart fetch actions pass `serverActions.bodySizeLimit` (default "1 MB") to busboy only as `limits.fieldSize`.
   - The real file ceiling today is therefore Vercel's ~4.5 MB request body.
   - The `Body exceeded 1 MB limit` check (around line 452) applies only to non-multipart bodies. Example: `previewContactImportAction({ text })`, whose limit is `IMPORT_LIMITS.maxChars` = 2,000,000.
   - Raising `bodySizeLimit` would not help files at all. The BACKLOG root cause gets corrected; the fix stays the same.
2. **Commit 67436c7 (current branch) already has the storage verbs.** It added `presignUrl`, plus `head`, `delete` and `presignPut`; `MemoryStorage.presignPut` returns null. I wrote an independent Python SigV4 query signer. It reproduces both the AWS documentation vector and the repo's `presignUrl` output for an R2 PUT (vectors in §12).
3. **`src/lib/storage.ts` gaps:**
   - no `import "server-only"`
   - `send()` clears its abort timer in `finally` once headers arrive (lines 158–169), so the body read in `get()` (`arrayBuffer`, line 200) has no deadline
   - `head` returns no ETag
   - the memory cache is a `static` Map (line 70)
4. **The memory cache splits between route handlers and server actions.** Next builds route handlers in the `app-route-handler` webpack layer (`webpack-config.js` ~1034) and actions in a different layer, so each gets its own copy of the static Map. A write from `/api/uploads/...` is invisible to an action, even in `next dev`.
5. **`src/lib/jobs.ts`:**
   - `loadBytes(storagePath, inline)` (lines 336–344) already reads from storage when no inline bytes are passed
   - `enqueueJob` reuses an open job for the same resource
   - the handlers do not select `fileSize`
   - `loadBytes` takes no `organizationId`
6. **Re-parse downloads whole files.** Both reparse actions call `storage.get` only to check the file exists, then pass the bytes inline (`solicitations/actions.ts:236–249`, `document-actions.ts:317–336`).
7. **No `(app)` page exports `maxDuration`.**
8. **The storage quota sees only knowledge.** `getStorageBytesUsed` sums `knowledge_artifact.file_size` alone (`subscription-gates.ts:548`). `enforceStorageQuota` fails closed when `getCurrentTier` returns null (`:614–616`).
9. **Deletes never remove stored objects.**
   - `deleteSolicitationDocumentAction` selects `storagePath` and never uses it.
   - `deleteSolicitationAction` only cascades in the database and writes no audit row (a gap to fix in passing).
10. **Template docx files must persist.** They are re-read at render time (`proposals/[id]/pdf/actions.ts:436` and `:621`).
11. **Raw names in keys.** Five upload actions embed the raw `file.name` in the object key.
12. **Legacy Office formats are mis-detected.** `detectFormat` maps `.doc/.xls/.ppt` and `application/msword` to the OOXML extractors (`text-extract.ts:22–31`, `62–64`), which then fail.
13. **Chat `.csv` never worked.** `CHAT_ATTACHMENT_ACCEPT` lists `.csv`, but `detectFormat` returns null for csv.
14. **Contacts import silently truncates files** at 2M characters (`ContactsImportPanel.tsx`, `readFile`).
15. **The jobs cron is already tight.** `/api/cron/jobs` runs `collectAiBatches` with 60 s, then `runJobsCron` with 180 s, under `maxDuration` 300.
16. **Impersonation is blocked twice over.** Middleware blocks `Next-Action` and non-GET requests while impersonating, and `requireCurrentOrg` returns `isImpersonating`.
17. **`file_size` columns are int4** (`schema.ts:979, 2328, 2454, 2612, 2936`).
18. **Smaller findings:**
    - There is no CSP header anywhere.
    - `settings-status.ts` has no storage entry, although ADMIN_MANUAL:870 says Settings shows the provider.
    - `env-check.ts` calls R2 "render storage".
    - Hard-coded hex colours sit in `AmendmentsPanel.tsx:11–14,161` and `SolicitationDocumentsPanel.tsx:194–195`. Both files are touched by this work, so the colours get converted to tokens.

## 2. Architecture

**Keys.** The server builds every key; none contains client input.
- Lasting files: `org/{organizationId}/uploads/{uploadId}`
- Transient files (chat, diagnostic): `tmp/{organizationId}/uploads/{uploadId}`
- `uploadId` is `crypto.randomUUID()` and is also the ledger primary key.
- The display name lives only in the ledger and the domain row.

**Flow.**
1. **Intent.** `requestUploadAction` checks gates, policy, caps and quota. It inserts a `pending` row and returns a presigned PUT, signed with the server's canonical content type and the declared length. The client requests each intent just in time, before that file's PUT.
2. **PUT.** The browser sends an XHR PUT straight to `https://{account}.r2.cloudflarestorage.com/{bucket}/{key}?X-Amz-…`. In proxy mode it goes to `/api/uploads/{id}` instead.
3. **Complete.** `completeUploadAction` verifies the object: HEAD size and type, sniff of the first 8 KiB, and (from PR 5) the OOXML central directory. The row becomes `stored` with its ETag. There is a 24-hour claim window.
4. **Claim.** The typed domain action, for example `createSolicitationFromUploadAction`:
   - moves the row `stored → claiming` with a conditional UPDATE and a pre-allocated `resource_id`
   - inserts the domain row with `id = resource_id` and `onConflictDoNothing`, taking its fields from the ledger only
   - moves the row to `claimed`
   - starts the parse with `runDurable` (no bytes)
   - records the audit event with `uploadId`, then calls `revalidatePath`
5. **Read.** Job handlers check the parse budget against `row.fileSize` before any I/O. Then `getVerifiedObject` asserts the key is in the org, GETs it with a size-aware deadline, and checks the ETag and length against the ledger.
6. **Sweep and release.** Every row whose `purge_after <= now()` and `purged_at IS NULL` has its object deleted. The status keeps the outcome; `purged_at` records the deletion.

**State machine.** Status is a text column with a TypeScript union:

| From | Event | To | `purge_after` |
|---|---|---|---|
| (new) | intent | `pending` | `url_expires_at` + 15 min |
| `pending` | verify passes | `stored` | now + 24 h |
| `pending` | verify fails, cancel, or client-reported failure | `failed` | `url_expires_at` + 5 min (second delete after the URL dies) |
| `pending` | sweeper | `failed` (`expired`) | delete now |
| `stored` | claim | `claiming` (`resource_id` pre-allocated) | unchanged |
| `stored` | sweeper (past 24 h) | `failed` (`unclaimed`) | delete now |
| `claiming` | `finishClaim`, lasting | `claimed` | null |
| `claiming` | `finishClaim`, transient | `claimed` | object deleted at once, then `url_expires_at` + 5 min |
| `claiming` | domain error | `stored` (`resource_id` kept, so a retry reuses it) | unchanged |
| `claiming` | corrupt file | `failed` | delete |
| `claiming` | sweeper | `claimed` if the resource exists, else `failed` (`claim_incomplete`) | null, or delete |
| `claimed` (lasting) | resource deleted or replaced | `released` | now |

Ledger rows whose `purged_at` is older than 90 days are deleted. Claimed lasting rows are kept: they link each object to its resource.

**Transports:**
- `direct` (default): an R2 presigned PUT.
- `proxy`: `PUT /api/uploads/[uploadId]`. Used when the provider is memory (dev, or previews without R2) or when the operator sets `UPLOAD_TRANSPORT=proxy` as an explicit lever. Capped at 4 MiB when `process.env.VERCEL` is set.

## 3. Data model

**`drizzle/0125_file_upload.sql`** opens with a header comment explaining why, is idempotent, and uses `--> statement-breakpoint` between statements.

```sql
CREATE TABLE IF NOT EXISTS "file_upload" (
  "id" uuid PRIMARY KEY NOT NULL,                 -- crypto.randomUUID() in code; last key segment
  "organization_id" uuid NOT NULL,
  "user_id" text,                                 -- only this user may complete/claim/cancel
  "purpose" text NOT NULL,                        -- document|template_docx|chat_attachment|diagnostic
  "status" text DEFAULT 'pending' NOT NULL,       -- pending|stored|claiming|claimed|failed|released
  "transport" text DEFAULT 'direct' NOT NULL,     -- direct|proxy
  "storage_key" text NOT NULL,
  "file_name" text NOT NULL,                      -- sanitised display name; never in a key
  "declared_format" text NOT NULL,                -- pdf|docx|xlsx|pptx|text|image
  "detected_format" text DEFAULT '' NOT NULL,
  "content_type" text NOT NULL,                   -- signed canonical type; image subtype from sniff
  "declared_size" bigint NOT NULL,
  "stored_size" bigint,
  "etag" text DEFAULT '' NOT NULL,
  "origin" text DEFAULT '' NOT NULL,              -- browser Origin at intent (CORS diagnosis)
  "resource_type" text DEFAULT '' NOT NULL,       -- solicitation|solicitation_document|knowledge_artifact|proposal_template|section_chat_attachment
  "resource_id" uuid,                             -- pre-allocated at claim (idempotency)
  "failure_reason" text DEFAULT '' NOT NULL,      -- expired|size_mismatch|type_mismatch|format_refused|zip_rejected|network_or_cors|signature|cancelled|unclaimed|claim_incomplete|claim_failed|storage_error
  "failure_detail" text DEFAULT '' NOT NULL,      -- <= 500 chars, never a URL
  "put_attempts" integer DEFAULT 0 NOT NULL,
  "purge_attempts" integer DEFAULT 0 NOT NULL,
  "url_expires_at" timestamp with time zone NOT NULL,
  "purge_after" timestamp with time zone,
  "stored_at" timestamp with time zone,
  "claimed_at" timestamp with time zone,
  "purged_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- FKs in DO $$ … EXCEPTION WHEN duplicate_object THEN null; END $$ blocks:
--   file_upload_organization_id_organization_id_fk → "public"."organization"("id") ON DELETE cascade
--   file_upload_user_id_user_id_fk → "public"."user"("id") ON DELETE set null
CREATE UNIQUE INDEX IF NOT EXISTS "file_upload_storage_key_idx" ON "file_upload" USING btree ("storage_key");
CREATE INDEX IF NOT EXISTS "file_upload_org_created_idx" ON "file_upload" USING btree ("organization_id","created_at");        -- firewall + daily ingress
CREATE INDEX IF NOT EXISTS "file_upload_org_user_status_idx" ON "file_upload" USING btree ("organization_id","user_id","status"); -- caps, reservations
CREATE INDEX IF NOT EXISTS "file_upload_org_resource_idx" ON "file_upload" USING btree ("organization_id","resource_type","resource_id"); -- release on delete
CREATE INDEX IF NOT EXISTS "file_upload_purge_idx" ON "file_upload" USING btree ("purge_after") WHERE "purge_after" IS NOT NULL AND "purged_at" IS NULL; -- sweeper
```

**Mirror in `src/db/schema.ts`.**
- Table `fileUploads = pgTable("file_upload", …)`.
- Columns `text(...).$type<UploadPurpose>()` and similar; `bigint("declared_size", { mode: "number" })` (the first bigint in the schema).
- Every index declared with the same name; the partial one uses `.where(sql\`…\`)` so `check:drift` matches.
- Types `FileUpload` and `NewFileUpload`.
- Bump `EXPECTED_LATEST_MIGRATION` in `src/lib/migration-check.ts` to `"0125_file_upload.sql"`. Renumber at rebase if BL-STAB-7 lands a migration first.

**`drizzle/0126_knowledge_extract_job.sql` (PR 5).**
- `ALTER TYPE "background_job_kind" ADD VALUE IF NOT EXISTS 'knowledge_artifact_extract';` (same pattern as 0113)
- add the value to `backgroundJobKindEnum`
- add the handler to `HANDLERS`
- add an entry to `KIND_LABEL` in `admin/jobs/page.tsx`
- bump `EXPECTED_LATEST_MIGRATION`

**No changes to existing tables.**
- New domain rows carry `storage_path = file_upload.storage_key`.
- Legacy keys keep working.
- `file_size` stays int4; `HARD_MAX_BYTES` is 1 GiB.

## 4. Files and signatures

### `src/lib/storage.ts` (PR 1)
- Add `import "server-only"` and export the `R2Storage` and `MemoryStorage` classes for tests.
- `StoredObject` and `get` gain `etag: string`.
- Interface additions:
  - `head(key)` returns `Promise<{ byteSize: number; contentType: string; etag: string } | null>`
  - `getRange(key, start, endInclusive)` returns `Promise<Uint8Array | null>`. On R2, a signed `range: bytes=a-b` header, accepting 206 or 200. In memory, a `subarray`.
- `export function storageTimeoutMs(bytes: number): number` returns 30,000 ms plus 2,000 ms per MiB, at most 240,000.
- `R2Storage.send` returns the response together with a deadline handle. `get` re-arms the deadline from the response's `content-length` and keeps it running through `arrayBuffer()`.
- `presignPut` signs `content-length` unless `UPLOAD_SIGN_CONTENT_LENGTH=0`. Its comment is corrected: R2's enforcement of a signed length is unverified, and the HEAD check is the real control.
- `MemoryStorage` keeps its cache on `globalThis.__forgeMemoryStorage` and computes an MD5 ETag on `put`.

### `src/lib/upload-policy.ts` (pure, client-safe; PR 2)
```ts
export const UPLOAD_PURPOSES = ["document","template_docx","chat_attachment","diagnostic"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];
export type UploadFormat = "pdf"|"docx"|"xlsx"|"pptx"|"text"|"image";
export type UploadStatus = "pending"|"stored"|"claiming"|"claimed"|"failed"|"released";
export type UploadTransport = "direct"|"proxy";
export type UploadResourceType = "solicitation"|"solicitation_document"|"knowledge_artifact"|"proposal_template"|"section_chat_attachment";
export type PurposePolicy = { maxBytes: number; formats: readonly UploadFormat[]; transient: boolean; countsTowardQuota: boolean; claimableAs: readonly UploadResourceType[] };
export const HARD_MAX_BYTES = 1024 * MiB; export const PROXY_MAX_BYTES_ON_VERCEL = 4 * MiB;
export const UPLOAD_POLICIES: Record<UploadPurpose, PurposePolicy>; // table in §8
export function resolvePolicy(purpose: UploadPurpose, env?: Record<string,string|undefined>): PurposePolicy; // UPLOAD_MAX_FILE_MB clamps `document` to [1, 1024] MiB
export function formatFromName(fileName: string): { ok: true; format: UploadFormat; ext: string } | { ok: false; code: "legacy_office"|"unsupported" };
export function canonicalContentType(format: UploadFormat, ext: string): string;
export function sanitizeDisplayName(raw: string): string; // NFC; strip C0/C1, U+200E/F, U+202A–202E, U+2066–2069; / and \ → "-"; collapse spaces; strip leading dots; ≤255 UTF-8 bytes keeping extension; fallback "file"
export function validateUploadRequest(input: { purpose: UploadPurpose; fileName: string; size: number; env?: Record<string,string|undefined> }): { ok: true; displayName: string; format: UploadFormat; contentType: string; maxBytes: number } | { ok: false; code: string; error: string };
export function expirySecondsFor(bytes: number): number;   // min(3600, 900 + ceil(bytes / 262144))
export function uploadKeyFor(organizationId: string, uploadId: string, transient: boolean): string;
export function isKeyInOrg(organizationId: string, key: string): boolean; // prefix org/{org}/ or tmp/{org}/; no "" / "." / ".." segment, no leading "/", no "\"
export function assertKeyInOrg(organizationId: string, key: string): void; // throws
export function parseBudgetBytes(format: UploadFormat, env?: Record<string,string|undefined>): number;
export function tooLargeToReadMessage(bytes: number, budget: number): string;
export function utf8ByteLength(s: string): number;
export const TEXT_ACTION_MAX_BYTES = 900_000;
export type UploadView = { uploadId: string; status: UploadStatus; fileName: string; size: number; format: UploadFormat; contentType: string; failureReason: string; message: string };
```

### `src/lib/upload-verify.ts` (pure)
`sniffFormat` and `familyMatches` ship in PR 2; the zip functions in PR 5.
```ts
export type Sniff = { family: UploadFormat|"zip"|"ole2"|"html"|"svg"|"executable"|"unknown"; contentType?: string };
export function sniffFormat(head: Uint8Array): Sniff;
export function familyMatches(declared: UploadFormat, sniff: Sniff): boolean;   // pdf↔pdf, OOXML↔zip, image↔image(any subtype), text↔text
export function locateCentralDirectory(tail: Uint8Array, objectSize: number): { offset: number; size: number; entries: number } | { zip64LocatorOffset: number } | { error: string };
export function readZip64Eocd(rec: Uint8Array): { offset: number; size: number; entries: number } | { error: string };
export function inspectZipDirectory(cd: Uint8Array, expect: "docx"|"xlsx"|"pptx"): { ok: true; entries: number; uncompressed: number } | { ok: false; reason: "encrypted"|"missing_marker"|"too_many_entries"|"too_large"|"ratio"|"truncated" };
```

### `src/lib/uploads.ts` (server-only; PR 2 unless noted)
Every function takes `organizationId`. Every select, update and delete on `fileUploads` carries `eq(fileUploads.organizationId, …)`.
```ts
export type UploadActor = { userId: string; email: string | null };
export async function createUploadIntent(i: { organizationId: string; actor: UploadActor; isImpersonating: boolean; purpose: UploadPurpose; fileName: string; size: number; origin: string }): Promise<{ ok: true; uploadId: string; transport: UploadTransport; put: { url: string; method: "PUT"; headers: Record<string,string> }; expiresAt: string; maxBytes: number } | { ok: false; code: string; error: string }>;
export async function completeUpload(i: { organizationId: string; actor: UploadActor; uploadId: string }): Promise<{ ok: true; upload: UploadView } | { ok: false; code: "not_found"|"not_uploaded_yet"|"rejected"|"storage_unavailable"; error: string; retryable: boolean }>;
export type ClaimedUpload = { uploadId: string; resourceId: string; storageKey: string; fileName: string; size: number; contentType: string; format: UploadFormat; transient: boolean };
export async function claimUpload(i: { organizationId: string; userId: string; uploadId: string; resourceType: UploadResourceType; resourceId?: string }): Promise<{ ok: true; claim: ClaimedUpload; rerun: boolean } | { ok: true; alreadyClaimed: true; resourceId: string } | { ok: false; error: string }>;
export async function finishClaim(i: { organizationId: string; uploadId: string }): Promise<void>;
export async function releaseClaim(i: { organizationId: string; uploadId: string }): Promise<void>;   // claiming → stored
export async function failClaim(i: { organizationId: string; uploadId: string; reason: string; detail: string }): Promise<void>;
export async function peekStoredUploads(i: { organizationId: string; userId: string; uploadIds: string[]; resourceType: UploadResourceType }): Promise<{ ready: ClaimedUploadPreview[]; bad: { uploadId: string; reason: string }[] }>;
export async function cancelUpload(i: { organizationId: string; actor: UploadActor; uploadId: string }): Promise<{ ok: true }>;
export async function recordUploadFailure(i: { organizationId: string; actor: UploadActor; uploadId: string; httpStatus: number; attempts: number }): Promise<{ message: string }>;
export async function getReservedUploadBytes(organizationId: string): Promise<number>;   // declared_size, status pending(unexpired)/stored/claiming, quota-counting purposes
export async function getVerifiedObject(i: { organizationId: string; storagePath: string }): Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; reason: "gone"|"changed"|"foreign_key" }>; // PR 3
export async function inlineBytesForMemoryMode(i: { organizationId: string; storagePath: string }): Promise<Uint8Array | undefined>; // PR 3
export async function sweepUploads(o?: { now?: Date; budgetMs?: number; limit?: number }): Promise<{ expired: number; unclaimed: number; promoted: number; purged: number; purgeErrors: number; pruned: number }>; // PR 4
export async function releaseStoredFile(i: { organizationId: string; storagePath: string; reason: "deleted"|"replaced" }): Promise<void>; // PR 6
```

**`claimUpload` details.**
- The claim is one conditional UPDATE:
  - `SET status='claiming', resource_type, resource_id = coalesce(resource_id, $id), claimed_at = now`
  - `WHERE id AND organization_id AND user_id AND purpose IN (purposes claimable as resourceType) AND status='stored' AND purge_after > now()`
- When nothing is updated, it re-reads the row:
  - `claimed` with the same `resource_type`: return `alreadyClaimed`, so the action is idempotent.
  - `claiming` older than 2 minutes with the same type: take it over with a conditional UPDATE on `claimed_at` and return `rerun: true`.
  - anything else: a plain error.

### `src/app/(app)/uploads/actions.ts` (`"use server"`, async exports only; PR 2)
Each action opens with `requireAuth()` and `requireCurrentOrg()`. None takes `organizationId`.
```ts
export async function requestUploadAction(input: { purpose: UploadPurpose; fileName: string; size: number; browserType?: string }): Promise<UploadIntentResult>;
export async function completeUploadAction(uploadId: string): Promise<UploadCompleteResult>;
export async function cancelUploadAction(uploadId: string): Promise<{ ok: true }>;
export async function reportUploadFailureAction(input: { uploadId: string; httpStatus: number; attempts: number }): Promise<{ ok: true; message: string }>; // status 0 → server-side CORS preflight probe for row.origin (cached 5 min)
```

### `src/app/api/uploads/[uploadId]/route.ts` (proxy transport; PR 3)
- `export const runtime = "nodejs"; dynamic = "force-dynamic"; maxDuration = 60;`
- `export async function PUT(req, { params })`
- Status codes:
  - 404 when the transport is not active
  - 401 when signed out (via `requireApiTenant`)
  - 403 for a bad Origin
  - 409 when the row is not pending or not proxy
  - 411 or 413 for a missing or wrong Content-Length
- On success it returns the `completeUpload` result as JSON.

### `src/lib/storage-diagnostics.ts` (server-only; PR 1)
```ts
export async function probeStorage(i: { origins: string[] }): Promise<StorageProbe>;
// credentials: put/head/getRange/delete of tmp/diagnostic/{uuid};
// R2: presigned 16-byte PUT (expect 2xx), 17 bytes to same URL (records signedLength enforced?), wrong content-type (expect 403);
// CORS: OPTIONS /{bucket}/tmp/diagnostic/probe with Origin, Access-Control-Request-Method: PUT, Access-Control-Request-Headers: content-type
export async function probeCorsForOrigin(origin: string): Promise<CorsProbe>; // cached 5 min
```
Origins come from `UPLOAD_ALLOWED_ORIGINS`, falling back to `appBaseUrl()`.

### `src/app/(app)/admin/jobs/actions.ts` (add; PR 1)
All three are gated by `requireSuperadmin()` and audited on the superadmin's organization, following the `runJobsNowAction` pattern.
- `probeStorageAction()` (audit `admin.storage.probe`)
- `startStorageSelfTestAction()` presigns `tmp/diagnostic/{uuid}`, 1,024 bytes, `text/plain`, 300 s (audit `admin.storage.self_test`)
- `finishStorageSelfTestAction(key)`: the key must match `^tmp/diagnostic/<uuid>$`; HEAD checks the size, then the object is deleted (same audit)

**UI:**
- `admin/jobs/StorageCard.tsx` (server-rendered section on `/admin/jobs`)
- `admin/jobs/StorageSelfTest.tsx` (`"use client"`)
- In PR 3 the self-test switches to the real pipeline: `uploadFile` with purpose `diagnostic`, then `cancelUploadAction`.

### `src/lib/jobs.ts`
**PR 3:** a private helper replaces `loadBytes`.
```ts
async function loadUploadBytes(job: BackgroundJob, row: { storagePath: string; fileSize: number; fileName: string; contentType: string }, inline?: Uint8Array): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; message: string }>;
```
Its order:
1. `isKeyInOrg(job.organizationId, row.storagePath)`
2. `parseBudgetBytes(detectFormat(...))` against `row.fileSize`, before any I/O
3. inline bytes if present
4. otherwise `getVerifiedObject`
5. if the bytes sniff as OLE2, fail with "older Office format"

Each handler maps `{ ok: false }` to `parseStatus='failed'` with the message and throws `JobPermanentError`.

**PR 4:**
```ts
export async function runDurableBatch(label: string, specs: JobSpec[]): Promise<{ jobIds: string[] }>; // enqueue all, one runInBackground that executes them sequentially
```

**PR 5:** the `knowledge_artifact_extract` handler.

### Other changes
- **`src/app/api/cron/jobs/route.ts` (PR 4).** After `collectAiBatches`, call `sweepUploads({ budgetMs: 15_000, limit: 200 })` (errors logged, not fatal). `runJobsCron` budget goes 180,000 → 165,000 ms. The JSON result gains `uploads`.
- **`src/lib/subscription-gates.ts` (PR 5).**
  - `getStorageBytesUsed` becomes the sum of:
    - `knowledge_artifact.file_size`
    - `solicitation.file_size` where `storage_path <> ''`
    - `solicitation_document.file_size` where `storage_path <> ''`
    - `proposal_template.docx_file_size`
    - `getReservedUploadBytes`
  - The queries run with `Promise.all`, each scoped to the org.
  - When the tier is null, the message becomes explicit ("This workspace has no plan assigned…"). The function still fails closed.
- **`src/lib/settings-status.ts` (PR 1).** Add a "File storage" integration line: provider, transport, and "browser uploads need CORS" when R2 is configured.
- **`src/lib/env-check.ts` (PR 1).** Fix the R2 purpose text. Log at error level when `resolveEnvLabel()` is production or staging and the provider is memory.

## 5. Security checks, in order

**Intent (`requestUploadAction` → `createUploadIntent`).**
1. `requireAuth()`, then `requireCurrentOrg()`. `organizationId` and `user.id` come from these only.
2. Refuse when `ctx.isImpersonating` (log a warning). Middleware already blocks this; this is defence in depth, because the R2 PUT itself never passes through middleware.
3. Input shape:
   - `purpose` must be in `UPLOAD_PURPOSES`
   - `fileName` is a string of at most 1,024 characters
   - `size` is a safe integer greater than 0
4. Purpose gate:
   - `template_docx` needs `requireOrgAdmin(organizationId)` and `templateAuthoringRefusal(organizationId)`
   - `diagnostic` needs `requireSuperadmin()`
5. Environment gate:
   - memory provider in production or staging (`resolveEnvLabel`): refuse with "File storage is not configured…"
   - proxy transport on Vercel: size must be at most 4 MiB
6. `validateUploadRequest`:
   - sanitised display name
   - format from the extension in the purpose allowlist (`.doc/.xls/.ppt` refused with "save as .docx/.xlsx/.pptx")
   - size at most the policy maximum, which is at most `HARD_MAX_BYTES`
7. `enforceRateLimit({ key: "upload-intent:user:"+id, limit: 300, windowSeconds: 3600 })`.
8. Caps:
   - unexpired `pending` rows per user ≤ 10
   - `stored` rows per user ≤ 200 (BL-STAB-3 staging)
   - org daily ingress: sum of `declared_size` over 24 h ≤ `UPLOAD_DAILY_GB_PER_ORG`
9. From PR 5, for `countsTowardQuota` purposes: `enforceStorageQuota(organizationId, size)` on the broadened meter, which includes reservations.
10. Build the key with `uploadKeyFor`, then `assertKeyInOrg`.
11. INSERT a `pending` row with `url_expires_at`, `purge_after` and `origin` (from `headers().get("origin")`).
12. Presign with the server's canonical type and the declared length (proxy: the app URL).
13. `recordAudit("file_upload.intent")`. Logs carry the upload id, purpose, size and transport, never the URL or file name.

**PUT.** The SigV4 signature covers the method, host, exact path, `content-type`, `content-length`, date and expiry. The URL can write one key, for at most 1 hour.

**Complete (`completeUpload`).**
1. Gates as above. Validate the uuid format.
2. Load the row by `id`, `organization_id` and `user_id = user.id`. Not found returns "Upload not found" with no storage call.
3. Already `stored`: return the view (idempotent). Any other status besides `pending`: error.
4. `assertKeyInOrg(row.organizationId, row.storageKey)`.
5. HEAD the object.
   - Absent while the URL is still live: `not_uploaded_yet` (retryable).
   - Absent after the URL expired: `failed` with reason `expired`.
6. `byteSize` must equal `declared_size` and stay within the policy. Otherwise:
   - delete the object
   - set `failed` with reason `size_mismatch` and `purge_after = url_expires_at + 5 min`
   - `recordAudit("file_upload.reject")`
7. The HEAD content type must equal the signed type; otherwise reject the same way.
8. `getRange(0, 8191)`, then `sniffFormat`, then `familyMatches`. OLE2, HTML, SVG, executables and unknown content are rejected as `type_mismatch`.
9. OOXML only (PR 5): range-read the last 65,577 bytes, follow the ZIP64 locator if present, then range-read the central directory (refuse above 8 MiB) and run `inspectZipDirectory`. The limits:
   - at most 20,000 entries
   - declared total at most 1 GiB, any entry at most 512 MiB
   - compression ratio at most 1,000 for entries over 10 MiB
   - no encrypted flag
   - `[Content_Types].xml` plus the family marker (`word/document.xml`, `xl/workbook.xml` or `ppt/presentation.xml`) present
   - failure: `zip_rejected`
10. Conditional UPDATE `pending → stored` with `stored_size`, `etag`, `detected_format`, the image content type from the sniff, `stored_at`, and `purge_after = now + 24 h`. If another request won the race, re-read and return.
11. `recordAudit("file_upload.verified")`.

**Claim (typed domain actions).**
1. Gates, then the domain checks (parent, section or template in this org; admin and feature gate for templates), all before the claim.
2. `claimUpload`: a conditional UPDATE bound to org, user, purpose (claimable as this resource type) and `stored`, inside the claim window.
3. Insert the domain row with `id = resourceId` and `onConflictDoNothing`. `storagePath`, `fileName`, `fileSize` and `contentType` come from the ledger, never from the client.
4. `finishClaim`. On a domain error, `releaseClaim`; on corrupt content, `failClaim`.
5. Run the parse, or read with `getVerifiedObject`, then `recordAudit` (with `uploadId`), then `revalidatePath`.

**Read (jobs, template scan, template render, chat).**
1. `isKeyInOrg`.
2. The parse budget against `fileSize`, before any I/O.
3. GET with a size-aware deadline.
4. The ETag and length must match the ledger row, when one exists. A mismatch fails permanently with "the stored file changed after upload; upload it again". This closes the window in which the uploader re-PUTs before the URL expires.
5. The OLE2 short-circuit for legacy rows.

**Proxy route.**
1. The transport must be active, otherwise 404.
2. `requireApiTenant()`.
3. `Origin` must equal the request origin or `appBaseUrl()`.
4. The row must match id, org and user, with `pending`, `transport='proxy'` and an unexpired URL.
5. `content-type` must equal `row.content_type`.
6. `Content-Length` must be present and equal `declared_size`. The route reads the body and checks `byteLength`.
7. `storage.put`.
8. `completeUpload`.

Middleware blocks the route during impersonation (non-GET).

**Sweeper.**
- Called only from the `CRON_SECRET`-gated route.
- Selects across tenants by design, like `runJobsCron`.
- Every write carries `row.organizationId`.
- `isKeyInOrg(row.organizationId, row.storageKey)`. On a mismatch it logs at error level and never deletes.

**What stays the same.** The bucket stays private: no `r2.dev`, no public domain, no presigned GET to browsers. The R2 token is "Object Read & Write" on one bucket. CORS is not treated as an access control.

## 6. Per-path conversion

**A. New solicitation and amendments (PR 3).**
- `createSolicitationFromUploadAction(input: { uploadId: string; parentSolicitationId?: string | null; amendmentNumber?: string }): Promise<UploadResult>` in `solicitations/actions.ts`, in this order:
  1. gates
  2. the parent check scoped by org, as today (`actions.ts:73–91`), before the claim, so a bad parent does not consume the upload
  3. `claimUpload(resourceType "solicitation")`
  4. insert the row (`title = stripExt(fileName)`, `parseStatus "uploaded"`, `source "uploaded"`, parent, `opportunityId` from the parent, `amendmentNumber` up to 64 chars)
  5. `finishClaim`
  6. `runDurable("solicitation_parse")` with no bytes. In memory mode it passes `{ bytes: await inlineBytesForMemoryMode(...) }`. If the row already existed (a rerun), it skips when a job exists.
  7. audit `solicitation.upload` or `solicitation.amendment.upload` with `uploadId`
  8. `revalidatePath("/solicitations")`
- Delete `uploadSolicitationAction` and `guessContentTypeFromFormat`.
- `reparseSolicitationAction` switches to `head` for the existence check (PR 4).
- Clients:
  - `UploadSolicitationForm.tsx`: `useUploadQueue({ purpose: "document", concurrency: 1, claim })`, then `router.push`. The eyebrow states the policy limit.
  - `AmendmentsPanel.tsx`: same, plus the parent and amendment number. Its hex colours become tokens.
- `export const maxDuration = 300` in `solicitations/new/page.tsx` and `solicitations/[id]/page.tsx`.

**B. Companion documents (PR 4).**
- `addSolicitationDocumentFromUploadAction(solicitationId: string, input: { uploadId: string; documentType: SolicitationDocumentType; sortOrder?: number }): Promise<AddDocumentResult>`:
  1. parent check
  2. `documentType` allowlist, as today
  3. claim `solicitation_document`
  4. insert
  5. `finishClaim`
  6. `runDurable("solicitation_document_parse")` with no bytes
  7. audit `solicitation.document.upload` with `uploadId`
  8. `revalidatePath`
- Delete `addSolicitationDocumentAction`.
- `reparseSolicitationDocumentAction` uses `head`.
- `SolicitationDocumentsPanel.tsx` moves onto the queue and its hex colours become tokens.

**C. Chat attachments (PR 6).**
- Purpose `chat_attachment`: transient (`tmp/`), 50 MiB, excluded from the quota.
- `attachChatDocumentAction(input: { sectionId: string; uploadId: string })`:
  1. `claimUpload(resourceType "section_chat_attachment")`
  2. parse budget for the format
  3. `getVerifiedObject`
  4. `attachChatDocument({ id: claim.resourceId, organizationId, sectionId, fileName, contentType, bytes, actor })`. The lib gains an optional `id` and `onConflictDoNothing`; its section and per-section checks are unchanged.
  5. On `!ok`: `failClaim` (purged) and return the message.
  6. Otherwise `finishClaim`: the object is deleted at once, with a second delete after the URL expires.
- `CHAT_ATTACHMENT_LIMITS.maxBytes` comes from the policy. `.csv` maps to the text family with canonical type `text/plain`, which fixes the dead `.csv` accept.
- `AiAssistantPanel.tsx` calls `uploadFile` and then this action.
- The docs change "bytes not stored" to "held in private storage only until the text is read, then deleted".

**D. Knowledge corpus (PR 5).**
- `extractAndIndex` moves verbatim to `src/lib/knowledge-artifact-extract.ts` (server-only).
- A new job kind `knowledge_artifact_extract`. Its handler:
  1. loads the artifact by id and org
  2. runs `loadUploadBytes`
  3. calls `extractAndIndex(…, payload.wasAutoKind)`
  4. fails permanently with a `statusError` when over budget
- `createKnowledgeArtifactFromUploadAction(input: { uploadId: string; kind?: string; tags?: string; title?: string; outcome?: string })`:
  1. claim
  2. insert with status `uploaded`, `storagePath`, `fileSize`, `contentType`
  3. `finishClaim`
  4. `runDurable("knowledge_artifact_extract", { payload: { wasAutoKind } })`
  5. audit `knowledge_artifact.upload` with `uploadId`
  6. revalidate
- `reextractArtifactTextAction` enqueues the job.
- `enforceStorageQuota` moves to the intent, for all quota-counting purposes.
- `CorpusUploader.tsx` uses the queue with concurrency 3, claiming per file.
- `uploadKnowledgeArtifactAction` is deleted.
- `export const maxDuration = 300` in `knowledge-base/import/page.tsx`.

**E. Word template (PR 6).**
- Purpose `template_docx`: docx only, 50 MiB, admin and feature gate at intent.
- `attachTemplateDocxFromUploadAction(templateId: string, uploadId: string): Promise<DocxUploadResult>`:
  1. `requireOrgAdmin` and `templateAuthoringRefusal` again
  2. template in this org
  3. `claimUpload(resourceType "proposal_template", resourceId: templateId)`
  4. `getVerifiedObject`
  5. `scanDocxForVariables`. If it throws: `failClaim`, return today's corrupt-file error.
  6. read the previous `docxStoragePath`
  7. update the template row
  8. `finishClaim`
  9. `releaseStoredFile(previous, "replaced")`
  10. audit `template.upload_docx` with `uploadId`
  11. revalidate both paths
- `clearTemplateDocxAction` calls `releaseStoredFile`.
- The render reads (`pdf/actions.ts:436`, `:621`) use `getVerifiedObject`.
- `EditTemplateClient.tsx` moves to `uploadFile`.
- `maxDuration = 300` on `settings/templates/[id]/page.tsx`.

**F. GSA email import (PR 4).**
- `createOpportunityFromGsaAction(input: { text: string; title: string; noticeType: string; solicitationNumber: string; buyingAgency: string; office: string; vehicle: string; naicsCode: string; setAside: string; responseDueDate: string; placeOfPerformance: string; scopeSummary: string; notes: string; uploadIds: string[] })`. A typed object replaces FormData, with `uploadIds` ≤ `MAX_ATTACHMENTS = 20`.
- Steps:
  1. gates
  2. `peekStoredUploads` validates every id before anything is created; bad ids go to `attachmentsSkipped`
  3. create the opportunity and activity, as today
  4. for each ready upload: claim `solicitation`, insert a row (`source "gsa-paste"`, opportunity linked), `finishClaim`. Per-file failures are skipped with a reason.
  5. `runDurableBatch` runs the parses one after another
  6. audit `opportunity.create_from_gsa` with `uploadIds`
  7. revalidate `/opportunities`, `/opportunities/{id}`, `/solicitations` and `/`
- `GsaPasteClient.tsx`: a queue with no claim callback uploads every attachment, then the action is called with `readyUploadIds`. The total-size warning is removed.
- `maxDuration = 300` on `opportunities/import/gsa/page.tsx`.

**G. Dictation (`/api/ai/transcribe`).** Unchanged.
- It is a route handler, not a server action.
- The 4 MB `DICTATION_LIMITS.maxBytes` stays deliberately under Vercel's cap, and the audio is never stored.
- PR 6 adds a pure test pinning it below 4.5 MB, and the docs record it as a deliberate, transport-bound exception.

**H. Contacts and text-only actions (PR 6).**
- **Contacts:**
  - A chosen file is read in the browser up to `IMPORT_LIMITS.maxFileBytes = 50 MiB`, with no silent cut and no textarea for files.
  - `parseImport` and `dedupeWithinImport` run in the browser.
  - `previewContactImportAction(input: { rows: Partial<ImportRow>[]; skipped: ImportSkip[]; format: ImportFormat; unmappedHeaders: string[] })` re-runs `sanitizeImportRow` and `dedupeWithinImport`, then `detectDuplicates` and `summarizeImport`. At most 500 rows per call.
  - Both preview and `commitContactImportAction` are sent in chunks by `chunkByBytes(rows, 600_000)`. Worst-case rows reach about 2.4 MB, because notes can be 4,000 characters each.
  - Pasted text follows the same path. The total stays at 500 rows per import.
- **Text pastes:** Q&A paste, GSA paste and eBuy paste (200k characters each), and gold-set text (2M characters).
  - Client guard: `utf8ByteLength(JSON.stringify(text)) > TEXT_ACTION_MAX_BYTES` gives a readable message.
  - For gold-set, the message is "add the rest with Add text", since `appendGoldDocTextAction` already exists.
  - Server limits are unchanged. `next.config.mjs` is unchanged; the 1 MB limit stays as a tripwire.

**Deletes (PR 6).**
- `releaseStoredFile` sets `released` and `purge_after = now` on the ledger row. For legacy keys it does a best-effort `delete`, after `isKeyInOrg`.
- Wired into:
  - `deleteSolicitationAction`: it first selects its own key, its amendments' keys and its documents' keys; it also gains the missing `solicitation.delete` audit
  - `deleteSolicitationDocumentAction`
  - `deleteKnowledgeArtifactAction`
  - the template clear and replace paths

## 7. Client helper API

**`src/lib/upload-client-logic.ts` (pure).** PR 1 ships the first three; the rest come later.
```ts
export function classifyPutFailure(i: { status: number; bodyText: string; expiresAt: string; now: number }): "retry"|"renew"|"network_or_cors"|"fatal_signature"|"fatal_too_large";
// 0 → network_or_cors (retry with backoff, then report); 403 with "Request has expired" or now ≥ expiresAt-30s → renew (one fresh intent); 403 other → fatal_signature; 413 → fatal_too_large; 5xx → retry
export function nextBackoffMs(attempt: number): number | null;   // 1000, 4000, 10000, then null
export function progressSnapshot(prev: Snap | null, loaded: number, total: number, now: number): { loaded: number; total: number; bytesPerSec: number | null; etaSec: number | null };
export function describeUploadFailure(code: string): string;   // status 0: "The file did not reach storage. Your network or the storage setup (CORS) may be blocking it; an administrator can check Admin → Jobs → File storage."
export function chunkByBytes<T>(items: T[], maxBytes: number): T[][]; // PR 6
```

**`src/lib/upload-client.ts`.** A plain module used only by client components. It imports the upload actions, `upload-policy` and the logic module.
```ts
export function putWithProgress(i: { url: string; headers: Record<string,string>; body: Blob; onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal }): Promise<{ status: number; bodyText: string }>; // XHR; setRequestHeader for returned headers only; never sets Content-Length; withCredentials=false
export async function uploadFile(file: Blob, opts: { purpose: UploadPurpose; fileName?: string; onProgress?: (p: { loaded: number; total: number }) => void; onPhase?: (p: UploadPhase) => void; signal?: AbortSignal }): Promise<{ ok: true; uploadId: string; upload: UploadView } | { ok: false; code: string; error: string; uploadId?: string }>;
```
- Step 1: pre-check with `validateUploadRequest` (no network call).
- Step 2: `requestUploadAction`, then the PUT:
  - retries go through `classifyPutFailure` and `nextBackoffMs`
  - an expired URL leads to `cancelUploadAction` on the old row, then one fresh intent
- Step 3: `completeUploadAction`. On `not_uploaded_yet` it retries once after 1 s.
- Proxy transport: the PUT's JSON response is the complete result, so step 3 is skipped.
- Abort or a fatal outcome: `xhr.abort()`, then `cancelUploadAction` or `reportUploadFailureAction`.
- The presigned URL is never logged or reported.

**`src/components/uploads/useUploadQueue.ts` (`"use client"`).**
```ts
export type UploadPhase = "queued"|"preparing"|"uploading"|"verifying"|"saving"|"done"|"failed"|"cancelled";
export type UploadItem<R> = { id: string; file: File; phase: UploadPhase; loaded: number; total: number; bytesPerSec: number|null; etaSec: number|null; uploadId?: string; result?: R; error?: string };
export function useUploadQueue<R = never>(opts: { purpose: UploadPurpose; concurrency?: number /*3*/; autoStart?: boolean; claim?: (i: { uploadId: string; file: File }) => Promise<{ ok: true; result: R } | { ok: false; error: string }>; onItemDone?: (item: UploadItem<R>) => void; onAllDone?: (items: UploadItem<R>[]) => void }): { items: UploadItem<R>[]; add(files: File[] | FileList): void; start(): void; retry(id: string): void; cancel(id: string): void; remove(id: string): void; clear(): void; busy: boolean; readyUploadIds: string[] };
```
- Intents are requested per worker slot, just in time.
- Progress state is updated outside `startTransition`, throttled to about 10 per second through a ref.
- A `beforeunload` guard is active while busy.
- Without a `claim` callback, items stop at "verified" and `readyUploadIds` feeds a batch action (the GSA pattern, and later BL-STAB-3).

**`src/components/uploads/UploadQueue.tsx` (`"use client"`).**
- Props: `{ items; onRetry(id); onCancel(id); onRemove(id) }`.
- One row per file: name, size, phase label, a `role="progressbar"` bar with `aria-valuenow`, MB/s and ETA, error text, and Retry / Cancel / Remove buttons.
- Tokens only: `bg-teal` fill on a `bg-layer/10` track, `text-rose` and `border-rose/40` for errors, `border-layer/15`, `text-muted`, `aur-btn`.

**Fit with the upcoming tickets.**
- BL-STAB-4 and BL-STAB-6: add `multiple` and keep the same per-file `claim`.
- BL-STAB-3:
  1. a queue without a claim callback
  2. a `classifyUploadsAction(uploadIds)` reading stored objects with `peekStoredUploads` and `getVerifiedObject` / `getRange`, inside the 24-hour window
  3. the user confirms
  4. each file is claimed through its typed action
- BL-STAB-5 adds a resource type that `document` can be claimed as. No migration is needed for a new purpose or resource type.

## 8. Limits as policy

**Per file (`UPLOAD_POLICIES`):**

| Purpose | Max per file | Formats | Bytes after the claim | Counts toward quota |
|---|---|---|---|---|
| `document` | 500 MiB (`UPLOAD_MAX_FILE_MB`, max 1024) | pdf, docx, xlsx, pptx, text (.txt .md .csv), images | kept | yes (from PR 5) |
| `template_docx` | 50 MiB | docx | kept | yes |
| `chat_attachment` | 50 MiB | pdf, docx, xlsx, pptx, text | read, then deleted | no |
| `diagnostic` | 1 MiB | text | deleted | no |

**Per tenant:**
- the tier's `storageGb` on the broadened meter, including reservations (0 = unlimited, as today)
- `UPLOAD_DAILY_GB_PER_ORG` (default 50 GiB of declared ingress per 24 h)
- per-user caps and the rate limit from §5

The hard ceiling of 1 GiB keeps uploads under the int4 `file_size` columns and under R2's single-PUT limit.

**Parse budget.** Bytes are loaded into function memory only within these budgets. Scale them with `UPLOAD_PARSE_SCALE` (default 1, clamped 0.25–4):

| Format | Budget |
|---|---|
| PDF | 150 MiB |
| PPTX | 150 MiB |
| DOCX | 100 MiB |
| XLSX | 40 MiB |
| text | 25 MiB |
| image | 5 MiB (the existing vision cap) |

Scanned-PDF vision keeps its own 24 MiB cap (`solicitation-extract.ts:475`). A file over budget is stored and listed, and the row reads: "Stored (412 MB). FORGE reads files of this type up to 150 MB automatically; split it (for example by volume) and upload the parts to have it read." That is a `JobPermanentError`: no download, no AI spend, no retries. AI cost per document is already bounded (at most 12 windows of 60k characters; `rawText` capped at 500k).

**Time:**
- URL expiry `min(3600, 900 + ceil(bytes / 256 KiB))` seconds.
- R2 timeouts of 30 s plus 2 s per MiB (max 240 s), now covering the body read.
- `maxDuration = 300` on every page that hosts an uploader, which bounds both the claim action and its `waitUntil` parse. Verify in Preview that server actions inherit it.
- `runDurableBatch` keeps multi-file parses sequential within one request.
- Verification uses constant memory: 8 KiB, plus about 64 KiB of tail, plus at most 8 MiB of central directory.

## 9. Dev and memory fallback

- `MemoryStorage` keeps its cache on `globalThis`, so route handlers and actions share it in one process.
- When the provider is memory, intents return `transport: "proxy"`. The proxy route stores the bytes and verifies them in the same request.
- Claims in memory mode pass inline bytes (`inlineBytesForMemoryMode`), so the first parse works.
- On a Vercel preview without R2, the claim can land on another instance. It then fails clearly: "This environment keeps uploads in memory and the file landed on another server instance. Configure R2 for this environment." The proxy cap there is 4 MiB.
- Production and staging with memory storage refuse intents and log at error level at boot.
- Recommendation: a preview R2 bucket for the Preview environment.
- `next dev` works at full size.

## 10. Operator steps

1. **Buckets and tokens.** One private bucket per environment (production, staging, preview), with `r2.dev` off. A token per bucket with "Object Read & Write" on that bucket only. Set `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` per Vercel environment, including Preview.
2. **CORS** (Cloudflare dashboard → R2 → bucket → Settings → CORS policy). Production:
```json
[{"AllowedOrigins":["https://www.sysgov.com","https://sysgov.com"],"AllowedMethods":["PUT"],"AllowedHeaders":["content-type"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]
```
   - The staging bucket lists the staging origin.
   - The preview bucket lists preview origins, or `"*"` on that bucket only (the signature is the control; partial wildcards are unverified on R2).
   - A dev bucket, if developers point local runs at R2, lists `http://localhost:3000`.
3. **Lifecycle rules.** Delete objects with prefix `tmp/` after 1 day. Abort incomplete multipart uploads after 1 day.
4. **Environment variables (all optional).**

| Variable | Default | Meaning |
|---|---|---|
| `UPLOAD_TRANSPORT` | `direct` | `proxy` is the operator lever (4 MiB on Vercel) |
| `UPLOAD_MAX_FILE_MB` | 500 | per-file cap for `document`, max 1024 |
| `UPLOAD_PARSE_SCALE` | 1 | scales the parse budgets |
| `UPLOAD_DAILY_GB_PER_ORG` | 50 | daily ingress per org; 0 = unlimited |
| `UPLOAD_SIGN_CONTENT_LENGTH` | 1 | set 0 only if the probe or browsers show signed length breaking honest uploads |
| `UPLOAD_ALLOWED_ORIGINS` | `appBaseUrl()` | origins the probe checks |

5. **Network egress.** Users' browsers must reach `https://{account}.r2.cloudflarestorage.com`. Name this host for corporate and government allowlists. If a CSP is ever added, its `connect-src` must include it.
6. **Readiness gate before PR 3 merges.** Run Admin → Jobs → File storage: the probe, then "Test from this browser". Do this on production, staging and a preview, and require green on all. Record in ADMIN_MANUAL whether R2 enforces the signed length.
7. **Migrations.** After PR 2 deploys, sync 0125 on `/admin/migrations`. Sync 0126 after PR 5.
8. **Before PR 5 merges**, run the usage query:
```sql
SELECT o.id, o.name, ts.tier_id,
  (SELECT coalesce(sum(file_size),0) FROM knowledge_artifact k WHERE k.organization_id=o.id)
 +(SELECT coalesce(sum(file_size),0) FROM solicitation s WHERE s.organization_id=o.id AND s.storage_path<>'')
 +(SELECT coalesce(sum(file_size),0) FROM solicitation_document d WHERE d.organization_id=o.id AND d.storage_path<>'')
 +(SELECT coalesce(sum(docx_file_size),0) FROM proposal_template t WHERE t.organization_id=o.id) AS bytes
FROM organization o LEFT JOIN tenant_subscription ts ON ts.organization_id=o.id ORDER BY bytes DESC;
```
   Assign a plan to any tenant with no `tenant_subscription` row, and raise the override for any tenant over its `storageGb`.
9. **Stale tabs.** Tabs open across a deploy get "Failed to find Server Action"; a reload fixes it. Mention this in the release note.

## 11. Docs to update

**`docs/BACKLOG.md` (every PR).**
- The BL-STAB-2 entry gets phase lines 2a–2f.
- The root cause is corrected: multipart file parts hit Vercel's 4.5 MB; the 1 MB applies to non-file action bodies.
- The final PR marks BL-STAB-2 shipped, with G (dictation) and the text pastes recorded as deliberate exceptions.
- New follow-up entries:
  - multipart and resumable uploads over 1 GiB
  - purging an org's storage prefix (needs ListObjectsV2 and query support in `signRequest`)
  - converting legacy Office files
  - `.zip` packages (BL-STAB-3)
  - a download route (`Content-Disposition: attachment`, `nosniff`, `recordRead`)
  - malware scanning
  - widening `file_size` to bigint
  - reconciling legacy orphaned objects

**`docs/ADMIN_MANUAL.md`:**
- Rewrite "File storage" (line 870) with: direct uploads, the CORS JSON per environment, the lifecycle rule, token scope, per-environment buckets, the variables, the proxy lever, memory-mode limits, the probe and self-test, the egress host, the ledger and sweeper, and a troubleshooting table:
  - status 0: CORS or network
  - 403 `SignatureDoesNotMatch`
  - "limited to 4 MB": memory mode or the proxy lever
  - "kept but not read": the parse budget
  - a growing purge backlog: the jobs cron is not running
- The `storageGb` row (line 493): the new meter plus reservations.
- Chat attachments (line 745): bytes are transient.
- The `/api/cron/jobs` row (line 722): the sweeper and the knowledge extraction job.
- Migrations 0125 and 0126.

**`docs/USER_MANUAL.md`:**
- New solicitation, amendments and companion documents: 500 MB per file, per-file progress, retry and cancel.
- Corpus (line 719): 50 MB becomes 500 MB.
- Templates: 50 MB.
- Chat (line 525): 20 MB becomes 50 MB, "held only until read".
- Contacts: the file is read in your browser, 500 rows per import.
- The "stored but not read automatically" and "older Office format" messages.

**`AGENTS.md` (PR 6).** Add a "What to flag" bullet: a server action that accepts a File or a FormData file should use the upload ledger flow instead.

## 12. Tests

**Pure tests (vitest, `tests/ai/`):**
- **`aws-sigv4.test.ts`.** Keep the AWS header vector (`f0e8bdb8…bdb41`) and the AWS presigned GET (canonical request SHA `3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04`, signature `aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404`). Add an R2 PUT vector. It was computed once by an independent Python implementation of the AWS query-auth spec, which also reproduces the AWS example, and checked equal to the current `presignUrl`.
  - Inputs:
    - method `PUT`
    - host `0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com`
    - path `/forge-uploads/org/11111111-1111-4111-8111-111111111111/uploads/22222222-2222-4222-8222-222222222222`
    - headers `content-type: application/pdf`, `content-length: 1048576`
    - region `auto`, service `s3`
    - AKIAIOSFODNN7EXAMPLE / wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
    - now `2026-10-08T12:00:00Z`, expires 900
  - Expected:
    - canonical request SHA `2edab4a409a483209d3ed366b4f6d5c32087b880d61f7565b4476f4ef177d6c6`
    - signature `1b059663382ac6037ea15a587a33992d57a870c277f368806bc8a420ec8dfcc3`
    - pin the full URL, whose query ends `…X-Amz-Expires=900&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost&X-Amz-Signature=1b05…dfcc3`
  - Type-only variant (`UPLOAD_SIGN_CONTENT_LENGTH=0`): signature `6f736194cd0438f39df4c688f49ed5f9e29cba7c912b7cba76a014aed65ce0ee`.
  - Tamper tests: the signature changes for content-length ±1, content-type, key, expiry, date and method.
  - `host` never appears in the returned headers. Expiry bounds are 1 and 604,800.
- **`storage-r2.test.ts`** (mocked `fetch`):
  - `head` returns size, type and ETag; a 404 returns null
  - `getRange` sends a signed `range` header and accepts 206
  - `get` aborts a stalled body read after the deadline
  - `delete` treats 204 and 404 as success
  - `presignPut` returns only `content-type` as a browser header
  - `storageTimeoutMs` bounds
  - the memory cache is shared through `globalThis`, and its ETag is the MD5
- **`upload-policy.test.ts`:**
  - `sanitizeDisplayName`: `../x`, `a/b\c`, U+202E, NUL, a 300-byte multibyte name, empty input
  - `formatFromName`, including refusing `.doc/.xls/.ppt` and `.csv` mapping to text
  - `canonicalContentType`
  - `validateUploadRequest` boundaries: 0, the maximum, the env clamp, `HARD_MAX`
  - `isKeyInOrg`: other orgs, the `org/{org}x/` prefix trick, `..`, `//`, a leading `/`, a backslash, `tmp/{org}/`, legacy keys pass
  - `expirySecondsFor`: monotonic and clamped
  - `parseBudgetBytes` with the scale
  - `tooLargeToReadMessage`
  - `utf8ByteLength`
- **`upload-verify.test.ts`.** Fixtures are built in the test by `tests/helpers/zip-fixtures.ts` from stored (uncompressed) entries, with sizes forged in the central directory.
  - PDF with leading junk
  - PNG, JPEG, GIF and WEBP
  - minimal docx, xlsx and pptx
  - OLE2
  - HTML named `.pdf`
  - SVG
  - `MZ` and ELF executables
  - text with a NUL
  - UTF-8 with BOM and UTF-16 with BOM
  - `inspectZipDirectory`: valid, a ZIP64 locator, a comment-padded EOCD, a bomb by total and by ratio, an encrypted entry, a missing marker, too many entries, truncated input
- **`upload-client-logic.test.ts`:**
  - `classifyPutFailure` for 0, 403 expired (by body text and by clock), 403 other, 413 and 503
  - `nextBackoffMs`
  - `progressSnapshot`
  - `chunkByBytes`
- **PR 6:**
  - `no-files-through-server-actions.test.ts` scans every `"use server"` file under `src/` for `instanceof File`, `.get("file")` and `getAll("files")`, with an allowlist that requires a reason
  - a dictation pin test (`DICTATION_LIMITS.maxBytes < 4.5 MB`)
  - a contacts row-chunking test

**Postgres isolation tests (`tests/isolation/uploads.test.ts` and others; `createTwoTenants`; memory storage):**
- **Intent:**
  - the row belongs to org A, the key is `org/{A}/uploads/{id}`, the transport is proxy in memory mode, and a `file_upload.intent` audit row exists
  - refusals: impersonation, oversize, legacy Office, rate limit, the per-user pending cap, the daily ingress cap
  - `template_docx` by a non-admin is refused and writes `auth_denied`; with the feature off it is refused
  - memory provider with env label `production` is refused
- **Complete:**
  - before the PUT gives `not_uploaded_yet`
  - a size mismatch (one byte short or long) is rejected, the object is deleted, and `file_upload.reject` is audited
  - HTML declared as `.pdf` gives `type_mismatch`
  - an OOXML bomb gives `zip_rejected` (PR 5)
  - two concurrent completes: exactly one updates
  - tenant B and user A2 get "not found" with zero storage calls (spy)
- **Claim:**
  - two concurrent claims produce exactly one domain row
  - a rerun of a `claiming` row older than 2 minutes produces no second row, and the open job is reused
  - a claim after 24 hours is refused
  - a purpose and resource-type mismatch is refused
  - a parent solicitation from tenant B is refused before the claim, and the upload stays `stored`
  - a domain insert failure leads to `releaseClaim`, back to `stored` with the same `resource_id`
- **Parse:**
  - a claimed solicitation parses through `executeJob` from storage with no inline bytes (stub AI)
  - over budget gives a permanent failure with the message and no `get` (spy)
  - an object swapped after verify (ETag mismatch) gives a permanent "changed" failure
  - legacy `org/{org}/solicitation/{id}/{name}` rows still parse
  - an OLE2 legacy row gives the clear message
- **B and F:** document filing; GSA with one bad id lands in `attachmentsSkipped` while the opportunity is still created; `runDurableBatch` runs the jobs in order.
- **Sweeper (PR 4):**
  - expired `pending` becomes `failed`/`expired` and the object is deleted
  - unclaimed `stored` past 24 h is deleted
  - `claiming` past `purge_after` is promoted when the resource exists, otherwise failed and deleted
  - failed and transient rows get a second delete
  - a corrupted row whose key points at org B is logged and never deleted
  - rows purged more than 90 days ago are pruned
  - org B's rows are untouched by org A's state
- **Quota (PR 5):** the meter sums all four tables plus reservations, with no double count after the claim; expired pending reservations drop out; an over-quota intent is refused; a tier set to null gives the new message.
- **PR 6:**
  - the chat object is gone after the claim and the attachment row holds the text
  - a template replace releases the old object
  - a corrupt docx leads to `failClaim`
  - contacts preview from rows re-sanitises tampered rows
  - `releaseStoredFile` on a solicitation delete covers its amendments and documents

**Gates:**
- `check:isolation` passes the new lib, actions and route with no allow-list entries
- `check:firewall`: `file_upload` has `organization_id NOT NULL`, the cascading FK and the leading-org index
- `check:drift`: all five indexes, the partial one included
- `check:rsc`: the hook and components are `"use client"`, and `upload-client.ts` is plain
- `check:links`
- fresh-DB migration verification

**Manual (PR bodies):**
- the probe and browser self-test on production, staging and preview
- Chrome, Edge, Firefox and Safari over HTTP/2 with 1 MB, 30 MB, 200 MB and 450 MB PDFs, with progress
- a 600 MB file refused on the client and a 1.1 GB file refused at intent
- a network drop mid-PUT, then retry
- removing the preview bucket's CORS rule shows a CORS diagnosis; then restore it
- a scanned PDF over 24 MB shows the vision message
- an XLSX over budget shows the parse-budget message

## 13. PR phasing

The order is strict and serial. Every title carries the ticket ID and updates BACKLOG. LOC figures are estimates of additions plus deletions; each PR lists what moves to the next PR if it measures over about 1,400 LOC before review.

| PR | Title | Contents | ~LOC | Ships | Moves if over |
|---|---|---|---|---|---|
| 1 | `feat(storage): BL-STAB-2a — storage verbs for direct uploads, and a readiness check` (the current draft PR, 67436c7 plus amendments) | storage.ts amendments; `storage-diagnostics.ts`; superadmin probe and ledger-free browser self-test on `/admin/jobs`; `putWithProgress` and `classifyPutFailure`; settings-status and env-check; SigV4 PUT vectors; R2 adapter and client-logic tests; ADMIN_MANUAL ops section | 1,350 | No user change. Ops configure CORS, lifecycle and tokens and reach green: the gate for PR 3 | settings-status entry → PR 2 |
| 2 | `feat(uploads): BL-STAB-2b — tenant-scoped upload ledger: intents, verification and claims` | 0125, schema, migration-check; `upload-policy.ts`; `sniffFormat`; `uploads.ts` (intent, complete, claim/finish/release/fail, peek, cancel, recordUploadFailure, reservations); `uploads/actions.ts`; isolation tests | 1,450 | Dark launch: the server contract tested against Postgres | `recordUploadFailure` and the report action → PR 3 |
| 3 | `fix(solicitations): BL-STAB-2c — new solicitations and amendments upload straight to storage` | `uploadFile`, `useUploadQueue`, `UploadQueue`; proxy route and memory inline helper; `getVerifiedObject`; path A action and both clients; `jobs.ts` `loadUploadBytes` (org key, budget, ETag, OLE2); `maxDuration`; self-test on the full pipeline; USER_MANUAL | 1,450 | The owner's main path: files up to 500 MB with progress, retry and cancel | AmendmentsPanel, ETag pin, self-test switch → PR 4 |
| 4 | `fix(solicitations): BL-STAB-2d — companion documents and GSA attachments upload to storage; abandoned uploads cleaned up` | Path B; reparse via `head` (both); path F with validate-before-create and 20 attachments; `runDurableBatch`; `sweepUploads` and the cron hook (budgets 60 + 15 + 165 s) | 1,400 | Every solicitation-family path off the transport cap; the sweeper live | reparse via `head` → PR 5 |
| 5 | `fix(knowledge): BL-STAB-2e — corpus uploads to storage, extraction as a durable job, one storage meter` | 0126; `knowledge-artifact-extract.ts`; job handler; path D; `CorpusUploader` queue; broadened meter and quota at intent; OOXML central-directory check wired into complete; tests | 1,450 | Corpus has no transport cap; one per-tenant storage policy; zip-bomb guard | zip check → PR 6 |
| 6 | `fix(uploads): BL-STAB-2f — templates, chat and contacts off the transport cap; files removed on delete` | Paths E, C and H; text-paste guards; `releaseStoredFile` and delete wiring (plus the `solicitation.delete` audit); no-File regression test; dictation pin; AGENTS.md; final docs; BL-STAB-2 marked shipped | 1,250 | No file goes through a server action anywhere; deleted documents leave storage | — |

After this: BL-STAB-6, BL-STAB-4, BL-STAB-3 and BL-STAB-5 build only claim-side logic on this pipeline.

## 14. Residual risks

- **R2 behaviour still unverified.** Whether R2 enforces a signed content-length, whether it checks expiry at the start or the end of a long PUT, and whether CORS accepts wildcard origins. The design is safe either way: HEAD verification, the ETag pin, short URL lifetimes, the sweeper and the caps. The PR 1 probe records each answer, and `UPLOAD_SIGN_CONTENT_LENGTH=0` is the lever.
- **CORS misconfiguration or corporate egress blocks.** Covered by the readiness gate, the server-side preflight diagnosis on status 0, the documented host, and `UPLOAD_TRANSPORT=proxy` (4 MiB).
- **Zip bombs that lie in their headers.** The central-directory check cannot catch these. The blast radius is bounded by the parse budget, by running in a background job, and by 3 attempts.
- **Memory under Fluid compute.** Concurrent large parses on one instance are bounded by the budgets and sequential batches. Tune with logs of bytes, format and milliseconds.
- **Page `maxDuration` for server actions** is documented by Next but untested here. Verify it in Preview during PR 3.
- **Org deletion** cascades the ledger rows and leaves the objects behind. This predates the change; a follow-up adds a prefix purge.
- **Concurrent template replace** can orphan one object. Rare; covered by the follow-up reconciliation.
- **Quota checks are advisory under concurrency.** There are no transactions; overshoot is bounded by the caps.

## 15. Open questions for the owner, with the default I would take

1. **Per-file default of 500 MB (ceiling 1 GB, settable by environment).** Default: yes.
2. **The storage quota will count solicitations, companion documents and templates, not only Knowledge (from PR 5).** Some tenants near their tier limit could start being refused. Default: yes, after the usage query and overrides for any tenant over its limit.
3. **Chat attachments will pass briefly through private storage.** They are deleted on read: worst case the URL lifetime plus 5 minutes, with a 1-day lifecycle backstop. Default: accept, and update the manuals.
4. **Legacy `.doc/.xls/.ppt` and password-protected Office files will be refused with a clear message.** Today they are accepted and then fail at parse. Conversion becomes a follow-up, which BL-STAB-5 (contracting-officer Q&A) may need. Default: refuse now.
5. **Files over the read budget (for example a PDF over 150 MB) are kept and listed but not read automatically.** Default: yes.
6. **BL-STAB-2 is six PRs. Should BL-STAB-7 (the SAM.gov key) go in right after PR 3 fixes the main path?** Default: keep the backlog order (after PR 6) unless the owner reorders.
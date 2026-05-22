# FORGE — Engineering standards

This document is the canonical source of truth for how code lands in
this repo. Every standard listed here is enforced by a CI gate, a
review process, or a documented convention. Bots (Vercel Agent,
Claude, Cursor, etc.) should read this file before reviewing or
authoring a PR; new human contributors should read it before opening
their first PR.

`AGENTS.md` at the repo root is the bot-facing pointer to this
document; `.vercel/agent.md` is the Vercel-Agent-specific subset.
Both reference back here — keep the canonical content in this file
and let the pointers stay short.

## Contents

1. [Multi-tenant isolation contract](#1-multi-tenant-isolation-contract)
2. [Audit logging](#2-audit-logging)
3. [Schema + migration discipline](#3-schema--migration-discipline)
4. [Server action conventions](#4-server-action-conventions)
5. [File organization](#5-file-organization)
6. [PR conventions](#6-pr-conventions)
7. [Pre-merge gate stack](#7-pre-merge-gate-stack)
8. [CODEOWNERS routing](#8-codeowners-routing)
9. [Code review etiquette](#9-code-review-etiquette)

---

## 1. Multi-tenant isolation contract

FORGE is a multi-tenant system. Every row in every tenant-scoped
table carries an `organization_id`. The contract:

**Every server action (any `"use server"` exported async function)
that touches a tenant-scoped table MUST:**

1. Call an auth gate at the top:
   - `requireAuth()` — only requires sign-in
   - `requireCurrentOrg()` — requires sign-in + an active org context
     (returns `{ user, organizationId }`)
   - `requireOrgMember(orgId)` — requires the user be a member of `orgId`
   - `requireOrgAdmin(orgId)` — requires the user be an admin of `orgId`
   - `requireSuperadmin()` — requires the platform-wide superadmin flag
2. Scope every `db.select/update/delete` on a tenant table with
   `eq(table.organizationId, organizationId)`.

**Enforcement:** `scripts/check-isolation.mjs` runs in CI on every PR.
It parses every `"use server"` file, derives the set of tenant-scoped
tables from the migrations (any table with an `organization_id`
column), and asserts each exported async function that touches one
of those tables:

- calls one of the auth gates above, AND
- references `organizationId` in the function body (proxy for "the
  query is scoped").

Legitimate exceptions (public token-scoped surfaces, share-link
loads, etc.) live in `.isolation-allow.json` with a one-line
documented reason.

### Common patterns

```ts
// Standard tenant-scoped server action
export async function createThingAction(input: ThingInput) {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  await db.insert(things).values({
    ...input,
    organizationId,
    createdByUserId: actor.id,
  });

  await recordAudit({ organizationId, actor, action: "thing.create", ... });
  revalidatePath("/things");
  return { ok: true };
}
```

```ts
// Super-admin cross-tenant read (e.g. /platform/audit-log)
export async function listEverywhereAction() {
  await requireSuperadmin();
  // No organizationId scope on purpose — superadmin sees all tenants.
  // Static isolation check accepts requireSuperadmin as the gate.
  return db.select().from(auditLogs);
}
```

```ts
// Token-scoped public surface (allow-listed)
// (entry must exist in .isolation-allow.json with rationale)
export async function getReviewRequestByTokenAction(token: string) {
  const [row] = await db
    .select()
    .from(opportunityReviewRequests)
    .where(eq(opportunityReviewRequests.token, token));
  // No auth gate — the token IS the gate.
  return row;
}
```

### Anti-patterns

- Accepting `organizationId` as a parameter to a `"use server"`
  function. The function becomes a client-callable endpoint that the
  caller controls — bypasses tenant isolation. Pull `organizationId`
  from `requireCurrentOrg()` instead.
- Using `user.organizationId` directly from the session in a query.
  The session can lag the current org context; always use
  `requireCurrentOrg()`.

---

## 2. Audit logging

Three helpers in `src/lib/audit-log.ts`:

| Helper | When to use |
|---|---|
| `recordAudit(input)` | After every successful **mutation** on a tenant-scoped table (insert / update / delete). |
| `recordRead(input)` | On **sensitive reads**: PDF / DOCX renders, share-link loads, USAspending lookups, anything that surfaces or exports data beyond the current request. Stamps `metadata.category = "read"` so the audit-log viewer can filter. |
| `recordAuthDenied(input)` | Called by the `require*` helpers before redirecting on a deny path. Writes `action: "auth_denied"`, `resourceType: "auth"`, `resourceId: <reason>`. |

### `action` naming convention

`"<resource>.<verb>"` — examples:

- `opportunity.create` / `.update` / `.delete` / `.advance_stage`
- `proposal.create` / `.advance_stage` / `.section.save`
- `solicitation.upload` / `.review.run`
- `user.set_superadmin` / `.set_disabled` / `.force_password_reset`
- `org.delete` / `.disable`
- `settings.update` / `.audit_retention.update`
- `proposal.export.render` / `.export.download`

For nested resources use dotted prefixes: `proposal.compliance.create`,
`proposal.review.comment`, `knowledge_artifact.usaspending_import`.

### Failure mode

`recordAudit` never throws. Failures are logged via the structured
logger but do not block the user-facing action. A missing audit row
is a forensic loss; a thrown audit error would break the user's flow.

### Retention

Per-tenant retention is configured under `/settings` (org admin only)
with a 90–3650 day bound. A daily cron at `/api/cron/prune-audit-logs`
deletes rows older than each tenant's configured window.

---

## 3. Schema + migration discipline

- **Schema source of truth:** `src/db/schema.ts` (Drizzle).
- **Migration files:** `drizzle/[NNNN]_<name>.sql`. Numbered
  sequentially without gaps.
- **Applied via:** `scripts/apply-schema.mjs` (idempotent; safe to
  re-run; skips already-applied migrations). NOT `drizzle-kit migrate`
  — the drizzle journal stops at 0017; everything from 0018+ is
  managed by `apply-schema.mjs`.
- **Fresh-DB verification:** `scripts/check-migrations-fresh.mjs`
  boots an ephemeral Postgres in CI, applies every migration from
  scratch, and verifies a re-run is a no-op. Runs on every PR.

### Coupling rule

If a PR touches `src/db/*.ts`, it must also add a new
`drizzle/[NNNN]_*.sql` file (or modify the corresponding one). The
schema-migration coupling gate in `.github/workflows/pr-quality.yml`
enforces this.

**Bypass label** (use sparingly, with rationale in the PR body):
`schema-no-migration` — for type-only changes to schema.ts that don't
affect generated SQL (e.g., adding a TypeScript-only utility type,
renaming a Drizzle const without changing the underlying column).

### Migration writing

- Use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` where idempotency
  matters (apply-schema may re-run)
- Document the why in a header comment block — every migration in
  `drizzle/` opens with a brief explanation
- For destructive operations: drop indexes / columns in a separate
  migration from the rename / re-add, never both in one file

---

## 4. Server action conventions

```ts
"use server";  // Always at the top of files exporting server actions

import { ... } from "drizzle-orm";
import { ... } from "@/db/schema";
import { ... } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";

export async function someActionThatChangesData(
  input: SomeInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 1. Auth gate (see §1)
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // 2. Input validation (zod where the shape is non-trivial)
  if (!input.title?.trim()) return { ok: false, error: "Title required." };

  try {
    // 3. The mutation, scoped by organizationId
    const [row] = await db
      .insert(thing)
      .values({ ...input, organizationId })
      .returning({ id: thing.id });

    // 4. Audit (see §2)
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "thing.create",
      resourceType: "thing",
      resourceId: row.id,
      metadata: { title: input.title },
    });

    // 5. Cache invalidation
    revalidatePath("/things");

    return { ok: true };
  } catch (err) {
    log.error("[someActionThatChangesData]", "error", { error: err });
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}
```

### Cache invalidation cross-references

Mutations that change Command Center counts (opportunity stage,
proposal stage, in-review count) must also `revalidatePath("/")` so
the dashboard stays in sync. See BL-7 in BACKLOG.md.

---

## 5. File organization

```
src/
├── app/
│   ├── (app)/                      # Authenticated routes
│   │   ├── opportunities/
│   │   │   ├── page.tsx            # Route page (server component)
│   │   │   ├── actions.ts          # Server actions for this route
│   │   │   ├── OpportunitiesClient.tsx  # Client components
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       └── actions.ts
│   │   └── platform/               # Super-admin only
│   ├── (auth)/                     # Sign-in / sign-up
│   └── api/
│       └── cron/                   # Scheduled jobs (Vercel Cron)
├── components/
│   ├── shell/                      # Top-level layout (NavContent, etc.)
│   └── ui/                         # Reusable primitives (Panel, PageHeader, etc.)
├── db/
│   ├── schema.ts                   # Drizzle schema — single source of truth
│   └── index.ts                    # `db` client
└── lib/                            # Pure helpers, types, business logic
    ├── audit-log.ts
    ├── auth-helpers.ts
    └── ...
```

### Conventions

- **Server actions live in `actions.ts`** next to the route. One file
  per route folder. Sub-routes get their own.
- **Client components live in `*.tsx` files with explicit `"use client"`.**
  Don't import server-only functions into them — the build catches this
  via the RSC boundary check.
- **Pure helpers, types, and business logic in `src/lib/`.** No
  framework concerns. Server-only helpers add `import "server-only"` at
  the top.
- **Drizzle schema in `src/db/schema.ts`.** All tables in one file for
  greppability. Types are auto-exported via `$inferSelect` /
  `$inferInsert`.

---

## 6. PR conventions

### Title format (gate-enforced)

Conventional commits: `<type>(<scope>)?: <summary>` where `<type>` is
one of: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`,
`style`, `build`, `ci`.

Examples:
- `feat(notifications): BL-13 Phase A — rules engine schema`
- `fix(audit): pathspec syntax for diff-size + secret-scan exclusions`
- `chore(ci): BL-QC — robotic pre-merge quality gates`

### Backlog hygiene (gate-enforced)

If the PR title or body references a `BL-N` (e.g., `BL-12`, `BL-12c`,
`BL-QC`, `BL-18-cleanup`), the diff must touch `docs/BACKLOG.md`.

Every BL ticket lands as a focused PR (or a phased series of focused
PRs). When a BL ships, mark it ✅ in the backlog with the per-PR detail.

### Diff size (gate-enforced)

Soft cap: **1,500 LOC** (additions + deletions, excluding lock files).
PRs over this fail the diff-size guard.

**Bypass label** (with rationale in body): `oversized-ok`. Use
sparingly. Large PRs are harder to review and ship more bugs.

### One PR at a time

Strict serial discipline: only one PR open at a time. Avoids the
rebase cascade where each merge invalidates sibling PRs.

When a logical unit of work spans multiple changes, prefer one larger
PR over multiple small PRs unless the phases are genuinely
independent. Fewer PRs = fewer review cycles = less compute spent on
gates.

---

## 7. Pre-merge gate stack

Every PR clears four tiers before merge:

### Tier 0 — existing required gates (`.github/workflows/pr.yml`)

| Gate | Catches |
|---|---|
| Type check | `tsc --noEmit` errors |
| Next build | RSC boundary bugs, server/client import violations |
| RSC boundary check | Server components importing non-component named exports from `"use client"` files |
| Multi-tenant isolation check | Unscoped queries on tenant tables (see §1) |
| Fresh-DB migration verification | Migrations that break a fresh deploy |

### Tier 1 — third-party

| Gate | Catches |
|---|---|
| Vercel Preview deploy | Build failures that the typecheck/next-build steps don't catch |
| Vercel Agent Review | Style / clarity / suggested-fix issues (see `.vercel/agent.md`) |
| Neon branch lifecycle | Per-PR DB branch off prod (soft-skips when `NEON_API_KEY` not configured) |

### Tier 2 — robotic quality gates (`.github/workflows/pr-quality.yml`)

| Gate | Bypass |
|---|---|
| ESLint | None |
| PR title format | None |
| Backlog hygiene | Remove incidental BL reference |
| Schema / migration coupling | Label `schema-no-migration` (type-only) |
| Diff-size guard | Label `oversized-ok` (justify) |
| Secret scan | Move legitimate match under `*.md` or `*/fixtures/*` |
| Drizzle schema validate | None — fix the schema |

### Tier 3 — human review (`.github/CODEOWNERS`)

See §8.

### Adding a new gate

1. Add a `jobs.<name>` block to `.github/workflows/pr-quality.yml`
2. Push, verify it passes/fails as expected on a draft PR
3. After merge, an admin adds the job's display name to **Settings →
   Branches → main → Require status checks** to make it blocking

---

## 8. CODEOWNERS routing

`.github/CODEOWNERS` routes specific paths to a code-owner reviewer.
Combined with branch protection's **Require review from Code Owners**,
changes to these paths cannot merge without explicit approval:

- `src/db/`, `drizzle/` — schema + migrations
- `src/auth.ts`, `src/lib/auth-helpers.ts`, `src/lib/audit-log.ts` —
  auth + audit primitives
- `scripts/check-isolation.mjs`, `.isolation-allow.json` —
  tenant-isolation enforcement
- `.github/` — CI / workflows / CODEOWNERS itself

When changing any of these, expect a code-owner review on top of the
robotic gates.

---

## 9. Code review etiquette

### Responding to Vercel Agent suggestions

Three buttons; pick the right one:

- **Accept** — agent's suggestion is correct; apply it. Vercel
  auto-marks it accepted when your fix commit matches the suggested
  change.
- **Ignore** — only when the suggestion is **wrong**: false positive,
  not applicable in our context, conflicts with a deliberate design
  decision. Leave a written rationale.
- **Resolve conversation (on GitHub)** — when you've addressed the
  issue in code with a different approach than the suggestion. The
  audit trail shows "resolved" rather than "accepted" or "ignored."

Anti-pattern: clicking **Ignore** to clear a UI counter when the issue
is actually fixed in code. Pollutes the audit trail; future reviewers
see "ignored" on a real security/maintainability finding and have to
dig to confirm the fix happened.

### Responding to human reviews

- Address every comment, even when "no change needed" — reply with the
  reasoning
- Push fixes for the entire review round in **one commit**, not one
  per comment. Reduces CI runs.
- After pushing, click **Resolve conversation** on threads you've
  addressed. The reviewer can re-open if they disagree.

### Batched fixes

When Vercel Agent posts multiple suggestions, address all of them in
one commit. Each push retriggers Vercel Agent; batching saves compute.
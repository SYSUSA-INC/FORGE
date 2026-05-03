# Pass 3 — Data Integrity Audit

## Executive Summary

The FORGE codebase has **three critical data integrity vulnerabilities** and **two data type inconsistencies** that can cause data loss or corruption under concurrent execution. The application correctly follows the Neon no-transaction pattern in most places (sequential operations with `.catch(() => undefined)` rollback), but violates this in one high-traffic operation. Foreign key cascades are generally correct, but migration drift exists (indices 0016 and 0025 are missing). JSONB default values use JavaScript arrays instead of SQL literals in two template columns.

---

## Findings

| Severity | File:line | Issue | Recommended fix |
|---|---|---|---|
| **P0** | `src/app/(app)/proposals/[id]/harvest-actions.ts:99-118` | Race condition: `harvestProposalToCorpusAction` reads existing artifact metadata, then decides to insert/update. Two concurrent calls for the same proposal will both read "no match", both insert, creating duplicate harvested artifacts and orphaning chunks. | Add unique constraint on `(organizationId, source, metadata->'proposalId')` OR use "select ... for update" (not available on Neon) OR implement upsert pattern with explicit conflict resolution. Consider: `INSERT ... ON CONFLICT (organization_id, source) WHERE metadata->'proposalId'=? DO UPDATE`. |
| **P0** | `src/app/(app)/knowledge-base/import/embed-actions.ts:66-68` | Sequential delete then insert without rollback guards. If chunk insertion fails mid-batch (line 90), chunks are lost. No `.catch()` wraps the individual `db.execute()` calls. | Wrap each `db.execute()` in try-catch with rollback, or re-read chunks after failure. Alternatively, INSERT with explicit temp IDs then DELETE old chunks only if all new ones succeed. |
| **P1** | `src/app/api/register/route.ts:125-149` | Multi-step allowlist consumption without transactional guarantees. Membership insert (line 137) can fail after allowlist lookup succeeds; allowlist then marked consumed (line 147) but no membership created. User is unable to sign up and can't retry (token consumed). | After membership insert, immediately check success before updating allowlist. If membership fails, skip the allowlist update. Currently: `if (!existingMembership) { await db.insert(...); }` then unconditionally `await db.update(allowlist, { consumedAt })`. Should be: only update allowlist if insert succeeded. |
| **P2** | `src/app/(app)/proposals/[id]/compliance/actions.ts:397-435` | Concurrent `runCompliancePreflightAction` calls overwrite each other's AI assessments without per-item locking. If two runs complete in parallel, verdicts from run A are clobbered by run B. Idempotency is documented but not enforced — no unique constraint prevents duplicate assessments. | Add `UNIQUE (proposalId, itemId, aiAssessedAt)` or update atomically per item with timestamp guard: `WHERE aiAssessedAt < now() - interval '1s'` to prevent overlapping assessments. Or use row-level lock simulation: `SELECT ... FROM compliance_item WHERE id = ? FOR UPDATE` (not on Neon). |
| **P2** | `src/db/schema.ts:913-922` | JSONB columns `variablesDetected` (line 913) and `sectionSeed` (line 918) use JavaScript array literal `[]` as default instead of SQL `sql\`'[]'::jsonb\``. Drizzle may fail to serialize at migration time or runtime inserts may coerce incorrectly. Array columns use correct `sql\`ARRAY[]::text[]\`` pattern (line 133); inconsistency. | Change lines 916 and 921 from `.default([])` to `.default(sql\`'[]'::jsonb\`)` to match pattern in line 168 (contractingVehicles), 183 (pastPerformance), 1039 (extractedRequirements). |
| **P3** | `src/app/(app)/proposals/[id]/harvest-actions.ts:38` | Documentation claims idempotency; implementation is not. Artifact reuse is detected via metadata scan (line 99-112), not a database-level constraint. If concurrent requests collide, duplicates will be created. | Add DB constraint or clarify that re-runs may create duplicates if issued concurrently (not true idempotency). |

---

## Migration Drift Summary

### Journal vs. Disk

**Confirmed gaps:**
- **0016**: Missing from both `/drizzle/meta/_journal.json` and disk. Journal skips from idx 15 (0015) to idx 17 (0017).
- **0025**: Missing from both journal and disk. Disk skips from 0024 to 0026.

Both appear to be intentional renumbering; no schema loss detected (0017 exists, 0026 exists).

### Schema.ts columns not yet migrated

None detected. All columns in `schema.ts` exist in migrations on disk:
- `outcomeLabel` (knowledge_artifact, knowledge_entry) — migration 0026
- `aiAssessment`, `aiAssessedAt` (compliance_item) — migration 0027
- All others present in 0000-0015, 0017-0024, 0026-0027

### Migrations with no corresponding schema.ts reference

None detected. All FK and type constraints in migrations are reflected in schema.

---

## Foreign-Key Cascade Review

**Correct cascades:**
- `proposal_section.proposalId → proposal`: cascade ✓ (correct; sections are owned by proposal)
- `knowledge_artifact_chunk.artifactId → knowledge_artifact`: cascade ✓ (correct; chunks are owned by artifact)
- `knowledge_extraction_candidate.promotedEntryId → knowledge_entry`: **set null** ✓ (correct; candidate is independent, entry is permanent)

**Potential concerns:**
- `notification.commentId → proposal_review_comment`: **set null** (line 748) — UI must handle null commentId gracefully when comment deleted. No issue found in code; UI filters/handles correctly.
- `compliance_item.proposalSectionId → proposal_section`: **set null** (line 691) — preserves requirement when section is deleted. Correct for compliance workflow.

No cascade issues detected.

---

## Data Type Consistency

### Empty Array Defaults

**Inconsistent:**
- `organizations.contractingVehicles` (line 168): `.default([])` ✗ Should be `sql\`'[]'::jsonb\``
- `organizations.pastPerformance` (line 183): `.default([])` ✗ Should be `sql\`'[]'::jsonb\``
- `solicitations.extractedRequirements` (line 1039): `.default([])` ✗ Should be `sql\`'[]'::jsonb\``

**Correct:**
- Array columns (text[], psc_codes, etc.) use `.default(sql\`ARRAY[]::text[]\`)` ✓
- Knowledge artifact chunks embedding, variables detected (line 915-916): `.default([])` — **INCONSISTENT but worse in proposal_template**
- proposalTemplates (line 915-916): `.default([])` — inconsistent with line 1039 pattern

**Risk**: Drizzle ORM may serialize JavaScript array `[]` as JSON string instead of SQL array literal, causing type mismatch on INSERT or NULL defaults on SELECT.

### Action Return Shapes

**Consistent pattern:** All actions return `{ ok: true; ... } | { ok: false; error: string }` except:
- `acceptInvite` in register/route.ts (line 68-69) uses pattern with optional `status?: number` — minor inconsistency but not a bug.

No drift to `{ success: true }` found. ✓

---

## Race Conditions & Idempotency Issues

### 1. `harvestProposalToCorpusAction` (CRITICAL)

**Pattern violation:**
```typescript
const existing = await db.select(...).from(knowledgeArtifacts)...  // Line 99
const match = existing.find(e => e.metadata?.proposalId === proposalId);  // Line 111
if (match) { /* update */ } else { /* insert */ }  // Line 118
```

Two concurrent requests will both see "no match" and both call `db.insert()`. PgBouncer will not conflict-check; the second insert will succeed, creating a duplicate.

**Expected:** Unique constraint or atomic INSERT ON CONFLICT.

---

### 2. `embedArtifactAction` (CRITICAL)

**Pattern violation:**
```typescript
await db.delete(knowledgeArtifactChunks).where(artifactId = ?)  // Line 66-68
for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
  for (let j = 0; j < slice.length; j++) {
    await db.execute(sql`INSERT INTO knowledge_artifact_chunk...`)  // Line 90 — NO catch
  }
}
```

If `db.execute()` at line 90 fails on the 50th of 100 chunks:
- Chunks 1-49 are inserted and persisted.
- Chunk 50+ fail.
- Function throws; caller (harvestProposalToCorpusAction, line 175) catches and **logs it as a best-effort operation**.
- Artifact is left with partial chunks; no rollback attempted.

**Expected:** Wrap each execute in try-catch, or batch all inserts then validate count.

---

### 3. `runCompliancePreflightAction` (MODERATE)

**Pattern violation:**
```typescript
for (const v of parsed.verdicts) {
  // ... validation ...
  await db.update(complianceItems).set({ aiAssessment: ..., aiAssessedAt: now }).where(...)  // Line 421
}
```

Two concurrent runs (e.g., user double-clicks "Run preflight"):
1. Run A: Processes section 1-3, updates items 1-9.
2. Run B: Processes section 1-3, updates items 1-9 (same items, same AI model different verdict).
3. Both complete; B's assessments overwrite A's because no lock/timestamp guards update.

**Expected:** Add `WHERE aiAssessedAt IS NULL OR aiAssessedAt < now() - interval '5s'` to prevent cascading overwrites.

---

## Top 10 Fix Order

1. **P0 — embedArtifactAction partial insert** (line 90): Wrap db.execute in try-catch to prevent orphan chunks on failure. 15 min.
2. **P0 — harvestProposalToCorpusAction duplicate inserts** (line 118): Add unique constraint on `(organizationId, source, proposalId from metadata)` or switch to INSERT ... ON CONFLICT pattern. 30 min.
3. **P1 — register acceptInvite orphaned allowlist** (line 145): Check membership insert result before updating allowlist. 10 min.
4. **P2 — compliance preflight concurrent overwrites** (line 421): Add timestamp guard to update to prevent cascading verdicts. 20 min.
5. **P2 — JSONB defaults inconsistency** (schema.ts lines 168, 183, 915-916, 1039): Standardize all JSONB array defaults to `sql\`'[]'::jsonb\`` pattern. 10 min.
6. **P3 — Document harvestProposalToCorpusAction idempotency limits** (line 38): Clarify that concurrent runs may create duplicates until FK unique constraint lands. 5 min.
7. **Documentation**: Add comment to embedArtifactAction explaining "best-effort partial chunks are OK due to semantic search reranking", or enforce atomic inserts. 5 min.
8. Run full test suite against concurrent register + invite paths to verify no acceptInvite orphans. 30 min.
9. Add integration test for harvestProposalToCorpusAction under concurrent double-click. 20 min.
10. Add integration test for embedArtifactAction failure at 50% completion. 20 min.

---

## Conclusion

**Risk level: HIGH.** Two P0 issues (race conditions, partial inserts) are reachable in production under normal load (concurrent users). The P1 issue (orphaned allowlist) is user-facing. Data is not lost immediately, but incremental corruption is possible (duplicate artifacts, orphan candidates, stale assessments).

**Immediate action required:** Fix P0 and P1 before next deploy.

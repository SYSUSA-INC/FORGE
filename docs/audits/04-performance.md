# Pass 4 — Performance Audit

## Executive summary

The FORGE codebase has **moderate performance foundations** with strong embedding infrastructure but critical missing indexes on hot-path tenant-scoped tables. The schema is clean (Drizzle + Postgres) and most server actions use batched queries. However:

1. **P0 Index gaps** — notification, opportunity, proposal, company, and compliance tables lack `organization_id` indexes. These are tenant-scoped queries on every page load (e.g., `/proposals` lists all org proposals). At 1000+ records per org, sequential scans are unacceptable.
2. **Embedding indexes exist but conservative** — IVFFlat indexes on chunks (lists=100) and entries (lists=50) are reasonable for semantic search, but pgvector best practice suggests lists=150–200 for 100K+ vectors in production scale.
3. **Batch N+1s avoided** — `getRecentAuditEvents()` and `getSectionSignals()` correctly batch lookups via `Promise.all()` and `selectDistinct()`. No `.map(async)` anti-patterns found.
4. **Compliance pre-flight payload** — trims section body to 12,000 chars (good); 2500 rows at enterprise scale is manageable in JS; token count per item is ~2000 chars / 3 tokens per char ≈ 6,000 tokens per assessment.
5. **Caching & invalidation** — `revalidatePath()` is often overly broad (e.g., `/proposals` when one section updates) but acceptable at current scale (<50 concurrent drafts); `unstable_cache` not used, so no cross-org leakage risk.

## Findings

| Severity | File:line | Type | Issue | Recommended fix |
|---|---|---|---|---|
| P0 | schema | index | `notification.recipient_user_id` not indexed; every unread query scans full table | `CREATE INDEX notification_recipient_user_id_idx ON notification(recipient_user_id)` |
| P0 | schema | index | `opportunity.organization_id` not indexed; `/opportunities` list does full scan | `CREATE INDEX opportunity_organization_id_idx ON opportunity(organization_id)` |
| P0 | schema | index | `proposal.organization_id` not indexed; `/proposals` list does full scan | `CREATE INDEX proposal_organization_id_idx ON proposal(organization_id)` |
| P0 | schema | index | `proposal_section.proposal_id` has FK but no explicit index; section list on `/proposals/[id]/sections` scans | `CREATE INDEX proposal_section_proposal_id_idx ON proposal_section(proposal_id)` |
| P0 | schema | index | `company.organization_id` not indexed; `/companies` list does full scan | `CREATE INDEX company_organization_id_idx ON company(organization_id)` |
| P0 | schema | index | `compliance_item.proposal_id` not indexed; compliance list page scans 1000+ rows | `CREATE INDEX compliance_item_proposal_id_idx ON compliance_item(proposal_id)` |
| P1 | schema | index | `knowledge_entry.organization_id` not indexed; fallback token-overlap in `brainSuggestForSection()` reads 200 rows sequentially (line 220) | `CREATE INDEX knowledge_entry_organization_id_idx ON knowledge_entry(organization_id)` |
| P1 | schema | index | `knowledge_artifact.organization_id` not indexed; not used directly but listed via loop in embed-actions (line 90+) | `CREATE INDEX knowledge_artifact_organization_id_idx ON knowledge_artifact(organization_id)` |
| P1 | brain-actions.ts:220 | scan | Fallback token-overlap reads 200 unfiltered rows from knowledge_entry on embedding failure; no LIMIT before text processing | Cap result to 50 rows earlier in query; add organization_id filter in raw SQL fallback |
| P2 | section-signals.ts:86–114 | aggregation | Pulls all review verdicts for org into memory; groups + tallies in JS (2500 rows at 100 proposals × 5 sections × 5 reviewers = fine now; at 1000 proposals becomes 25K rows — borderline) | Pre-aggregate in SQL using GROUP BY + COUNT if org grows past 500 proposals; add early LIMIT or date filter |
| P2 | compliance/actions.ts:365 | payload | `buildCompliancePreflightPrompt()` slices body to 12,000 chars per item; for 50-item compliance matrix = 600 KB prompt. At 10+ items × 3 tokens/char ≈ 36,000 tokens input (non-cached) | Consider pre-summarizing sections before pre-flight; or run pre-flight per-section, not per-matrix |
| P1 | admin-audit.ts:46–153 | batching | Audit log batches lookups correctly (Promise.all line 47, then line 131); no N+1 | — |
| P3 | RichSectionEditor.tsx:1–80 | bundle | TipTap editor with 8 extensions + prosemirror modules imported into React client; first-load impact unknown (typical: 150–250 kB gzipped) | Lazy-load via dynamic() on section editor route if not already; verify Lighthouse on `/proposals/[id]/sections` |
| P3 | intelligence/actions.ts:64–82 | aggregation | `buildSnapshot()` pulls all opps + proposals to group by stage in JS; fine for <500 opps, but should use SQL GROUP BY | Move grouping to SQL if org grows past 500 proposals |

## Recommended index list

Ready to run immediately (tested against PostgreSQL 14+):

```sql
-- Tenant-scoped lists (P0 — required for production scale)
CREATE INDEX IF NOT EXISTS notification_recipient_user_id_idx 
  ON notification(recipient_user_id);
CREATE INDEX IF NOT EXISTS opportunity_organization_id_idx 
  ON opportunity(organization_id);
CREATE INDEX IF NOT EXISTS proposal_organization_id_idx 
  ON proposal(organization_id);
CREATE INDEX IF NOT EXISTS proposal_section_proposal_id_idx 
  ON proposal_section(proposal_id);
CREATE INDEX IF NOT EXISTS company_organization_id_idx 
  ON company(organization_id);
CREATE INDEX IF NOT EXISTS compliance_item_proposal_id_idx 
  ON compliance_item(proposal_id);

-- Knowledge/Brain (P1 — fallback semantic search performance)
CREATE INDEX IF NOT EXISTS knowledge_entry_organization_id_idx 
  ON knowledge_entry(organization_id);
CREATE INDEX IF NOT EXISTS knowledge_artifact_organization_id_idx 
  ON knowledge_artifact(organization_id);

-- Optional: composite indexes for paginated lists (P2 — 10x scale)
CREATE INDEX IF NOT EXISTS proposal_organization_id_created_at_idx 
  ON proposal(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS opportunity_organization_id_stage_idx 
  ON opportunity(organization_id, stage);
```

## Top 10 fix order

1. **Run the 6 P0 indexes immediately** — they unblock list pages (notification, opportunity, proposal, company, compliance, section). Estimated query speedup: 50–1000× on populated orgs (100+ records).

2. **Add 2 P1 knowledge indexes** — fix the fallback token-overlap query in `brainSuggestForSection()` and enable earlier-stage filtering on knowledge listing. Not urgent if embedding backfill is complete.

3. **Cap fallback token-overlap at 50 rows** — in `brain-actions.ts:220`, change `.limit(200)` to `.limit(50)` and ensure org_id filter is in the raw SQL query on line 210–220.

4. **Validate embedding index stats** — after 100K+ vectors, run `ANALYZE knowledge_artifact_chunk` and check IVFFlat lists parameter. Postgres pg_stat_user_indexes should show low index reads on >10% of vectors (sign of over-tuning).

5. **Pre-aggregate section signals for enterprise** — if org hits 500+ proposals, refactor `getSectionSignals()` to use SQL `GROUP BY` instead of JS grouping (currently fine; future-proof).

6. **Audit revalidatePath() scopes** — `/proposals` invalidation on section update is broad. Consider `revalidatePath(\`/proposals/${proposalId}/sections\`)` instead to avoid unnecessary full-page builds.

7. **Measure TipTap bundle size** — check `/proposals/[id]/sections` first-load JS on Lighthouse. If >300 kB, lazy-load editor via `dynamic(() => import(...), { ssr: false })`.

8. **Compliance pre-flight optimization** — for orgs with 50+ items, either split pre-flight across sections or pre-summarize bodies. Monitor token spend (estimate: 6K/item).

9. **Cache compliance pre-flight** — response is deterministic until section body or RFP changes; use `unstable_cache(runCompliancePreflightAction, [proposalId, itemIds], { revalidate: 3600 })` to avoid re-runs.

10. **Monitor query latency** — add APM/observability on slow queries (e.g., detect sequential scans on org_id columns via Postgres logs or Neon observability). Re-check after indexes.

## Notes

- **Drizzle** handles FK relationships well; no manual CASCADE issues found.
- **No 1+1 loops** — actions avoid `.map(async x => query())` patterns; all batching is correct.
- **Embedding quality** — IVFFlat indexes exist and are tuned conservatively; semantic search is production-ready.
- **AI costs** — compliance pre-flight is bounded; compliance matrix capped at 12K chars per item and spans ~36K tokens (reasonable for Anthropic Claude usage).
- **Foreign keys are not auto-indexed** in Postgres; the schema relies on Drizzle FKs, which don't auto-create indexes on the referencing side. This is the root of the P0 indexes.

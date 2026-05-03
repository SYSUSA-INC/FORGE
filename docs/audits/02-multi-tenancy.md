# Pass 2 — Multi-tenancy Audit

## Executive summary

The FORGE platform has **two critical P0 multi-tenancy bugs** that allow any authenticated user to mutate proposals and companies from other organizations, plus a potential P2 in section-to-compliance cross-org assignment. The auth helpers (`requireCurrentOrg()`, `requireAuth()`) correctly establish the caller's organization, but multiple UPDATE and DELETE queries bypass the `organizationId` filter despite having ownership checks for read operations. This is an exploitable vulnerability: any user in any org can modify or delete arbitrary proposals/companies by ID, and potentially associate proposals with wrong sections.

## Findings

| Severity | File:line | Resource | Issue | Recommended fix |
|---|---|---|---|---|
| **P0** | src/app/(app)/proposals/actions.ts:241 | proposal | `updateProposalAction` performs UPDATE without organizationId filter — caller can mutate any proposal by id after ownership check passes | Add `eq(proposals.organizationId, organizationId)` to the WHERE clause on line 241 |
| **P0** | src/app/(app)/proposals/actions.ts:269 | proposal | `advanceProposalStageAction` performs UPDATE without organizationId filter — caller can change stage of any proposal by id | Add `eq(proposals.organizationId, organizationId)` to the WHERE clause on line 269 |
| **P0** | src/app/(app)/proposals/actions.ts:281 | proposal | `advanceProposalStageAction` performs UPDATE for submittedAt without organizationId filter — caller can mark any proposal as submitted by id | Add `eq(proposals.organizationId, organizationId)` to the WHERE clause on line 281 |
| **P0** | src/app/(app)/proposals/actions.ts:317 | proposal | `deleteProposalAction` performs DELETE without organizationId filter — caller can delete any proposal by id despite ownership check | Add `eq(proposals.organizationId, organizationId)` to WHERE on line 317 |
| **P0** | src/app/(app)/companies/actions.ts:121 | company | `updateCompanyAction` performs UPDATE without organizationId filter — caller can mutate any company by id after ownership check passes | Add `eq(companies.organizationId, organizationId)` to the WHERE clause on line 121 |
| **P0** | src/app/(app)/companies/actions.ts:142 | company | `deleteCompanyAction` performs DELETE without organizationId filter — caller can delete any company by id despite ownership check | Add `eq(companies.organizationId, organizationId)` to WHERE on line 142 |
| P2 | src/app/(app)/proposals/[id]/compliance/actions.ts:76 | compliance_item + proposal_section | `createComplianceItemAction` accepts `proposalSectionId` from input and inserts without verifying the section belongs to the same proposal/org — a user could link a compliance item to a section from a different proposal | Verify that `input.proposalSectionId`, if provided, belongs to the same proposal: `const [section] = await db.select({id: proposalSections.id}).from(proposalSections).where(and(eq(proposalSections.id, input.proposalSectionId), eq(proposalSections.proposalId, proposalId))).limit(1); if (input.proposalSectionId && !section) return error;` |
| P2 | src/app/(app)/proposals/[id]/compliance/actions.ts:119 | compliance_item + proposal_section | `updateComplianceItemAction` allows reassigning `proposalSectionId` without verifying the target section belongs to the same proposal | Apply same section ownership check as above |
| P3 | src/app/(app)/proposals/[id]/reviews/actions.ts:166 | proposal_section | `startReviewAction` accepts `sectionAssignments` with sectionIds and assigns reviewers without verifying each sectionId belongs to the proposal — a user could inject a section id from another org's proposal | Verify each sectionId in sectionAssignments exists in the target proposal: `const sectionIds = [...]; const validSections = await db.select({id: proposalSections.id}).from(proposalSections).where(and(eq(proposalSections.proposalId, input.proposalId), inArray(proposalSections.id, sectionIds))); if (validSections.length !== sectionIds.length) return error;` |

## Top 10 fix order

1. **P0 — proposals/actions.ts:241 (updateProposalAction)** — Simplest fix; impacts any proposal update. Add `eq(proposals.organizationId, organizationId)` to WHERE.
2. **P0 — proposals/actions.ts:317 (deleteProposalAction)** — Same pattern; impacts delete. Add organizationId filter.
3. **P0 — proposals/actions.ts:269 (advanceProposalStageAction stage update)** — Same pattern; impacts workflow. Add organizationId filter.
4. **P0 — proposals/actions.ts:281 (advanceProposalStageAction submittedAt)** — Same query with two WHERE conditions. Consolidate and add organizationId.
5. **P0 — companies/actions.ts:121 (updateCompanyAction)** — Same pattern as proposals. Add `eq(companies.organizationId, organizationId)`.
6. **P0 — companies/actions.ts:142 (deleteCompanyAction)** — Same pattern. Add organizationId filter.
7. **P2 — compliance/actions.ts:76 (createComplianceItemAction sectionId validation)** — Verify section belongs to proposal before insert.
8. **P2 — compliance/actions.ts:119 (updateComplianceItemAction sectionId validation)** — Verify section belongs to proposal before update.
9. **P3 — reviews/actions.ts:166 (startReviewAction sectionId validation)** — Verify all assigned sections belong to the target proposal.
10. **Audit:** Sweep all remaining action files for UPDATE/DELETE patterns that use `eq(table.id, id)` without org filter; add org filter to all tenant-scoped tables (opportunities, solicitations, knowledge*, notifications, etc.).

## Technical Notes

- **Root cause:** The codebase implements ownership checks (e.g., `ownsProposal()`) at the action entry point, then assumes subsequent queries will filter correctly. However, the UPDATE/DELETE statements only filter by id, not by id + organizationId. This is a classic "verify input, then trust it" bug — the id is trusted for the rest of the transaction even though a cross-org attacker could have guessed or sniffed it.
- **Why it's P0:** The action validates `organizationId` from the session, then immediately discards it during the write. An authenticated user in Org A with a guessed/observed proposalId from Org B can mutate Org B's data.
- **Token-authed endpoints are safe:** The `/review/[token]` and similar magic-link flows are correctly scoped by token (opaque random), so no P0 there.
- **Admin endpoints OK:** `/admin/*` correctly requires `requireSuperadmin()` before all writes.
- **Foreign key cascades:** The schema has proper cascades (onDelete: "cascade" on all child tables), so if an org is deleted, children cascade cleanly — no orphan leakage risk.


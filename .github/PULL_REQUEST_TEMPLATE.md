<!--
  PR template for FORGE. Required sections:
    - Summary
    - Pre-push self-review (BL-QC-self-review-gate enforces this section
      exists + every checklist row has a status)
    - Test plan
    - Risk

  The Pre-push self-review section is REQUIRED by a CI gate. Fill in
  every row before pushing — "N/A" is a valid status when the category
  genuinely doesn't apply to this PR (e.g., a docs-only PR can mark
  "Missing recordAudit on mutations" as N/A). When the category applies,
  spell out how you addressed it ("addressed: <how>") so the reviewer
  doesn't have to dig.
-->

## Summary

<!-- 1-3 sentences. What changes, why. -->

## Pre-push self-review

This section is required and enforced by the pre-push self-review CI
gate. Fill in **every row** before pushing.

| Concern from `.vercel/agent.md` | Status |
|---|---|
| Missing `recordAudit` on tenant mutations | N/A / addressed: <how> |
| Missing `recordRead` on sensitive reads (PDF render, share-link load, USAspending lookup) | N/A / addressed: <how> |
| Subtle isolation issues (`organizationId` referenced but not used in `where`) | N/A / addressed: <how> |
| Session-derived org context (`user.organizationId` used in a query instead of `requireCurrentOrg()` result) | N/A / addressed: <how> |
| `organizationId` as a server-action parameter (caller-controlled) | N/A / addressed: <how> |
| Cache invalidation gaps (`revalidatePath("/")` missing on Command-Center-affecting mutations) | N/A / addressed: <how> |
| Cron handlers without `Authorization: Bearer ${CRON_SECRET}` check | N/A / addressed: <how> |
| Schema change without matching `drizzle/[NNNN]_*.sql` content | N/A / addressed: <how> |
| Drizzle index parity gap (SQL migration creates an index that `schema.ts` doesn't declare) | N/A / addressed: <how> |
| Constant-condition filter/map callbacks (callback ignores its argument) | N/A / addressed: <how> |
| Dead-store / unused destructured setters not prefixed with `_` | N/A / addressed: <how> |
| New external API call without timeout / error handling | N/A / addressed: <how> |
| New file without server-only guard where it touches DB | N/A / addressed: <how> |
| Inbox-parity: any new `in_app` `notification_delivery` write also inserts a matching `notification` row | N/A / addressed: <how> |
| SELECT-then-UPDATE pattern: UPDATE filters by collected IDs (`inArray(id, ...)`), NOT by the same predicate as the SELECT | N/A / addressed: <how> |

## Test plan

<!--
Local checks:
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm run check:rsc` clean
- [ ] `npm run check:isolation` clean
- [ ] `npx drizzle-kit check` clean (if schema touched)

Post-merge manual verification:
- [ ] <user-facing scenario 1>
- [ ] <user-facing scenario 2>
-->

## Risk

<!-- What could go wrong; how it's mitigated; what's NOT in scope. -->

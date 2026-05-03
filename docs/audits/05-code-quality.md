# Pass 5 — Code Quality & Operational Readiness

## Executive summary

FORGE exhibits **moderate brittleness** in error handling, type safety, and observability. Key gaps:
- **99 `console.error/warn` calls** log internally only; zero observability backend (Sentry/Datadog). Production bugs are invisible.
- **Widespread unvalidated JSON parsing** from AI outputs using informal `extractJson` + `JSON.parse` chains without schemas.
- **Dual action return shapes**: Most use `{ ok: boolean; data | error }`, but AI actions return `Result | Error` union types (incompatible with client patterns).
- **Unsafe db.execute() result casts** using `as unknown as TypeX` chains in embedding/semantic search queries.
- **Promise.catch() silent failures** on AI pre-flight and compliance scoring: parse failures just `continue` rather than fail visibly.
- **No tests, no CI validation** — build doesn't run tests (no test suite exists).
- **Docs reflect current state** but don't mention operational requirements or troubleshooting.

No critical data-loss bugs found, but refactor-safety is low.

---

## Findings

| Severity | Area | File:line | Issue | Recommended fix |
|---|---|---|---|---|
| P1 | observability | src/lib/ai.ts + 99 sites | 99x console.error/warn calls, zero telemetry. Production bugs invisible. | Integrate Sentry error tracking; wrap console.error calls with `captureException()`. |
| P1 | type safety | src/app/(app)/knowledge-base/import/embed-actions.ts:205–206 | `result as unknown as { rows? } as unknown as rows` — three-layer cast to work around Drizzle unknown typing. Parsing failure = no error. | Type-safe wrapper around `db.execute(sql`...`)` results; validate shape at runtime with zod or manual checks. |
| P1 | type safety | src/app/(app)/proposals/[id]/compliance/actions.ts:390 | `JSON.parse(extractJson(raw))` on AI output without schema validation. Parse failure logs warning, skips item (`continue`), user gets partial results silently. | Use zod to validate `CompliancePreflightVerdict[]` shape before parsing. Fail the action if verdicts malformed. |
| P1 | consistency | src/app/(app)/opportunities/[id]/ai/actions.ts:20–31 | Opportunity brief returns `OpportunityBriefResult | OpportunityBriefError` union; compliance action returns `{ ok: boolean; ... }`. Client code must handle both patterns. | Normalize all actions to `Promise<{ ok: true; ...} \| { ok: false; error }>` or use a consistent union. Document the pattern. |
| P2 | error handling | src/app/(app)/proposals/[id]/compliance/actions.ts:383–395 | AI call and JSON parse failures silently `continue` instead of returning error. User sees partial batch results without warning. | Return early with `{ ok: false; error: "..."; assessed, attempted }` to signal incomplete run. |
| P2 | type safety | src/lib/knowledge-entry-embed.ts:130 | `const obj = v as Record<string, unknown>` on array element. No check that `v` is an object. | Validate with `typeof v === 'object' && v !== null` before cast. |
| P2 | naming | src/app/(app)/companies/actions.ts:114 | `createCompanyAndGoAction` returns `Promise<void>` (throws or redirects). Caller has no way to know if it succeeded. | Return `{ ok: boolean; error?: string }` and let client check before redirect. |
| P2 | test coverage | / | Zero test files in src/. Build doesn't run tests. No linting in CI. | Create src/__tests__/ directory. Add jest or vitest. Wire up pre-commit linting. |
| P3 | duplication | src/lib/solicitation-extract.ts:113, 183, 247 | `JSON.parse(cleaned) as SolicitationExtractionResult` repeated 3x. `extractJson()` used in 1 file. | Export `parseSolicitationJson()` helper. Reuse across all AI JSON parsing. |
| P3 | documentation | docs/USER_MANUAL.md | Comprehensive but no mention of "AI features require provider setup" or stub-mode UX. Readers unaware of eBuy stub, brief stub, etc. | Add "AI Features & Setup" section noting stub-mode behavior when env vars missing. |

---

## Env var contract

| Var | Required? | Default | Failure mode |
|---|---|---|---|
| `DATABASE_URL` | YES | — | App crashes on first DB query (Drizzle init fails). |
| `AUTH_URL` | YES | — | NextAuth init fails. |
| `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` | NO (OAuth optional) | — | Google SSO disabled. Local email/password auth still works. |
| `AUTH_MICROSOFT_ENTRA_ID_*` | NO | — | Microsoft SSO disabled. |
| `OPENAI_API_KEY` | NO | — | AI features return `{ stubbed: true }`. UI shows red "stub mode" warning. |
| `OPENAI_EMBEDDING_MODEL` | NO | "text-embedding-3-small" | Embeddings use default if present; skip if OPENAI_API_KEY absent. |
| `EMBEDDING_PROVIDER` | NO | "none" | Semantic search disabled; knowledge base in read-only stub mode. |
| `RESEND_API_KEY` | NO | — | Email disabled. Forgot-password, invites fail silently (console.error logged). |
| `SAMGOV_API_KEY` | NO | — | SAM.gov sync disabled (read-only stub UI message). |
| `EMAIL_FROM` / `EMAIL_FROM_ADDRESS` | NO | "noreply@sysgov.com" | Email fallback. |
| `SIGNUP_MODE` | NO | "open" | "open" = anyone can sign up; "invite-only" = no signup link. |
| `NODE_ENV`, `VERCEL_ENV`, `VERCEL_URL` | Optional | auto-detected | Used for environment detection, not safety-critical. |
| `AI_DEFAULT_MODEL` | NO | "claude-3-5-sonnet" | Default model if not overridden. |

**Missing env validation on startup.** If `DATABASE_URL` is unset, the error is buried in Drizzle's connection failure during first request, not at boot.

---

## Stub-mode coverage

| Feature | Has stub fallback? | Banner consistency |
|---|---|---|---|
| Section drafting (Brain) | ❌ No | No stub mode; fails visibly if embeddings disabled. (Knowledge-base must be populated to work.) |
| Opportunity brief | ✅ Yes | Red text: `<span className="text-rose">stub mode (no AI provider configured)</span>` — jarring. |
| Pipeline brief | ✅ Yes | Same red "stub mode" text. |
| eBuy paste extraction | ✅ Yes | Red text in `EbuyPasteClient.tsx`: "AI is in stub mode...". |
| Compliance pre-flight scoring | ✅ Yes (logs warning, skips) | No banner; user sees partial results silently. |
| Knowledge-base semantic search | ✅ Yes | Returns empty results if embeddings disabled. No banner. |
| Solicitation extraction | ⚠️ Partial | Returns `{ stubbed: true }` but no UI signal. |
| Winner analysis | ⚠️ Partial | No explicit stub flag found. |

**Inconsistency**: Some features show red "stub mode" banners (jarring UX), others fail silently, others return `{ stubbed: true }` without UI feedback. Consider a unified "AI Setup" interstitial or softer "feature unavailable; click to configure" pattern.

---

## Error handling patterns

### Silent failures (continue without visibility)
- **Compliance pre-flight**: AI call fails → logs warning → skips item → user sees partial results without knowing why.
- **JSON parse**: Malformed JSON → logs warning → skips item → no indication to user.
- **Email**: Resend API missing → `console.error` → invite never sent, user never notified.

### Correct patterns (logged + returned)
- **Company creation**: Try/catch → `console.error` → return `{ ok: false; error: ... }`.
- **Proposal update**: Try/catch → log + return error tuple.

### Inconsistent patterns
- `createCompanyAndGoAction` returns `Promise<void>`. Success = redirect. Failure = throw (uncaught). Client can't distinguish.
- `generateOpportunityBriefAction` returns union: `OpportunityBriefResult | OpportunityBriefError`. Not `{ ok: boolean }`.

---

## Type safety gaps

| Gap | Impact | Example |
|---|---|---|
| **Drizzle `db.execute()` unknown typing** | Results typed as `unknown`; cast chains bypass TS checks. Runtime shape mismatches silent. | `(result as unknown as { rows? }) as rows` in embed-actions.ts |
| **Unvalidated AI JSON** | Malformed output silently skipped; features degrade without error. | `JSON.parse(extractJson(...))` in compliance pre-flight. |
| **Record<string, unknown> jsonb fields** | No narrowing on access. Assumes shape matches schema. | `metadata` field accessed without type guard. |
| **"as const" usage** | 44 instances of assertion casts. Some bypass validation. | `as ComplianceAIAssessment` in compliance items. |

---

## Documentation assessment

**USER_MANUAL.md**: Comprehensive, up-to-date. Covers roles, workflows, audit trails. **Gap**: No mention of AI features, stub modes, or provider setup. Readers won't know why "AI brief" is red or what to do.

**ADMIN_MANUAL.md**: Covers user/org admin, SSO, invites. **Gap**: No troubleshooting, no "why is email not working", no "enable embeddings for search".

**README.md**: Minimal. Just scaffolding docs structure. **Gap**: No quickstart, no deploy checklist, no env var reference.

**Missing**: 
- Operational runbook (how to debug stub mode, restart AI service, etc.).
- Env var guide (which are required, which optional, what breaks without each).
- Telemetry / logging strategy (there is none).

---

## Top 10 fix order

1. **Integrate error tracking** (Sentry free tier).  Wrap `console.error` calls. Visibility into production bugs.
2. **Normalize action return types**. All `Promise<{ ok: boolean; error?: string; data? }>`. No unions.
3. **Validate AI JSON with zod**. Parse schemas for compliance verdicts, opportunity brief, etc.
4. **Type-safe db.execute wrapper**. Single function that validates Drizzle sql`...` results. Reuse across embed, search, etc.
5. **Fail visibly on partial batch results**. Compliance pre-flight: if any item fails, return early with attempt count.
6. **Add startup env validation**. Check required vars on app boot; error early.
7. **Unify stub-mode UI**. Soft "feature needs setup" banner instead of harsh red "stub mode". Link to settings.
8. **Export AI JSON parsers**. DRY out `JSON.parse(...extractJson(...))` patterns into reusable helpers.
9. **Add pre-commit linting**. ESLint + Prettier. Catch `any` and unsafe casts before merge.
10. **Write operational runbook**. Stub modes, env vars, troubleshooting, alerting gaps (no telemetry).

---

## Notes on brittleness

- **Refactor risk**: Action return shape changes will require edits across ~40 client components. No test harness to verify.
- **Silent data loss**: Compliance scoring batch skips malformed items without logging which ones failed. Auditor has no way to know.
- **Observability debt**: 99 error logs and zero structured telemetry. We have no production metrics, no error budgets, no alerting.

# Pass 1 — Security Audit: FORGE Codebase

## Executive Summary

FORGE demonstrates solid foundational security practices with proper use of auth helpers, parametrized database queries (Drizzle ORM), and secure token handling. However, there are **3 high-severity findings** requiring immediate remediation: (1) **VERIFIED P0** — unvalidated open redirect in sign-in/sign-up flows via `callbackUrl` parameter, (2) **P1** — no rate limiting on public signup or magic-link review endpoints (abuse/cost-bombing risk), and (3) **P1** — unvalidated user-supplied proposal renderId passed to storage layer without multi-factor ownership checks. The platform is not safe to operate as-is under adversarial conditions; these must be fixed before production traffic.

---

## Findings

| Severity | Area | File:Line | Finding | Recommended Fix |
|---|---|---|---|---|
| **P0** | CSRF / Open Redirect | src/app/(auth)/sign-in/page.tsx:14 | Unvalidated `searchParams.callbackUrl` used directly in `redirect()`. Attacker can craft `/?callbackUrl=https://attacker.com` to redirect users post-login. | Validate callbackUrl is a relative URL starting with `/` or whitelist allowed paths. Implement helper: `isAllowedRedirect(url) { return url.startsWith('/') && !url.startsWith('//') }` |
| **P0** | CSRF / Open Redirect | src/app/(auth)/sign-in/SignInForm.tsx:27 | Client-side redirect via `window.location.href = callbackUrl` without validation. Bypass server-side checks possible. | Apply same whitelist validation before assignment. Use Next.js `useRouter().push()` with validated relative URL only. |
| **P1** | Rate Limiting / Abuse | src/app/api/register/route.ts | No rate limiting on POST /api/register. Self-service signup (when SIGNUP_MODE=open) allows unlimited account creation per IP. Risk: account enumeration, bot signup spam, resource exhaustion. | Implement rate limiting (e.g., 5 signup attempts per IP per hour via Redis or in-memory cache). Consider CAPTCHA for public signup. |
| **P1** | Rate Limiting / Abuse | src/app/(app)/opportunities/[id]/review/actions.ts:36-161 | Magic-link review requests (`/review/[token]` flow) have no rate limiting. Endpoint is public and token-authed. Attacker can spam `sendOpportunityReviewRequestAction()` to generate unlimited tokens, DOS reviewer inboxes, or cost-bomb via email sending. | Implement per-org rate limit (e.g., max 20 review requests per org per hour). Log and alert on spike patterns. |
| **P1** | Authorization | src/app/api/proposals/[id]/pdf/[renderId]/route.ts:28-30 | `renderId` ownership check depends solely on `proposalId` + `organizationId`. If attacker can guess/enumerate renderId values, they may access PDFs from other proposals in the same org. | Add foreign-key constraint verification and cache the renderId→proposalId mapping. Alternatively, cryptographically sign renderId values. |
| **P2** | Secrets Handling | src/lib/email.ts:45 | `NEXT_PUBLIC_APP_URL` or `AUTH_URL` env var used to construct verification/reset-password links. If `NEXT_PUBLIC_APP_URL` is exposed on the client bundle, any hardcoded secrets it contains will leak. | Verify that `NEXT_PUBLIC_APP_URL` contains only the domain and scheme (e.g., `https://app.sysgov.com`), never bearer tokens or API keys. Use `process.env.AUTH_URL` on server-only. |
| **P2** | Defense-in-depth | src/app/api/samgov/entity/route.ts:7-31 | `/api/samgov/entity` is public (no auth check). Unauthenticated callers can look up SAM.gov entities by UEI. While SAM.gov is public data, this could enable reconnaissance or be abused as a proxy. | Add `requireAuth()` check or per-IP rate limit. Alternatively, cache responses aggressively (1 hour TTL). |
| **P2** | Email Enumeration | src/app/api/forgot-password/route.ts:38-45 | Endpoint always returns `{ ok: true }` regardless of whether email exists. While this prevents enumeration of registered accounts, it also silently drops reset emails for non-existent accounts. Consider user experience trade-off. | Document as intentional. If enumeration risk is material, add a Redis-backed check to rate-limit repeated failed resets from the same IP. |
| **P2** | Token Handling | src/lib/tokens.ts:6-11 | Token TTLs are hardcoded constants. Invite tokens have 7-day TTL (reasonable), but reset-password is 1 hour (tight). Email delivery delays or user timezone issues could cause valid resets to fail. | Consider allowing users to re-request if token expired (already implemented). Document TTL expectations in client-side error messages. |
| **P2** | XSS / Markdown | src/components/help/MarkdownRenderer.tsx:1-118 | `ReactMarkdown` renders untrusted markdown with `remarkGfm` plugin. No explicit sanitization or HTML-stripping observed. If user-controlled markdown (e.g., from knowledge base, notes) is passed here, inline script execution risk. | Add `skipHtml: true` to ReactMarkdown props to strip all HTML. Use `rehype-sanitize` plugin for additional safety. Test with `<img src=x onerror=alert(1)>`. |
| **P3** | Informational | src/lib/email.ts:320-327 | `escapeHtml()` function is duplicated. Already used in multiple email functions; slight risk of inconsistent application. | Consolidate to single helper in utils, mark as standard escape point. Audit all email bodies (verified as safe). |

---

## Additional Observations (No Action Required)

1. **Parametrized Queries**: All database queries use Drizzle ORM with proper parameterization. No raw SQL injection risks found.
2. **Auth Helpers**: `requireAuth()`, `requireCurrentOrg()`, `requireOrgAdmin()`, `requireSuperadmin()` are consistently applied to server actions. No missing auth checks on sensitive mutations detected.
3. **CSRF Protection**: Next.js Server Actions provide automatic CSRF protection via secure cookies. All state-changing operations use server actions (POST routes use explicit auth checks).
4. **Token Generation**: 32-byte random tokens with SHA256 hashing + single-use enforcement (via `consumeToken()` delete). Sufficient entropy and expiry controls.
5. **Password Reset Flow**: Tokens issued per-email, not per-user account. Prevents account takeover if reset token is leaked. Secure.
6. **AI Cost Control**: No explicit rate limiting on AI endpoints (compliance preflight, brain extraction, auto-draft). Under high load, could incur cost overages. Recommend adding per-user/org quota tracking.

---

## Top 10 Fix Order

1. **URGENT — Fix open redirect in sign-in**: Validate `callbackUrl` to relative paths only. Block `//`, `http://`, `https://` prefixes. Test with `?callbackUrl=https://attacker.com` and `?callbackUrl=//attacker.com`.
2. **URGENT — Add rate limiting to /api/register**: Implement IP-based rate limit (5 requests per hour). Add to Next.js middleware or edge function.
3. **URGENT — Add rate limiting to review request flow**: Limit `sendOpportunityReviewRequestAction()` to 20 requests per org per hour. Log spikes for monitoring.
4. **HIGH — Strengthen PDF renderId ownership check**: Verify renderId belongs to the proposal and org. Use JWT-signed renderId or add database constraint.
5. **HIGH — Add auth check to /api/samgov/entity**: Require `requireAuth()` or add response caching with 1-hour TTL to reduce abuse surface.
6. **MEDIUM — Disable HTML in ReactMarkdown**: Add `skipHtml: true` to all `<ReactMarkdown>` components. Test with malicious HTML payloads.
7. **MEDIUM — Document token TTLs**: Add comments explaining 1-hour reset-password TTL and retry mechanisms in UI. Consider extending to 2-4 hours if user feedback warrants.
8. **MEDIUM — Add AI endpoint rate limiting**: Implement per-org quota (e.g., 50 AI calls per day). Log token usage to track costs.
9. **LOW — Consolidate escapeHtml helper**: Move to shared utility module. Audit all email body construction for missed escapes.
10. **LOW — Monitor email enumeration**: Track patterns of repeated `/api/forgot-password` requests from same IP. Alert on >10 failed attempts per hour.

---

## Risk Level Summary

- **P0 (Exploitable Today)**: 2 findings — Open redirect + rate-limited abuse vectors. Must fix before customer data access.
- **P1 (Exploitable Under Conditions)**: 3 findings — Revenue-risk AI overages, PDF access controls, public entity enumeration.
- **P2 (Defense-in-Depth)**: 4 findings — Token TTL, HTML rendering, hardcoded env checks, informational.
- **P3 (Informational)**: 1 finding — Code duplication, no security impact.

**Recommendation**: Do not promote to production until P0 and P1 findings are resolved. P0 is a critical customer-facing issue (phishing risk via malicious callbackUrl). P1 findings expose the platform to abuse and cost control issues in a multi-tenant SaaS environment.


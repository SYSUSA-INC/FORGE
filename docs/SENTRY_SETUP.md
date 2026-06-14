# Sentry — runtime error observability

This document describes how Sentry is wired into FORGE and the
one-time operator setup required to start receiving errors.

## What it catches

| Layer | Caught by |
|---|---|
| Uncaught exceptions in client components | `sentry.client.config.ts` |
| Unhandled promise rejections in the browser | `sentry.client.config.ts` |
| Uncaught exceptions in server actions / RSC | `sentry.server.config.ts` (via `instrumentation.ts`) |
| Errors thrown by route handlers under `app/api/**` | `sentry.server.config.ts` (via `onRequestError` re-export in `instrumentation.ts`) |
| Errors thrown by Edge runtime middleware (NextAuth) | `sentry.edge.config.ts` (via `instrumentation.ts`) |

## What it does NOT catch (intentional)

To stay within Sentry's free tier (5k errors/month), the SDK is
configured to skip these surfaces:

- **Performance monitoring** (`tracesSampleRate: 0`) — uses a separate
  quota and adds noise. Enable only if a specific perf investigation
  needs it.
- **Session replay** (`replaysSessionSampleRate: 0` + `replaysOnErrorSampleRate: 0`)
  — paid feature + privacy concerns (records UI interactions).
- **Vercel Cron Monitors** (`automaticVercelMonitors: false`) — paid
  feature; we already log cron success/failure manually.

## What's ignored (noise filtering)

Errors with these names or patterns are dropped before they hit
Sentry's quota. See the `ignoreErrors` arrays in each
`sentry.*.config.ts`:

- `NEXT_REDIRECT`, `NEXT_NOT_FOUND`, `NEXT_HTTP_ERROR_FALLBACK` — Next.js
  framework signals; these are control flow, not errors
- `AbortError` — fetch was cancelled (e.g., user navigated away)
- `ResizeObserver loop limit exceeded` — benign browser quirk
- `chrome-extension://`, `moz-extension://` — third-party browser
  extension errors we can't fix

If real bugs are leaking into these patterns, narrow the regex.

## One-time operator setup

### 1. Create a free Sentry account

1. Go to https://sentry.io/signup/
2. Use the **Developer** (free) plan — 5k errors/month, 50 MB attachments
3. Create an organization (e.g., `sysusa-forge`)
4. Create a project:
   - Platform: **Next.js**
   - Name: `forge`
   - Alert rule: defaults are fine (alert me on the first error in a new issue + on regression)

Sentry will show a DSN after project creation — looks like:

```
https://abc123xyz@o111222.ingest.us.sentry.io/333444
```

Copy it. You'll paste it into Vercel in step 2.

### 2. Add the DSN to Vercel env vars

In **Vercel → forge project → Settings → Environment Variables**, add
both of these. Same value for both (Sentry's SDK reads the public one
client-side, the private one server-side; we set both to keep
config simple):

| Name | Value | Environments |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | the DSN from step 1 | Production (optionally Preview too) |
| `SENTRY_DSN` | the same DSN | Production (optionally Preview too) |

**Why two env vars:** `NEXT_PUBLIC_*` gets inlined into the client
bundle (required for browser SDK init). The unprefixed variant is what
the server reads. Sentry's docs recommend setting both.

Save and trigger a redeploy.

### 3. (Optional) Source-map upload for better stack traces

Without source-map upload, stack traces in Sentry show minified
identifiers (`a.b.c()`). With source-map upload, they show real
function names. Costs nothing extra on Sentry's side.

To enable:

1. In Sentry → **Settings → Auth Tokens** → create a token with the
   `project:releases` scope
2. Add to Vercel env (Production only):

   | Name | Value |
   |---|---|
   | `SENTRY_AUTH_TOKEN` | the auth token from step 1 |
   | `SENTRY_ORG` | your Sentry org slug |
   | `SENTRY_PROJECT` | the project name (`forge`) |

3. Redeploy. The `@sentry/nextjs` build plugin picks these up
   automatically and uploads source maps + creates a release tied to
   the deploy's git SHA.

If skipped: errors still get captured, just with minified stack traces
in the Sentry UI.

## Local development

Sentry **does NOT activate locally** because `NEXT_PUBLIC_SENTRY_DSN`
is not set in `.env.local` (and shouldn't be — would waste quota on
dev errors). Each `sentry.*.config.ts` checks for the DSN and no-ops
when absent.

To test Sentry from local dev:

1. Add `NEXT_PUBLIC_SENTRY_DSN=...` to `.env.local`
2. Restart `next dev`
3. Throw a test error from a page → it should appear in Sentry within
   a few seconds

## How to verify it's working in production

After the env var is set + the next deploy completes:

1. Visit the production site
2. Open DevTools → Network tab, filter for `sentry.io` or `/monitoring`
3. Trigger any error (e.g., navigate to a deliberately-broken URL via
   the address bar — `/not-a-real-route` returns 404, which is not an
   error)
4. To force a real error: open the DevTools Console and run:

   ```js
   Sentry.captureMessage("Test from production");
   ```

   (Requires `window.Sentry` global — the SDK adds it automatically
   when initialized.)

5. Check Sentry's **Issues** view within 1-2 minutes. The test message
   should appear.

## Quota monitoring

Sentry's free tier is 5k errors/month. To monitor:

- Sentry → **Stats** → see throughput vs. quota
- Set an **Alert Rule** in Sentry to email you when monthly usage hits
  80% so you can investigate noise or upgrade

If quota is consistently exhausted, the first response is to widen the
`ignoreErrors` patterns in each `sentry.*.config.ts`, not to upgrade
the plan. Cheap to pre-filter, expensive to ingest.

## Disabling Sentry

To shut off Sentry entirely (e.g., if quota explodes and you're
between deploys):

1. Remove `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` from Vercel env vars
2. Redeploy

The SDK no-ops cleanly when the DSN is absent; no code changes needed.

## How the wiring works

```
┌──────────────────────────────────┐
│  next.config.mjs                 │  withSentryConfig wrapper
│  (build-time bundling)           │  - Bundles SDK into client + server
└─────────┬────────────────────────┘  - Tunnels through /monitoring
          │                            - Uploads source maps if token set
          │
          ├──→ sentry.client.config.ts  (browser init)
          │
          ├──→ src/instrumentation.ts ──┐
          │                             ├──→ sentry.server.config.ts  (Node init)
          │                             └──→ sentry.edge.config.ts    (Edge init)
          │
          └──→ onRequestError re-export  (route-handler error capture)
```

The `withSentryConfig` plugin is loaded statically at the top of
`next.config.mjs`. The runtime SDK init reads the DSN from
`process.env.{NEXT_PUBLIC_,}SENTRY_DSN` and no-ops if absent — so the
build always succeeds whether Sentry is configured or not.

import { log } from "@/lib/log";

/**
 * Boot-time environment validation.
 *
 * Two tiers:
 *
 *   - REQUIRED: the app cannot do its job at all without these. We log
 *     a loud error and (in production) throw to fail-fast — better to
 *     refuse the boot than to stand up a half-broken instance.
 *
 *   - OPTIONAL: features that have stub-mode fallbacks. We log a single
 *     warning at boot listing what's missing, so an operator looking at
 *     server logs can see exactly which providers will degrade. The UI
 *     also surfaces this via StubModeBanner per-feature.
 *
 * Called once from src/instrumentation.ts on server start.
 */

type EnvSpec = {
  name: string;
  /** Human-readable purpose for the log line. */
  purpose: string;
};

const REQUIRED: EnvSpec[] = [
  {
    name: "DATABASE_URL",
    purpose: "Postgres (Neon) — primary datastore",
  },
  {
    name: "AUTH_SECRET",
    purpose: "NextAuth session signing key",
  },
];

const OPTIONAL: EnvSpec[] = [
  {
    name: "ANTHROPIC_API_KEY",
    purpose: "Claude — section drafting, brief generation, vision OCR",
  },
  {
    name: "OPENAI_API_KEY",
    purpose: "OpenAI embeddings — semantic search, brain suggest",
  },
  {
    name: "RESEND_API_KEY",
    purpose: "Email — review requests, notifications",
  },
  {
    name: "BROWSERLESS_API_KEY",
    purpose: "PDF rendering — proposal export",
  },
  {
    name: "CLOUDCONVERT_API_KEY",
    purpose: "DOCX→PDF conversion — Word-template export",
  },
  {
    name: "R2_ACCOUNT_ID",
    purpose: "Cloudflare R2 — render storage (falls back to in-memory)",
  },
  {
    name: "SAMGOV_API_KEY",
    purpose: "SAM.gov — entity registration lookups + 8(a) registry import",
  },
  {
    name: "USASPENDING_API_KEY",
    purpose: "USAspending — competitor award history (often unauthenticated, but recommended)",
  },
];

let didCheck = false;

/**
 * Validate process.env against REQUIRED + OPTIONAL specs. Idempotent —
 * safe to call multiple times; the work runs once.
 *
 * In `production`, missing REQUIRED vars throw. In dev/test, we only
 * log so a developer with a half-set-up local can still iterate.
 */
export function validateEnvOrWarn(): void {
  if (didCheck) return;
  didCheck = true;

  const missingRequired: EnvSpec[] = [];
  for (const spec of REQUIRED) {
    const v = process.env[spec.name];
    if (!v || v.trim() === "") {
      missingRequired.push(spec);
    }
  }

  const missingOptional: EnvSpec[] = [];
  for (const spec of OPTIONAL) {
    const v = process.env[spec.name];
    if (!v || v.trim() === "") {
      missingOptional.push(spec);
    }
  }

  if (missingRequired.length > 0) {
    const detail = missingRequired
      .map((s) => `${s.name} (${s.purpose})`)
      .join(", ");
    if (process.env.NODE_ENV === "production") {
      log.error("[env-check]", "required environment variables are missing", {
        missing: missingRequired.map((s) => s.name),
      });
      throw new Error(`Missing required env vars: ${detail}`);
    }
    log.warn("[env-check]", "required environment variables are missing", {
      missing: missingRequired.map((s) => s.name),
    });
  }

  if (missingOptional.length > 0) {
    log.warn(
      "[env-check]",
      `${missingOptional.length} optional integration(s) unconfigured — feature(s) will run in stub mode`,
      {
        missing: missingOptional.map((s) => s.name),
      },
    );
  } else if (missingRequired.length === 0) {
    log.info("[env-check]", "all required + optional env vars present");
  }
}

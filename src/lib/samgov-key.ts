import "server-only";
import { samErrorMessage, type SamAudience, type SamFailure, type SamKeySource } from "@/lib/samgov-errors";

/**
 * BL-STAB-7a — the SAM.gov key a call uses, as a value that cannot leak
 * by accident: the key sits in a private field, and JSON, string and
 * console forms show only its last four characters. Only samgov.ts reads
 * it, to put it on a request to SAM.gov.
 *
 * Every SAM.gov call takes a credential. Work for a company resolves one
 * with `resolveSamCredential(organizationId)`; platform work (the gold
 * set) uses `platformSamCredential({ audience: "operator" })`. Today both
 * are FORGE's shared key (SAMGOV_API_KEY); BL-STAB-7b adds the company's
 * own key to the resolver.
 */
export class SamCredential {
  readonly #key: string;
  readonly source: SamKeySource;
  readonly audience: SamAudience;
  readonly organizationId: string | null;
  readonly last4: string;

  constructor(key: string, opts: { source: SamKeySource; audience: SamAudience; organizationId: string | null }) {
    this.#key = key;
    this.source = opts.source;
    this.audience = opts.audience;
    this.organizationId = opts.organizationId;
    this.last4 = key.slice(-4);
  }

  /** The key itself, for samgov.ts to put on a request to a SAM.gov host. */
  revealForSamRequest(): string {
    return this.#key;
  }

  toJSON() {
    return { source: this.source, last4: `••••${this.last4}` };
  }

  toString(): string {
    return `SamCredential(${this.source} ••••${this.last4})`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}

/** FORGE's shared key (SAMGOV_API_KEY), or null when it is not set. */
export function platformSamCredential(
  opts: { audience?: SamAudience; organizationId?: string | null } = {},
  env: Record<string, string | undefined> = process.env,
): SamCredential | null {
  const key = (env.SAMGOV_API_KEY ?? "").trim();
  if (!key) return null;
  return new SamCredential(key, { source: "platform", audience: opts.audience ?? "tenant", organizationId: opts.organizationId ?? null });
}

export type SamKeyResolution = { ok: true; cred: SamCredential } | { ok: false; failure: SamFailure };

/** The key a company's SAM.gov work uses. Until BL-STAB-7b, FORGE's shared key. */
export async function resolveSamCredential(organizationId: string): Promise<SamKeyResolution> {
  const cred = platformSamCredential({ organizationId });
  if (cred) return { ok: true, cred };
  return {
    ok: false,
    failure: { ok: false, cls: "missing_key", error: samErrorMessage({ cls: "missing_key", source: "platform", audience: "tenant" }) },
  };
}

/** The no-key failure for platform work (operator wording). */
export function missingPlatformKeyFailure(): SamFailure {
  return { ok: false, cls: "missing_key", error: samErrorMessage({ cls: "missing_key", source: "platform", audience: "operator" }) };
}

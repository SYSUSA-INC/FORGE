import "next-auth";
import "next-auth/jwt";
import type { Role } from "@/db/schema";
import type { MfaState } from "@/lib/session-policy";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      isSuperadmin: boolean;
      organizationId: string | null;
      role: Role | null;
      /** BL-STAB-8a-2 — the second step's state; nothing in the app opens until "ok". */
      mfa: MfaState;
      /** The pending id the pass marker is keyed by; null once ok. */
      pid: string | null;
    };
  }

  interface User {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    isSuperadmin?: boolean;
    organizationId?: string | null;
    role?: Role | null;
    /** BL-STAB-8a-2 — see src/lib/session-policy.ts. */
    iatMs?: number;
    lastActive?: number;
    mfa?: MfaState;
    amr?: string;
    pendingAt?: number;
    sv?: number;
    epoch?: number;
    chk?: number;
    pid?: string;
  }
}

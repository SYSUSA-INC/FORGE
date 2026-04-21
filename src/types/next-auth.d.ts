import "next-auth";
import "next-auth/jwt";
import type { Role } from "@/db/schema";

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
  }
}

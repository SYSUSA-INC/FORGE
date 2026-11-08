"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { createInboundAddress } from "@/lib/inbound-email";

/**
 * BL-SCOUT-INBOX — create the company's bid email address on FORGE's
 * inbound domain (once; an admin). Audited `inbound_address.create`.
 */
export async function createInboundAddressAction(): Promise<{ ok: true; address: string } | { ok: false; error: string }> {
  const { organizationId } = await requireCurrentOrg();
  const actor = await requireOrgAdmin(organizationId);
  const res = await createInboundAddress({ organizationId, actor: { userId: actor.id, email: actor.email } });
  if (!res.ok) return res;
  revalidatePath("/settings/integrations");
  revalidatePath("/pipeline/identify");
  return { ok: true, address: res.address.address };
}

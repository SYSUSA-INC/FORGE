"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { readInboundEmail } from "@/lib/inbound-bids";

/**
 * BL-SCOUT-INBOX — an org admin reads an email's bids from the Bid inbox:
 * one held because its sender wasn't verified, an account email, or one
 * that failed. Audited `inbound_email.read` (forced).
 */
export async function readInboundEmailAction(emailId: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { organizationId } = await requireCurrentOrg();
  const actor = await requireOrgAdmin(organizationId);
  try {
    const res = await readInboundEmail({ organizationId, emailId: String(emailId ?? ""), actor: { userId: actor.id, email: actor.email }, force: true });
    if (!res.ok) return { ok: false, error: res.error };
    revalidatePath("/pipeline/identify");
    return { ok: true, message: res.bids === 0 ? "No bids in this email." : `${res.bids} bid${res.bids === 1 ? "" : "s"} read; ${res.created} new on the All tab.` };
  } catch {
    return { ok: false, error: "The AI couldn't read this email just now. Try again in a minute." };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth-helpers";
import {
  disconnectEmailOauthAccount,
  listUserEmailAccounts,
  setDefaultEmailAccount,
} from "@/lib/email-oauth";

export type ConnectedAccount = Awaited<
  ReturnType<typeof listUserEmailAccounts>
>[number];

export async function listMyEmailAccountsAction(): Promise<ConnectedAccount[]> {
  const user = await requireAuth();
  return listUserEmailAccounts(user.id);
}

export async function disconnectEmailAccountAction(
  accountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!accountId) return { ok: false, error: "Missing account id." };
  const user = await requireAuth();
  try {
    await disconnectEmailOauthAccount(user.id, accountId);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Disconnect failed.",
    };
  }
  revalidatePath("/settings/email");
  return { ok: true };
}

export async function setDefaultEmailAccountAction(
  accountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!accountId) return { ok: false, error: "Missing account id." };
  const user = await requireAuth();
  try {
    await setDefaultEmailAccount(user.id, accountId);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Set default failed.",
    };
  }
  revalidatePath("/settings/email");
  return { ok: true };
}

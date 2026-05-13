import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { proposalTemplates } from "@/db/schema";

/**
 * Internal helper — look up an organization's default proposal
 * template. Callers MUST derive the organizationId from a trusted
 * server-side context (e.g. requireCurrentOrg). Lives in lib/ rather
 * than a "use server" file so Next.js doesn't expose it as a
 * client-callable server action, which would otherwise let a
 * malicious client pass an arbitrary organizationId and read another
 * tenant's default template.
 */
export async function getDefaultTemplate(organizationId: string) {
  const [row] = await db
    .select({
      id: proposalTemplates.id,
      sectionSeed: proposalTemplates.sectionSeed,
    })
    .from(proposalTemplates)
    .where(
      and(
        eq(proposalTemplates.organizationId, organizationId),
        eq(proposalTemplates.isDefault, true),
        isNull(proposalTemplates.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { alias } from "drizzle-orm/pg-core";
import {
  memberships,
  notifications,
  solicitationAssignments,
  solicitations,
  users,
  type SolicitationRole,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";

export const SOLICITATION_ROLE_LABELS: Record<SolicitationRole, string> = {
  capture_lead: "Capture lead",
  proposal_manager: "Proposal manager",
  technical_lead: "Technical lead",
  pricing_lead: "Pricing lead",
  compliance_reviewer: "Compliance reviewer",
  color_team_reviewer: "Color-team reviewer",
  subject_matter_expert: "Subject-matter expert",
  contributor: "Contributor",
  observer: "Observer",
};

export const SOLICITATION_ROLES: SolicitationRole[] = [
  "capture_lead",
  "proposal_manager",
  "technical_lead",
  "pricing_lead",
  "compliance_reviewer",
  "color_team_reviewer",
  "subject_matter_expert",
  "contributor",
  "observer",
];

export type AssignmentRow = {
  userId: string;
  userName: string | null;
  userEmail: string;
  role: SolicitationRole;
  notes: string;
  assignedAt: string;
  assignedByName: string | null;
};

export async function listSolicitationAssignmentsAction(
  solicitationId: string,
): Promise<AssignmentRow[]> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const assignedBy = alias(users, "assigned_by");
  const rows = await db
    .select({
      userId: solicitationAssignments.userId,
      userName: users.name,
      userEmail: users.email,
      role: solicitationAssignments.role,
      notes: solicitationAssignments.notes,
      assignedAt: solicitationAssignments.assignedAt,
      assignedByName: assignedBy.name,
    })
    .from(solicitationAssignments)
    .innerJoin(users, eq(users.id, solicitationAssignments.userId))
    .leftJoin(
      assignedBy,
      eq(assignedBy.id, solicitationAssignments.assignedByUserId),
    )
    .where(
      and(
        eq(solicitationAssignments.solicitationId, solicitationId),
        eq(solicitationAssignments.organizationId, organizationId),
      ),
    )
    .orderBy(asc(solicitationAssignments.role), asc(users.name));

  return rows.map((r) => ({
    userId: r.userId,
    userName: r.userName,
    userEmail: r.userEmail,
    role: r.role,
    notes: r.notes,
    assignedAt: r.assignedAt.toISOString(),
    assignedByName: r.assignedByName,
  }));
}

/**
 * Assign a teammate to a solicitation in a specific role. Idempotent
 * on (solicitation, user, role) — re-running just refreshes notes
 * and assignedAt.
 */
export async function assignSolicitationRoleAction(input: {
  solicitationId: string;
  userId: string;
  role: SolicitationRole;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!input.userId || !input.role) {
    return { ok: false, error: "Pick a teammate and a role." };
  }

  // Confirm the solicitation belongs to the org.
  const [sol] = await db
    .select({ id: solicitations.id, title: solicitations.title })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, input.solicitationId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!sol) return { ok: false, error: "Solicitation not found." };

  // Confirm the assignee is an active member of the same org.
  const [m] = await db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, input.userId),
        eq(memberships.status, "active"),
      ),
    )
    .limit(1);
  if (!m) {
    return {
      ok: false,
      error:
        "User is not an active member of your org. Invite them first under Settings.",
    };
  }

  const notes = (input.notes ?? "").trim().slice(0, 1000);

  // Try to insert; if it conflicts on the composite PK, fall back to update.
  // Sequential per the Neon-pgbouncer rule (no db.transaction).
  try {
    await db.insert(solicitationAssignments).values({
      organizationId,
      solicitationId: input.solicitationId,
      userId: input.userId,
      role: input.role,
      notes,
      assignedByUserId: actor.id,
    });
  } catch (err) {
    // 23505 = unique_violation — composite PK collision. Update instead.
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      await db
        .update(solicitationAssignments)
        .set({
          notes,
          assignedByUserId: actor.id,
          assignedAt: new Date(),
        })
        .where(
          and(
            eq(solicitationAssignments.solicitationId, input.solicitationId),
            eq(solicitationAssignments.userId, input.userId),
            eq(solicitationAssignments.role, input.role),
          ),
        );
    } else {
      console.error("[assignSolicitationRole]", err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Assign failed.",
      };
    }
  }

  // Notify the assignee — but skip if they assigned themselves.
  if (input.userId !== actor.id) {
    await db.insert(notifications).values({
      organizationId,
      recipientUserId: input.userId,
      actorUserId: actor.id,
      kind: "solicitation_role_assigned",
      subject: `Assigned as ${SOLICITATION_ROLE_LABELS[input.role]} on ${sol.title || "a solicitation"}`,
      body:
        `${actor.name ?? actor.email ?? "A teammate"} added you as ${SOLICITATION_ROLE_LABELS[input.role]}.` +
        (notes ? `\n\nNotes: ${notes}` : ""),
      linkPath: `/solicitations/${sol.id}`,
    });
  }

  revalidatePath(`/solicitations/${input.solicitationId}`);
  revalidatePath("/solicitations");
  return { ok: true };
}

export async function unassignSolicitationRoleAction(input: {
  solicitationId: string;
  userId: string;
  role: SolicitationRole;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  await db
    .delete(solicitationAssignments)
    .where(
      and(
        eq(solicitationAssignments.organizationId, organizationId),
        eq(solicitationAssignments.solicitationId, input.solicitationId),
        eq(solicitationAssignments.userId, input.userId),
        eq(solicitationAssignments.role, input.role),
      ),
    );

  revalidatePath(`/solicitations/${input.solicitationId}`);
  return { ok: true };
}

/**
 * Members of the current org — used by the assignment picker. Re-uses
 * the same shape as the opportunity-review reviewer picker.
 */
export async function listAssignableMembersAction(): Promise<
  { id: string; name: string; email: string }[]
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    )
    .orderBy(asc(users.name), asc(users.email));
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? "",
    email: r.email,
  }));
}

/**
 * Convenience read for any caller (e.g., a future "what's assigned to
 * me?" view). Returns active assignments for one user across all
 * solicitations in the current org.
 */
export async function listMyAssignmentsAction(): Promise<
  {
    solicitationId: string;
    solicitationTitle: string;
    role: SolicitationRole;
    assignedAt: string;
  }[]
> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      solicitationId: solicitationAssignments.solicitationId,
      solicitationTitle: solicitations.title,
      role: solicitationAssignments.role,
      assignedAt: solicitationAssignments.assignedAt,
    })
    .from(solicitationAssignments)
    .innerJoin(
      solicitations,
      eq(solicitations.id, solicitationAssignments.solicitationId),
    )
    .where(
      and(
        eq(solicitationAssignments.organizationId, organizationId),
        eq(solicitationAssignments.userId, actor.id),
      ),
    )
    .orderBy(desc(solicitationAssignments.assignedAt));

  return rows.map((r) => ({
    solicitationId: r.solicitationId,
    solicitationTitle: r.solicitationTitle,
    role: r.role,
    assignedAt: r.assignedAt.toISOString(),
  }));
}

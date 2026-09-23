/**
 * BL-QC-links — which navigation groups a signed-in user should see.
 *
 * Pure so it can be unit-tested and shared by the desktop rail and the
 * mobile drawer. Three gates:
 *
 *   superadmin     — Platform Administration; platform owners only.
 *   admin          — Operations Management and a few children; org
 *                    admins and platform owners.
 *   needsWorkspace — everything that reads tenant data. A signed-in user
 *                    whose session carries no active workspace (no
 *                    membership, membership disabled, or the workspace
 *                    itself disabled) would be redirected off every one
 *                    of these pages, so the nav does not offer them.
 *                    Before this gate, that user saw two dozen links that
 *                    all landed on the same "no workspace" page and read
 *                    as a platform full of broken links.
 */

export type NavVisibility = {
  isOrgAdmin: boolean;
  isSuperadmin: boolean;
  hasWorkspace: boolean;
};

export type NavItemLike = {
  href: string;
  /** Visible only to org admins (or superadmins). */
  admin?: boolean;
};

export type NavGroupLike = {
  id: string;
  /** Group visible only to org admins (or superadmins). */
  admin?: boolean;
  /** Group visible only to superadmins. */
  superadmin?: boolean;
  /** Every page in the group calls the org gate; hide it without a workspace. */
  needsWorkspace?: boolean;
  children?: NavItemLike[];
};

export function visibleNavGroups<G extends NavGroupLike>(groups: readonly G[], v: NavVisibility): G[] {
  return groups.filter((g) => {
    if (g.superadmin && !v.isSuperadmin) return false;
    if (g.admin && !v.isOrgAdmin && !v.isSuperadmin) return false;
    if (g.needsWorkspace && !v.hasWorkspace) return false;
    return true;
  });
}

export function visibleNavChildren<I extends NavItemLike>(
  children: readonly I[] | undefined,
  v: NavVisibility,
): I[] {
  if (!children) return [];
  return children.filter((c) => !(c.admin && !v.isOrgAdmin && !v.isSuperadmin));
}

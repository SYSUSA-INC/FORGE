import { randomBytes } from "crypto";

function randomSlug(prefix = "ws"): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export function defaultOrgSlug(personName?: string | null): string {
  const base = personName ? slugFromName(personName) : "";
  const suffix = randomBytes(3).toString("hex");
  if (!base) return randomSlug("ws");
  return `${base}-${suffix}`.slice(0, 64);
}

export function defaultOrgName(personName?: string | null): string {
  const trimmed = (personName ?? "").trim();
  if (!trimmed) return "My Workspace";
  return `${trimmed}'s Workspace`;
}

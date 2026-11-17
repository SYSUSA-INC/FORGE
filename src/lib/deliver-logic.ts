/**
 * BL-NAV-LIFECYCLE 6a (FORGE II S-1, S-2) — Deliver's rules: when a
 * colour team counts as signed off, what blocks a submission, who may
 * submit and who may override. No database access; unit tested in
 * tests/ai/deliver-logic.test.ts. Design:
 * docs/design/BL-NAV-LIFECYCLE_PHASE6_DELIVER.md §2.1.
 */

export const SIGNOFF_COLORS = ["pink", "red", "green", "gold", "white_gloves"] as const;
export type SignoffColor = (typeof SIGNOFF_COLORS)[number];

export const SIGNOFF_COLOR_LABELS: Record<SignoffColor, string> = {
  pink: "Pink",
  red: "Red",
  green: "Green",
  gold: "Gold",
  white_gloves: "White Gloves",
};

type Verdict = "pass" | "conditional" | "fail";

/** One review round with its assigned reviewers' own verdicts. */
export type SignoffRound = {
  id: string;
  color: string;
  status: "scheduled" | "in_progress" | "complete" | "cancelled";
  verdict: Verdict | null;
  createdAt: string | Date;
  reviewers: { verdict: Verdict | null; submitted: boolean }[];
};

export type ColourSignoff = {
  color: SignoffColor;
  /** signed_off: the newest round passed and every reviewer signed; open: a round exists but is not there; not_run: no round. */
  state: "signed_off" | "open" | "not_run";
  /** Why it is not signed off; empty when it is. */
  reason: string;
  roundId: string | null;
  reviewersSigned: number;
  reviewersTotal: number;
};

export type SignoffGate = {
  colors: ColourSignoff[];
  signedOff: number;
  submissionPack: boolean;
  exportClean: boolean;
  /** One sentence per thing that blocks a submission; empty when clear. */
  blockers: string[];
  clear: boolean;
};

/** The stored copy of the gate on a submission (`proposal_submission.signoff`). */
export type SignoffSnapshot = Pick<SignoffGate, "colors" | "submissionPack" | "exportClean" | "clear">;

const time = (d: string | Date) => new Date(d).getTime();

/**
 * A colour is signed off when its newest round is complete with verdict
 * pass and every assigned reviewer has submitted a verdict that is not
 * fail. A conditional round is not signed off: it is re-closed as pass
 * once its conditions are met. A cancelled round is not a round.
 */
export function colourSignoff(color: SignoffColor, rounds: SignoffRound[]): ColourSignoff {
  const label = SIGNOFF_COLOR_LABELS[color];
  const newest = rounds.filter((r) => r.color === color && r.status !== "cancelled").sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];
  if (!newest) return { color, state: "not_run", reason: `${label} has not been run.`, roundId: null, reviewersSigned: 0, reviewersTotal: 0 };
  const total = newest.reviewers.length;
  const signed = newest.reviewers.filter((r) => r.submitted && r.verdict !== null && r.verdict !== "fail").length;
  const failed = newest.reviewers.filter((r) => r.submitted && r.verdict === "fail").length;
  const base = { color, roundId: newest.id, reviewersSigned: signed, reviewersTotal: total };
  const open = (reason: string): ColourSignoff => ({ ...base, state: "open", reason });
  if (newest.status !== "complete") return open(`${label} is not closed.`);
  if (newest.verdict === "fail") return open(`${label} closed with a fail.`);
  if (newest.verdict === "conditional") return open(`${label} passed with conditions: close them and re-close the round as a pass.`);
  if (newest.verdict !== "pass") return open(`${label} closed with no verdict.`);
  if (failed > 0) return open(`${label}: ${failed} reviewer${failed === 1 ? "" : "s"} gave a fail.`);
  if (signed < total) return open(`${label}: ${total - signed} of ${total} reviewers have not signed off.`);
  return { ...base, state: "signed_off", reason: "" };
}

/** The whole gate: five colours, the White Gloves submission-pack line and the export gate. */
export function signoffGate(input: { rounds: SignoffRound[]; submissionPackTicked: boolean; exportBlocked: boolean }): SignoffGate {
  const colors = SIGNOFF_COLORS.map((c) => colourSignoff(c, input.rounds));
  const blockers = colors.filter((c) => c.state !== "signed_off").map((c) => c.reason);
  if (!input.submissionPackTicked) blockers.push("White Gloves: “File names, formats and signatures ready for submission” is not ticked.");
  if (input.exportBlocked) blockers.push("The export gate is not clean: open compliance rows or [NEEDS CITATION] markers remain.");
  return {
    colors,
    signedOff: colors.filter((c) => c.state === "signed_off").length,
    submissionPack: input.submissionPackTicked,
    exportClean: !input.exportBlocked,
    blockers,
    clear: blockers.length === 0,
  };
}

export function snapshotOf(gate: SignoffGate): SignoffSnapshot {
  return { colors: gate.colors, submissionPack: gate.submissionPack, exportClean: gate.exportClean, clear: gate.clear };
}

type Who = { id: string; role: string | null; isSuperadmin: boolean };
type Leads = { proposalManagerUserId: string | null; captureManagerUserId: string | null };

/** Org admins, the proposal manager and the capture manager submit (decision 7). */
export function canSubmit(user: Who, leads: Leads): boolean {
  return user.isSuperadmin || user.role === "admin" || user.id === leads.proposalManagerUserId || user.id === leads.captureManagerUserId;
}

/** An org admin or the proposal manager may override the gate with a reason (decision 1), as with the export gate. */
export function canOverride(user: Who, leads: Leads): boolean {
  return user.isSuperadmin || user.role === "admin" || user.id === leads.proposalManagerUserId;
}

export const OVERRIDE_REASON_MIN = 10;

/** The ways a lead records a submission made outside FORGE (option 1). `portal_email` is FORGE's own send (6b). */
export const RECORD_METHODS = ["own_email", "government_portal", "other"] as const;
export type RecordMethod = (typeof RECORD_METHODS)[number];

export const SUBMISSION_METHOD_LABELS: Record<"portal_email" | RecordMethod, string> = {
  portal_email: "Sent from FORGE",
  own_email: "Sent from our own email",
  government_portal: "Uploaded to a government portal",
  other: "Another way",
};

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** Splits "a@x.gov, b@y.mil" into addresses; every entry must look like one. At most 20. */
export function parseRecipients(text: string): { ok: true; list: string[] } | { ok: false; error: string } {
  const parts = String(text ?? "")
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const bad = parts.find((p) => !EMAIL.test(p));
  if (bad) return { ok: false, error: `“${bad.slice(0, 80)}” is not an email address.` };
  const list = [...new Set(parts.map((p) => p.toLowerCase()))];
  if (list.length > 20) return { ok: false, error: "At most 20 recipients." };
  return { ok: true, list };
}

/** When the submission was made: a real time, not more than a day ahead of now. */
export function parseSentAt(value: string, now: Date): Date | null {
  const d = new Date(String(value ?? ""));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return null;
  return d;
}

/** A safe file name for the kept copy: the proposal's title, reduced, with the render's extension. */
export function submissionFileName(title: string, contentType: string): string {
  const stem =
    String(title ?? "")
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "proposal";
  return `${stem}.${contentType === "docx" ? "docx" : "pdf"}`;
}

/** The one-line state of the sign-off, for lists: "4 of 5 signed off". */
export function signoffLine(gate: SignoffGate): string {
  return `${gate.signedOff} of ${SIGNOFF_COLORS.length} colour teams signed off`;
}

// ── 6b: send from the portal (design §2.4) ─────────────────────────────

/** Many agency gateways refuse large mail: warn above 20 MB, refuse above 35 MB (decision 9). */
export const SEND_WARN_BYTES = 20 * 1024 * 1024;
export const SEND_MAX_BYTES = 35 * 1024 * 1024;
export const SEND_MAX_FILES = 10;

export function sendSize(totalBytes: number): "ok" | "warn" | "refuse" {
  return totalBytes > SEND_MAX_BYTES ? "refuse" : totalBytes > SEND_WARN_BYTES ? "warn" : "ok";
}

const LOCAL_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** The opportunity's local part: "sub-" and ten characters drawn from the given random bytes. */
export function deliveryLocalPart(random: Uint8Array): string {
  if (random.length < 10) throw new Error("deliveryLocalPart needs ten random bytes.");
  let out = "";
  // 252 is the largest multiple of 36 a byte can hold below 256: bytes above it would skew the draw.
  for (let i = 0; i < random.length && out.length < 10; i++) if (random[i]! < 252) out += LOCAL_ALPHABET[random[i]! % 36];
  if (out.length < 10) throw new Error("deliveryLocalPart ran out of random bytes.");
  return `sub-${out}`;
}

/** The From header: `"{Company name} via FORGE" <sub-…@domain>` (decision 4). */
export function sendFromHeader(companyName: string, address: string): string {
  const name = String(companyName ?? "").replace(/["<>\\\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return `"${name ? `${name} via FORGE` : "FORGE"}" <${address}>`;
}

/** The subject the form starts with: the solicitation number, the proposal's title and the company's name. */
export function defaultSendSubject(input: { solicitationNumber: string; title: string; companyName: string }): string {
  const number = input.solicitationNumber.trim();
  return [number ? `${number}:` : "", `Proposal submission, ${input.title.trim()}`, `(${input.companyName.trim()})`].filter(Boolean).join(" ").slice(0, 200);
}

/**
 * The name an attachment leaves under: what the lead typed, reduced to
 * letters, digits, spaces and . _ - ( ), with the render's own extension.
 * Empty falls back to the proposal's title.
 */
export function attachmentFileName(typed: string, fallbackTitle: string, contentType: string): string {
  const ext = contentType === "docx" ? "docx" : "pdf";
  const stem = safeStem(typed, /\.(pdf|docx)$/i);
  return stem ? `${stem}.${ext}` : submissionFileName(fallbackTitle, contentType);
}

function safeStem(text: string, extension: RegExp): string {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(extension, "")
    .replace(/[^A-Za-z0-9 ._()-]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[-. ]+|[-. ]+$/g, "")
    .slice(0, 100);
}

const UPLOAD_EXT = /\.([A-Za-z0-9]{1,5})$/;

/** 6b-2 — the name an uploaded file is sent or kept under: the typed name (or its own) made safe, with the upload's own extension. */
export function uploadedFileName(typed: string, original: string): string {
  const ext = (UPLOAD_EXT.exec(String(original ?? "").trim())?.[1] ?? "bin").toLowerCase();
  return `${safeStem(String(typed ?? "").trim() || original, UPLOAD_EXT) || "file"}.${ext}`;
}

export const RECEIPTS_MAX = 5;

/** The plain message as the HTML part: escaped, line breaks kept. */
export function plainBodyHtml(text: string): string {
  const escaped = String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;">${escaped}</div>`;
}

/** How a submission's status reads in the list. */
export const SUBMISSION_STATUS_LABELS: Record<string, string> = { sending: "Sending…", sent: "Sent", failed: "Not sent", recorded: "Recorded" };

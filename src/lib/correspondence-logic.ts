/**
 * BL-NAV-LIFECYCLE 6c (FORGE II S-4) — replies to a submission: the
 * pure rules. Which address is an opportunity's, which submission a
 * reply answers, what a reply is when its headers already say (a
 * delivery failure, an automatic reply), its two-line summary without
 * AI, and when it carries the "check the sender" mark. No database
 * access; the store is src/lib/correspondence.ts. Design:
 * docs/design/BL-NAV-LIFECYCLE_PHASE6_DELIVER.md §2.5.
 */

export const REPLY_TYPES = [
  "receipt",
  "question",
  "amendment",
  "evaluation_notice",
  "award",
  "unsuccessful",
  "automatic_reply",
  "delivery_failure",
  "other",
] as const;

export type ReplyType = (typeof REPLY_TYPES)[number];

export const REPLY_TYPE_LABELS: Record<ReplyType, string> = {
  receipt: "Receipt acknowledged",
  question: "Question or clarification",
  amendment: "Amendment",
  evaluation_notice: "Evaluation notice",
  award: "Award",
  unsuccessful: "Unsuccessful",
  automatic_reply: "Automatic reply",
  delivery_failure: "Delivery failure",
  other: "Reply",
};

/** The label of a stored type; a reply not yet read, or a value FORGE no longer knows, is a plain "Reply". */
export function replyTypeLabel(type: string): string {
  return (REPLY_TYPE_LABELS as Record<string, string>)[type] ?? REPLY_TYPE_LABELS.other;
}

/**
 * Whether a recipient's local part is an opportunity's (`sub-` and ten
 * characters, as `deliveryLocalPart` makes them) and not a company's
 * bid address.
 */
export function isReplyLocalPart(local: string | null): local is string {
  return !!local && /^sub-[a-z0-9]{10}$/.test(local);
}

export type ReplyCandidate = { id: string; status: string; to: string[]; cc: string[] };

const has = (list: string[], address: string) => list.some((x) => x.trim().toLowerCase() === address);

/** Whether the sender is someone the submission was sent to (To or Cc). */
export function senderIsRecipient(from: string, submission: { to: string[]; cc: string[] } | null): boolean {
  const a = from.trim().toLowerCase();
  return !!submission && a !== "" && (has(submission.to, a) || has(submission.cc, a));
}

/**
 * The submission a reply answers, from the opportunity's submissions
 * newest first: the newest sent one that went to the sender, else the
 * newest sent one, else the newest of any status. Null when the
 * opportunity has none.
 */
export function pickSubmission(newestFirst: ReplyCandidate[], from: string): string | null {
  const sent = newestFirst.filter((s) => s.status === "sent");
  return (sent.find((s) => senderIsRecipient(from, s)) ?? sent[0] ?? newestFirst[0])?.id ?? null;
}

type Header = { name: string; value: string };

const FAILURE_SUBJECT = /^\s*(undeliverable|undelivered mail|delivery status notification|mail delivery (failed|failure|subsystem)|returned mail|delivery failure|failure notice)/i;
const AUTO_SUBJECT = /^\s*(automatic reply|auto[- ]?reply|autoreply|out of (the )?office)/i;

/**
 * What the headers alone say a message is, without reading it: a
 * delivery failure (a delivery-status report, a mailer daemon), an
 * automatic reply (RFC 3834 `Auto-Submitted`, the out-of-office
 * headers), or null when a person, or a system that does not say so,
 * wrote it. A failure is looked for first: bounces are auto-submitted
 * too.
 */
export function headerReplyType(i: { headers: Header[]; from: string; subject: string }): "delivery_failure" | "automatic_reply" | null {
  const h = (name: string) =>
    i.headers
      .filter((x) => x.name.trim().toLowerCase() === name)
      .map((x) => x.value.trim().toLowerCase())
      .join(" ");
  if (
    h("content-type").includes("report-type=delivery-status") ||
    h("x-failed-recipients") !== "" ||
    /^(mailer-daemon|postmaster)@/i.test(i.from.trim()) ||
    FAILURE_SUBJECT.test(i.subject)
  ) {
    return "delivery_failure";
  }
  const auto = h("auto-submitted");
  if (
    (auto !== "" && !auto.startsWith("no")) ||
    h("x-autoreply") !== "" ||
    h("x-autorespond") !== "" ||
    h("x-auto-response-suppress") !== "" ||
    /auto[_-]?reply/.test(h("precedence")) ||
    AUTO_SUBJECT.test(i.subject)
  ) {
    return "automatic_reply";
  }
  return null;
}

/**
 * "Check the sender": the sender's domain did not vouch for the message
 * (no SPF or DKIM pass), or the sender is not someone the submission
 * went to. A delivery failure comes from a mail system, never from a
 * recipient, so only the first test applies to it.
 */
export function needsSenderCheck(i: { authenticated: boolean; knownSender: boolean; type: ReplyType }): boolean {
  return !i.authenticated || (!i.knownSender && i.type !== "delivery_failure");
}

export const REPLY_SUMMARY_MAX = 280;

const QUOTE_START = /^(on .+ wrote:|-{2,}\s*original message\s*-{2,}|from:\s.+|_{8,})$/i;

/** The reply's own first two lines, before the text it quotes: the summary when no model reads it. */
export function replySummary(text: string): string {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (QUOTE_START.test(line)) break;
    if (line === "" || line.startsWith(">")) continue;
    lines.push(line);
    if (lines.length === 2) break;
  }
  const out = lines.join(" ");
  return out.length > REPLY_SUMMARY_MAX ? `${out.slice(0, REPLY_SUMMARY_MAX - 1).trimEnd()}…` : out;
}

/** Above this the opened text is cut, with a note: a reply is read on screen, not downloaded. */
export const REPLY_TEXT_MAX = 100_000;

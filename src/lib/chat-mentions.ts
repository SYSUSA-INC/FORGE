/**
 * BL-FB-CHAT-MULTI — the section thread as a team thread, pure parts:
 * the @mention picker's parsing and insertion, the display names the
 * thread and the model see, and the link a mention notification opens.
 * Mentions are stored as `@[user-id]` tokens (src/lib/mentions.ts) so a
 * renamed teammate still resolves.
 */

export const CHAT_NOTE_MAX_CHARS = 4000;
export const MENTION_PICKER_MAX = 6;

export type MentionMemberLike = { id: string; name: string | null; email: string };

/** Where a mention notification lands: the editor on that section with the chat open. */
export function sectionChatLink(proposalId: string, sectionId: string): string {
  return `/proposals/${proposalId}/sections?section=${encodeURIComponent(sectionId)}&tab=chat`;
}

export function mentionSubject(authorName: string, sectionTitle: string): string {
  return `${authorName || "A teammate"} mentioned you in the chat on "${sectionTitle || "a section"}"`;
}

export function memberLabel(m: { name: string | null; email: string }): string {
  return m.name?.trim() || m.email.split("@")[0] || "teammate";
}

/** `@[id]` → display name, for the thread and for the model. */
export function mentionResolver(members: readonly MentionMemberLike[]): Map<string, string> {
  return new Map(members.map((m) => [m.id, memberLabel(m)] as const));
}

export type MentionQuery = { start: number; query: string };

/** The "@par" the caret sits in, if any; a finished "@[id]" token or an email address is not one. */
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, Math.max(0, caret));
  const m = /(?:^|[\s(])@([^\s@[\]]{0,40})$/.exec(before);
  if (!m) return null;
  return { start: before.length - m[1]!.length - 1, query: m[1]! };
}

/** Members matching the query by name or email, the author first excluded. */
export function filterMembers<T extends MentionMemberLike>(members: readonly T[], query: string, excludeId?: string): T[] {
  const q = query.trim().toLowerCase();
  return members
    .filter((m) => m.id !== excludeId)
    .filter((m) => !q || `${m.name ?? ""} ${m.email}`.toLowerCase().includes(q))
    .slice(0, MENTION_PICKER_MAX);
}

/** Replace the "@par" at the caret with the member's token and a space. */
export function insertMention(text: string, caret: number, q: MentionQuery, userId: string): { value: string; caret: number } {
  const token = `@[${userId}] `;
  const value = text.slice(0, q.start) + token + text.slice(Math.max(caret, q.start));
  return { value, caret: q.start + token.length };
}

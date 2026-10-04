/**
 * BL-FB-CHAT-MULTI — the team thread's pure parts: the @mention picker's
 * parsing and insertion, member filtering and labels, the link and
 * subject a mention notification carries.
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_NOTES_TO_MODEL_MAX,
  MENTION_PICKER_MAX,
  REPLY_PREVIEW_CHARS,
  describeUnread,
  filterMembers,
  insertMention,
  memberLabel,
  mentionQuery,
  mentionResolver,
  mentionSubject,
  notesForModel,
  replyPreview,
  sectionChatLink,
  unreadSplit,
} from "@/lib/chat-mentions";

const MEMBERS = [
  { id: "u-ana", name: "Ana Rivera", email: "ana@acme.gov" },
  { id: "u-bo", name: null, email: "bo.chen@acme.gov" },
  { id: "u-cy", name: "Cy Park", email: "cy@acme.gov" },
];

describe("chat mentions", () => {
  it("finds the @query at the caret and nowhere else", () => {
    expect(mentionQuery("ask @an", 7)).toEqual({ start: 4, query: "an" });
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQuery("see (@bo) later", 8)).toEqual({ start: 5, query: "bo" });
    // Caret before the @, after a finished token, inside an email, or with no @: nothing.
    expect(mentionQuery("ask @an", 3)).toBeNull();
    expect(mentionQuery("ask @[u-ana] now", 12)).toBeNull();
    expect(mentionQuery("mail ana@acme.gov", 17)).toBeNull();
    expect(mentionQuery("plain text", 10)).toBeNull();
  });

  it("inserts the stable token in place of the query", () => {
    const q = mentionQuery("ask @an about this", 7)!;
    expect(insertMention("ask @an about this", 7, q, "u-ana")).toEqual({ value: "ask @[u-ana]  about this", caret: 13 });
    const end = mentionQuery("hi @", 4)!;
    expect(insertMention("hi @", 4, end, "u-bo")).toEqual({ value: "hi @[u-bo] ", caret: 11 });
  });

  it("filters members by name or email, excludes the author, and labels them", () => {
    expect(filterMembers(MEMBERS, "an").map((m) => m.id)).toEqual(["u-ana"]);
    expect(filterMembers(MEMBERS, "chen").map((m) => m.id)).toEqual(["u-bo"]);
    expect(filterMembers(MEMBERS, "", "u-cy").map((m) => m.id)).toEqual(["u-ana", "u-bo"]);
    expect(filterMembers(MEMBERS, "zzz")).toEqual([]);
    expect(filterMembers(Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, name: `User ${i}`, email: `u${i}@x.gov` })), "user")).toHaveLength(MENTION_PICKER_MAX);
    expect(memberLabel(MEMBERS[0]!)).toBe("Ana Rivera");
    expect(memberLabel(MEMBERS[1]!)).toBe("bo.chen");
    expect(mentionResolver(MEMBERS).get("u-cy")).toBe("Cy Park");
  });

  it("links a mention to the section's chat and names the author and section", () => {
    expect(sectionChatLink("p1", "s 1")).toBe("/proposals/p1/sections?section=s%201&tab=chat");
    expect(mentionSubject("Ana Rivera", "Technical Approach")).toBe('Ana Rivera mentioned you in the chat on "Technical Approach"');
    expect(mentionSubject("", "")).toBe('A teammate mentioned you in the chat on "a section"');
  });

  it("Slice 2: links to the message, splits the thread at the last read, quotes replies, hands notes to the model", () => {
    expect(sectionChatLink("p1", "s1", "m 1")).toBe("/proposals/p1/sections?section=s1&tab=chat&message=m%201");
    const thread = [
      { createdAt: "2026-10-04T10:00:00Z", isMine: true },
      { createdAt: "2026-10-04T10:05:00Z", isMine: false },
      { createdAt: "2026-10-04T10:10:00Z", isMine: false },
      { createdAt: "2026-10-04T10:15:00Z", isMine: true },
      { createdAt: "2026-10-04T10:20:00Z", isMine: false },
    ];
    expect(unreadSplit(thread, null)).toEqual({ index: 1, count: 3 });
    expect(unreadSplit(thread, "2026-10-04T10:05:00Z")).toEqual({ index: 2, count: 2 });
    expect(unreadSplit(thread, "2026-10-04T10:30:00Z")).toEqual({ index: -1, count: 0 });
    expect(unreadSplit([], null)).toEqual({ index: -1, count: 0 });
    expect(describeUnread(0)).toBe("");
    expect(describeUnread(3)).toBe("3 new since you looked");

    expect(replyPreview("  Own the\n\n transition   paragraph. ")).toBe("Own the transition paragraph.");
    const long = replyPreview("x".repeat(200));
    expect(long).toHaveLength(REPLY_PREVIEW_CHARS);
    expect(long.endsWith("…")).toBe(true);

    const block = notesForModel([
      { author: "Ana", content: "Lead with the outcome." },
      { author: "", content: "  " },
      { author: "Bo", content: "Cite the\nPWS paragraph." },
    ]);
    const lines = block.split("\n");
    expect(lines[0]).toMatch(/^Notes the team left on this section/);
    expect(lines.slice(1)).toEqual(["- Ana: Lead with the outcome.", "- Bo: Cite the PWS paragraph."]);
    expect(notesForModel([])).toBe("");
    expect(notesForModel(Array.from({ length: 12 }, (_, i) => ({ author: `U${i}`, content: `n${i}` }))).split("\n")).toHaveLength(1 + CHAT_NOTES_TO_MODEL_MAX);
  });
});

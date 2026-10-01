/**
 * BL-FB-CHAT-UPLOAD — documents in the section chat, pure parts.
 */
import { describe, expect, it } from "vitest";
import {
  ATTACHMENTS_INSTRUCTION,
  CHAT_ATTACHMENT_LIMITS,
  describeChars,
  excerpt,
  isChatAttachmentFormat,
  renderAttachmentsBlock,
  splitBudget,
} from "@/lib/chat-attachments-logic";

describe("chat attachment logic", () => {
  it("accepts document formats and refuses images", () => {
    expect(isChatAttachmentFormat("pdf")).toBe(true);
    expect(isChatAttachmentFormat("docx")).toBe(true);
    expect(isChatAttachmentFormat("text")).toBe(true);
    expect(isChatAttachmentFormat("image")).toBe(false);
    expect(isChatAttachmentFormat(null)).toBe(false);
  });

  it("splits the prompt budget and excerpts with an omission note", () => {
    expect(splitBudget(4, 16_000)).toBe(4_000);
    expect(splitBudget(0, 16_000)).toBe(16_000);
    expect(excerpt("short text\r\n", 100)).toBe("short text");
    const long = "word ".repeat(100).trim();
    const cut = excerpt(long, 50);
    expect(cut.startsWith("word word")).toBe(true);
    expect(cut).toMatch(/\[… \d+ more characters omitted\]$/);
    expect(cut.length).toBeLessThan(long.length);
  });

  it("renders the reference block within budget, or nothing when nothing is attached", () => {
    expect(renderAttachmentsBlock([])).toBe("");
    expect(renderAttachmentsBlock([{ fileName: "empty.txt", text: "   " }])).toBe("");
    const block = renderAttachmentsBlock(
      [
        { fileName: "sample-sow.pdf", text: "Scope ".repeat(2_000) },
        { fileName: "brief.docx", text: "Our brief." },
      ],
      1_000,
    );
    expect(block.startsWith(ATTACHMENTS_INSTRUCTION)).toBe(true);
    expect(block).toContain("### sample-sow.pdf (12,000 chars)");
    expect(block).toContain("### brief.docx (10 chars)");
    expect(block).toContain("more characters omitted");
    // Each document gets half the budget plus its header and note.
    expect(block.length).toBeLessThan(1_000 + ATTACHMENTS_INSTRUCTION.length + 200);
    expect(CHAT_ATTACHMENT_LIMITS.maxPerSection).toBe(5);
  });

  it("describes sizes for the chip", () => {
    expect(describeChars(640)).toBe("640 chars");
    expect(describeChars(1_234)).toBe("1.2k chars");
    expect(describeChars(48_900)).toBe("49k chars");
  });
});

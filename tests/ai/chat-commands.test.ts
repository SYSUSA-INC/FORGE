/**
 * BL-FB-CHAT-SLASH — slash commands in the section chat, pure parts.
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_COMMANDS,
  SHRINK_USAGE,
  describeSlashCommand,
  expandSlashCommand,
  messageForModel,
  parseShrinkTarget,
  parseSlashCommand,
  suggestCommands,
} from "@/lib/chat-commands";

describe("slash commands", () => {
  it("parses a command token and leaves prose alone", () => {
    expect(parseSlashCommand("/shrink-by 30%")).toEqual({ name: "shrink-by", args: "30%", raw: "/shrink-by 30%" });
    expect(parseSlashCommand("  /VOC  ")).toEqual({ name: "voc", args: "", raw: "/VOC" });
    expect(parseSlashCommand("/win-theme Zero trust\nby default")).toMatchObject({ name: "win-theme", args: "Zero trust\nby default" });
    expect(parseSlashCommand("/ is a slash")).toBeNull();
    expect(parseSlashCommand("/3 pages")).toBeNull();
    expect(parseSlashCommand("/api/ai/chat is the route")).toBeNull();
    expect(parseSlashCommand("tighten this")).toBeNull();
  });

  it("suggests commands by prefix", () => {
    expect(suggestCommands("").map((c) => c.name)).toEqual(CHAT_COMMANDS.map((c) => c.name));
    expect(suggestCommands("/sh").map((c) => c.name)).toEqual(["shrink-by"]);
    expect(suggestCommands("CHECK").map((c) => c.name)).toEqual(["check-compliance"]);
    expect(suggestCommands("zzz")).toEqual([]);
  });

  it("reads shrink targets", () => {
    expect(parseShrinkTarget("30%")).toEqual({ kind: "percent", value: 30 });
    expect(parseShrinkTarget("25 percent")).toEqual({ kind: "percent", value: 25 });
    expect(parseShrinkTarget("200 words")).toEqual({ kind: "words", value: 200 });
    expect(parseShrinkTarget("1 page")).toEqual({ kind: "pages", value: 1 });
    expect(parseShrinkTarget("1.5 pages")).toEqual({ kind: "pages", value: 1.5 });
    expect(parseShrinkTarget("40")).toEqual({ kind: "percent", value: 40 });
    expect(parseShrinkTarget("400")).toEqual({ kind: "words", value: 400 });
    expect(parseShrinkTarget("")).toBeNull();
    expect(parseShrinkTarget("100%")).toBeNull();
    expect(parseShrinkTarget("a lot")).toBeNull();
  });

  it("expands every command to an instruction and a label, and refuses bad ones", () => {
    const shrink = expandSlashCommand("/shrink-by 30%");
    expect(shrink?.ok).toBe(true);
    if (!shrink || !shrink.ok) throw new Error("expected ok");
    expect(shrink.label).toBe("Shrink by 30%");
    expect(shrink.instruction).toContain("about 30%");
    expect(shrink.instruction).toContain("Preserve every concrete fact");
    expect(expandSlashCommand("/shrink-by 1 page")).toMatchObject({ ok: true, label: "Shrink by 1 page" });
    expect(expandSlashCommand("/shrink-by")).toEqual(expect.objectContaining({ ok: false, error: SHRINK_USAGE }));
    expect(expandSlashCommand("/shrink-by lots")).toEqual(expect.objectContaining({ ok: false, error: SHRINK_USAGE }));

    const theme = expandSlashCommand("/win-theme 2");
    expect(theme).toMatchObject({ ok: true, label: "Reinforce win theme 2" });
    if (theme?.ok) expect(theme.instruction).toContain("reinforces win theme 2 throughout");
    const named = expandSlashCommand("/win-theme Zero trust by default");
    expect(named).toMatchObject({ ok: true, label: 'Reinforce "Zero trust by default"' });
    expect(expandSlashCommand("/win-theme")).toMatchObject({ ok: true, label: "Reinforce the win themes" });

    expect(expandSlashCommand("/add-citation")).toMatchObject({ ok: true, label: "Add citations" });
    const compliance = expandSlashCommand("/check-compliance");
    expect(compliance).toMatchObject({ ok: true, label: "Check compliance" });
    if (compliance?.ok) expect(compliance.instruction).toContain("Do not rewrite the section.");
    const voc = expandSlashCommand("/voc");
    expect(voc).toMatchObject({ ok: true, label: "Rewrite in the customer's voice" });
    if (voc?.ok) expect(voc.instruction).toContain("never say that you are mirroring the solicitation");

    expect(expandSlashCommand("/frobnicate now")).toEqual({
      ok: false,
      command: null,
      error: 'Unknown command "/frobnicate". Type / to see the commands.',
    });
    expect(expandSlashCommand("make it shorter")).toBeNull();
  });

  it("labels command turns and expands them for the model only", () => {
    expect(describeSlashCommand("/voc")).toBe("Rewrite in the customer's voice");
    expect(describeSlashCommand("/shrink-by")).toBeNull();
    expect(describeSlashCommand("please shorten")).toBeNull();
    expect(messageForModel("/add-citation")).toContain("[NEEDS CITATION]");
    expect(messageForModel("please shorten")).toBe("please shorten");
    // An invalid command never reaches the model expanded.
    expect(messageForModel("/shrink-by")).toBe("/shrink-by");
  });
});

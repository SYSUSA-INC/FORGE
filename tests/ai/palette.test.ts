/**
 * BL-AIP-7d — the ⌘K palette, pure parts: commands from the nav trees,
 * ranking, the question rule and row order.
 */

import { describe, expect, it } from "vitest";
import {
  canAsk,
  canSearch,
  isQuestion,
  normalizeQuery,
  paletteCommands,
  paletteRows,
  rankCommands,
  scoreCommand,
  type PaletteCommand,
  type PaletteRecord,
} from "@/lib/palette";

const member = { isOrgAdmin: false, isSuperadmin: false, hasWorkspace: true };
const orgAdmin = { isOrgAdmin: true, isSuperadmin: false, hasWorkspace: true };
const superWithTenant = { isOrgAdmin: true, isSuperadmin: true, hasWorkspace: true };
const superNoTenant = { isOrgAdmin: true, isSuperadmin: true, hasWorkspace: false };

describe("paletteCommands", () => {
  it("lists exactly what the sidebar lists, once per page", () => {
    const hrefs = (v: typeof member) => paletteCommands(v).map((c) => c.href);
    const m = hrefs(member);
    expect(m).toContain("/");
    expect(m).toContain("/opportunities/scout");
    expect(m).toContain("/knowledge-base/new");
    expect(m).toContain("/settings/ai-engine");
    expect(m).not.toContain("/users");
    expect(m).not.toContain("/audit-log");
    expect(m).not.toContain("/help/admin");
    expect(m).not.toContain("/admin");
    expect(new Set(m).size).toBe(m.length);

    const a = hrefs(orgAdmin);
    expect(a).toContain("/users");
    expect(a).toContain("/settings/billing");
    expect(a).toContain("/help/admin");
    expect(a).not.toContain("/admin");
    expect(new Set(a).size).toBe(a.length);
    // A page listed in two workspaces sits under the first (everyday) one.
    expect(paletteCommands(orgAdmin).find((c) => c.href === "/users")?.workspace).toBe("work");

    const s = hrefs(superWithTenant);
    // The SuperAdmin portal's tabs are listed as the sidebar lists them.
    expect(s).toContain("/admin?tab=overview");
    expect(s).toContain("/admin?tab=organizations");
    expect(s).toContain("/admin?tab=users");
    expect(s).toContain("/platform/audit-log");
    expect(new Set(s).size).toBe(s.length);

    // No tenant: only platform pages and the help pages that need no workspace.
    const n = hrefs(superNoTenant);
    expect(n).toContain("/admin/tiers");
    expect(n).not.toContain("/");
    expect(n).not.toContain("/opportunities");
  });
});

describe("rankCommands / scoreCommand", () => {
  const cmds: PaletteCommand[] = [
    { id: "/", label: "Command Center", group: "Command Center", workspace: "work", href: "/" },
    { id: "/pipeline", label: "Pipeline", group: "Opportunities", workspace: "work", href: "/pipeline" },
    { id: "/opportunities/scout", label: "Scout", group: "Opportunities", workspace: "work", href: "/opportunities/scout" },
    { id: "/proposals", label: "In-flight Proposals", group: "Opportunities", workspace: "work", href: "/proposals" },
    { id: "/proposals/new", label: "New Proposals", group: "Opportunities", workspace: "work", href: "/proposals/new" },
    { id: "/settings/ai-engine", label: "AI Engine", group: "Operations Management", workspace: "work", href: "/settings/ai-engine" },
  ];

  it("prefers label prefix, then word prefix, then substring, then group", () => {
    expect(scoreCommand(cmds[3]!, "in-flight")).toBe(4);
    expect(scoreCommand(cmds[3]!, "prop")).toBe(3);
    expect(scoreCommand(cmds[3]!, "light")).toBe(2);
    expect(scoreCommand(cmds[1]!, "opportun")).toBe(1);
    expect(scoreCommand(cmds[1]!, "zzz")).toBe(0);
    // Every token must land somewhere.
    expect(scoreCommand(cmds[3]!, "proposals zzz")).toBe(0);
    expect(scoreCommand(cmds[4]!, "new prop")).toBe(7);
  });

  it("ranks best first, keeps sidebar order on ties, and limits", () => {
    expect(rankCommands(cmds, "prop").map((c) => c.href)).toEqual(["/proposals", "/proposals/new"]);
    expect(rankCommands(cmds, "new").map((c) => c.href)).toEqual(["/proposals/new"]);
    expect(rankCommands(cmds, "opportunities").map((c) => c.href)).toEqual([
      "/pipeline",
      "/opportunities/scout",
      "/proposals",
      "/proposals/new",
    ]);
    expect(rankCommands(cmds, "opportunities", 2).map((c) => c.href)).toEqual(["/pipeline", "/opportunities/scout"]);
    // Empty query: the first few, sidebar order.
    expect(rankCommands(cmds, "  ", 3).map((c) => c.href)).toEqual(["/", "/pipeline", "/opportunities/scout"]);
    expect(rankCommands(cmds, "AI ENGINE").map((c) => c.href)).toEqual(["/settings/ai-engine"]);
  });
});

describe("questions", () => {
  it("normalizes", () => {
    expect(normalizeQuery("  What   did we\tDO? ")).toBe("what did we do?");
  });

  it("reads a question mark or a question word as a question", () => {
    expect(isQuestion("what did we do for NAVSEA")).toBe(true);
    expect(isQuestion("Do we hold a CMMI level 3 appraisal?")).toBe(true);
    expect(isQuestion("cloud migration past performance?")).toBe(true);
    expect(isQuestion("cloud migration")).toBe(false);
    expect(isQuestion("how?")).toBe(false); // too short for the Brain
    expect(isQuestion("")).toBe(false);
  });

  it("gates asking and searching by length", () => {
    expect(canSearch("a")).toBe(false);
    expect(canSearch("ab")).toBe(true);
    expect(canAsk("navsea")).toBe(true);
    expect(canAsk("nav")).toBe(false);
    expect(canAsk("x".repeat(501))).toBe(false);
  });
});

describe("paletteRows", () => {
  const record: PaletteRecord = { kind: "opportunity", id: "o1", title: "NAVSEA recompete", subtitle: "", href: "/opportunities/o1" };
  const command: PaletteCommand = { id: "/pipeline", label: "Pipeline", group: "Opportunities", workspace: "work", href: "/pipeline" };

  it("puts the Brain row first for a question, last otherwise, never for short text", () => {
    expect(paletteRows({ query: "what is our NAVSEA record?", records: [record], commands: [command] }).map((r) => r.type)).toEqual([
      "ask",
      "record",
      "command",
    ]);
    expect(paletteRows({ query: "navsea recompete", records: [record], commands: [command] }).map((r) => r.type)).toEqual([
      "record",
      "command",
      "ask",
    ]);
    expect(paletteRows({ query: "nav", records: [record], commands: [command] }).map((r) => r.type)).toEqual([
      "record",
      "command",
    ]);
    const ask = paletteRows({ query: "  what is our NAVSEA record?  ", records: [], commands: [] })[0];
    expect(ask).toEqual({ type: "ask", question: "what is our NAVSEA record?" });
  });
});

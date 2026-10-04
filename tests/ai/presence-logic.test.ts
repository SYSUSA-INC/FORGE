/**
 * BL-FB-CHAT-MULTI Slice 3 — who else has a section open: the window, the
 * words and the initials.
 */

import { describe, expect, it } from "vitest";
import { PRESENCE_TTL_MS, activeViewers, initials, presenceLabel } from "@/lib/presence-logic";

const NOW = new Date("2026-10-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("activeViewers", () => {
  it("keeps others seen inside the window, by name, never the viewer", () => {
    const rows = [
      { userId: "me", name: "Me Myself", lastSeenAt: ago(1_000) },
      { userId: "b", name: "Ben Ortiz", lastSeenAt: ago(10_000) },
      { userId: "a", name: "Ana Rivera", lastSeenAt: ago(PRESENCE_TTL_MS) },
      { userId: "c", name: "Cy Old", lastSeenAt: ago(PRESENCE_TTL_MS + 1) },
    ];
    expect(activeViewers(rows, "me", NOW)).toEqual([
      { userId: "a", name: "Ana Rivera" },
      { userId: "b", name: "Ben Ortiz" },
    ]);
    expect(activeViewers([], "me", NOW)).toEqual([]);
  });
});

describe("wording", () => {
  it("says who is here in a few words", () => {
    expect(presenceLabel([])).toBe("");
    expect(presenceLabel(["Ana Rivera"])).toBe("Ana is here");
    expect(presenceLabel(["Ana Rivera", "ben@acme.com"])).toBe("Ana and ben are here");
    expect(presenceLabel(["Ana", "Ben", "Cy"])).toBe("Ana, Ben and 1 other are here");
    expect(presenceLabel(["Ana", "Ben", "Cy", "Di"])).toBe("Ana, Ben and 2 others are here");
    expect(initials("Ana Rivera")).toBe("AR");
    expect(initials("ben@acme.com")).toBe("BA");
    expect(initials("Cy")).toBe("CY");
    expect(initials("")).toBe("?");
  });
});

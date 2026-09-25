/**
 * BL-AIP-4 — candidate de-duplication for Brain extraction runs.
 */

import { describe, expect, it } from "vitest";
import { candidateKey, dedupCandidates, normalizeTitle } from "@/lib/knowledge-dedup";

describe("normalizeTitle / candidateKey", () => {
  it("ignores case, punctuation and whitespace differences", () => {
    expect(normalizeTitle("  Cloud  Migration — Phase II! ")).toBe("cloud migration phase ii");
    expect(candidateKey("Capability", "Cloud Migration (Phase II)")).toBe(
      "capability::cloud migration phase ii",
    );
    expect(candidateKey("capability", "cloud migration phase ii")).toBe(
      candidateKey("CAPABILITY", "Cloud-Migration, Phase II"),
    );
  });

  it("caps the key length", () => {
    expect(normalizeTitle("x".repeat(500)).length).toBe(120);
  });
});

describe("dedupCandidates", () => {
  const incoming = [
    { kind: "capability", title: "Cloud Migration" },
    { kind: "capability", title: "cloud migration!" },
    { kind: "past_performance", title: "Cloud Migration" },
    { kind: "boilerplate", title: "   " },
    { kind: "personnel", title: "Jane Doe" },
  ];

  it("drops repeats within the batch, against existing keys and blank titles", () => {
    const { kept, skipped } = dedupCandidates(incoming, [
      candidateKey("personnel", "Jane Doe"),
    ]);
    expect(kept.map((c) => `${c.kind}:${c.title}`)).toEqual([
      "capability:Cloud Migration",
      "past_performance:Cloud Migration",
    ]);
    expect(skipped).toBe(3);
  });

  it("keeps everything when nothing collides", () => {
    const { kept, skipped } = dedupCandidates(
      [{ kind: "capability", title: "A" }, { kind: "capability", title: "B" }],
      [],
    );
    expect(kept.length).toBe(2);
    expect(skipped).toBe(0);
  });
});

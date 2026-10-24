import { describe, expect, it } from "vitest";
import { buildFunnelData } from "@/app/(app)/pipeline/funnel-stats";

const row = (stage: string) =>
  ({ stage, pWin: 50, valueLow: "", valueHigh: "" }) as Parameters<typeof buildFunnelData>[0][number];

describe("buildFunnelData reached counts (BL-PIPE-FUNNEL)", () => {
  const data = buildFunnelData(
    ["identified", "identified", "qualification", "writing", "submitted", "won", "lost", "no_bid"].map(row),
  );
  const reached = Object.fromEntries([...data.active, ...data.closed].map((s) => [s.key, s.reached]));
  const conversion = Object.fromEntries([...data.active, ...data.closed].map((s) => [s.key, s.conversion]));

  it("counts everyone that got at least as far as each stage", () => {
    expect(reached).toMatchObject({
      identified: 8,
      sources_sought: 6,
      qualification: 6,
      capture: 4,
      pre_proposal: 4,
      writing: 4,
      submitted: 3,
      won: 1,
    });
  });

  it("reads a lost bid as reaching Submitted and a no-bid as leaving at Qualification", () => {
    expect(reached.submitted).toBe(3);
    expect(reached.capture).toBe(4);
  });

  it("gives the share of the previous stage that got here, and none for the first", () => {
    expect(conversion.identified).toBeNull();
    expect(conversion.submitted).toBeCloseTo(3 / 4);
    expect(conversion.won).toBeCloseTo(1 / 3);
  });

  it("keeps lost and no-bid off the funnel geometry", () => {
    expect(reached.lost).toBe(1);
    expect(reached.no_bid).toBe(1);
    expect(conversion.lost).toBeNull();
    expect(data.winRate).toBe(50);
  });
});

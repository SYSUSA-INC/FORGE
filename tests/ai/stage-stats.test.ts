import { describe, expect, it } from "vitest";
import { buildStageStats } from "@/app/(app)/opportunities/stage-stats";

const past = new Date(Date.now() - 7 * 86_400_000);
const soon = new Date(Date.now() + 3 * 86_400_000);
const row = (stage: string, responseDueDate: Date | null) =>
  ({ stage, responseDueDate, valueLow: "", valueHigh: "" }) as Parameters<typeof buildStageStats>[0][number];

describe("buildStageStats past-due bookkeeping", () => {
  it("counts an elapsed date as past due while the pursuit is still open", () => {
    const stats = buildStageStats([row("writing", past), row("capture", soon)]);
    expect(stats.writing?.pastDueCount).toBe(1);
    expect(stats.capture?.pastDueCount).toBe(0);
    expect(stats.capture?.soonestDue).toEqual(soon);
  });

  it.each(["submitted", "won", "lost", "no_bid"])("never marks a %s pursuit past due", (stage) => {
    const stats = buildStageStats([row(stage, past), row(stage, soon)]);
    expect(stats[stage]?.count).toBe(2);
    expect(stats[stage]?.pastDueCount).toBe(0);
    expect(stats[stage]?.soonestDue).toBeNull();
  });
});

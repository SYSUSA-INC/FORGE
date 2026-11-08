/**
 * BL-SCOUT-AMEND — the amendment watch's pure parts.
 */
import { describe, expect, it } from "vitest";
import { isWatched, noticeLabel, planWatch, storageFileName, watchMessage, type WatchNotice } from "@/lib/amendment-watch-logic";

const n = (noticeId: string, postedDate: string, links: string[], o: Partial<WatchNotice> = {}): WatchNotice => ({
  noticeId,
  title: "Help desk modernization",
  type: "Solicitation",
  postedDate,
  responseDeadLine: null,
  resourceLinks: links,
  ...o,
});
const created = new Date("2026-10-05T00:00:00Z");
const state = { noticeId: "N-0", createdAt: created, responseDueDate: new Date("2026-11-01T17:00:00Z"), seenLinks: [] as string[], noticeIds: [] as string[] };

describe("BL-SCOUT-AMEND — planWatch", () => {
  const notices = [
    n("N-2", "2026-10-20", ["l3"], { title: "Help desk modernization, Amendment 0002", responseDeadLine: "2026-11-15T17:00:00Z" }),
    n("N-0", "2026-10-01", ["l1", "l2"]),
    n("N-1", "2026-10-03", [], { title: "Amendment 0001" }),
  ];

  it("orders the notices, marks what follows the opportunity's own notice as amendments, and tells only what came after it was added", () => {
    const plan = planWatch(state, notices);
    expect(plan.notices.map((p) => [p.notice.noticeId, p.amendment, p.tell, p.amendmentNumber])).toEqual([
      ["N-0", false, false, ""],
      ["N-1", true, false, "0001"],
      ["N-2", true, true, "0002"],
    ]);
    expect(plan.notices.map((p) => p.newLinks)).toEqual([["l1", "l2"], [], ["l3"]]);
    expect(plan.notices.map((p) => p.newNotice)).toEqual([false, true, true]);
  });

  it("moves the response date to the newest new amendment's", () => {
    expect(planWatch(state, notices).due).toEqual({ from: state.responseDueDate, to: new Date("2026-11-15T17:00:00Z"), noticeId: "N-2" });
    // Once that amendment is filed, a date the team set by hand stays.
    expect(planWatch({ ...state, noticeIds: ["N-1", "N-2"], responseDueDate: new Date("2026-11-20T17:00:00Z") }, notices).due).toBeNull();
    // The same date is no move.
    expect(planWatch({ ...state, responseDueDate: new Date("2026-11-15T17:00:00Z") }, notices).due).toBeNull();
  });

  it("files only links not seen, and with no own notice treats the first as the original", () => {
    const plan = planWatch({ ...state, noticeId: "", seenLinks: ["l1"] }, notices);
    expect(plan.notices.map((p) => [p.amendment, p.newLinks])).toEqual([
      [false, ["l2"]],
      [true, []],
      [true, ["l3"]],
    ]);
  });

  it("an opportunity added from an amendment has the earlier notices as originals", () => {
    const plan = planWatch({ ...state, noticeId: "N-1" }, notices);
    expect(plan.notices.map((p) => p.amendment)).toEqual([false, false, true]);
  });
});

describe("BL-SCOUT-AMEND — labels, file names and the message", () => {
  it("names a notice", () => {
    expect(noticeLabel({ amendment: true, amendmentNumber: "0002" })).toBe("Amendment 0002");
    expect(noticeLabel({ amendment: true, amendmentNumber: "" }, ["SF30 Amendment No. 3.pdf"])).toBe("Amendment 3");
    expect(noticeLabel({ amendment: true, amendmentNumber: "" }, ["Q&A.pdf"])).toBe("An amendment");
    expect(noticeLabel({ amendment: false, amendmentNumber: "" })).toBe("New documents");
  });

  it("keeps a file name safe as a storage key's last segment", () => {
    expect(storageFileName("../../etc/passwd")).toBe("__.._etc_passwd");
    expect(storageFileName("PWS v2.docx")).toBe("PWS v2.docx");
    expect(storageFileName("")).toBe("attachment");
  });

  it("says what was posted, the date that moved and what was filed", () => {
    const m = watchMessage({
      title: "Help desk modernization",
      solicitationNumber: "36C10B26R0042",
      labels: ["Amendment 0002"],
      due: { from: new Date("2026-11-01T17:00:00Z"), to: new Date("2026-11-15T17:00:00Z") },
      filed: ["SF30 Amendment 0002.pdf"],
      notFiled: [],
    });
    expect(m.subject).toBe("Amendment 0002 posted — Help desk modernization");
    expect(m.body).toBe(
      [
        "SAM.gov posted Amendment 0002 for 36C10B26R0042.",
        "The response date moved from 2026-11-01 to 2026-11-15; the opportunity has the new date.",
        "Filed on the opportunity and being read: SF30 Amendment 0002.pdf.",
      ].join("\n"),
    );
    const bare = watchMessage({ title: "T", solicitationNumber: "S", labels: ["An amendment"], due: null, filed: [], notFiled: [] });
    expect(bare.body).toBe("SAM.gov posted an amendment for S.\nIt has no documents; read the notice on SAM.gov for what changed.");
    const big = watchMessage({ title: "T", solicitationNumber: "S", labels: ["Amendment 3"], due: null, filed: [], notFiled: ["Attachment is larger than 20 MB."] });
    expect(big.body).toBe("SAM.gov posted Amendment 3 for S.\nNot downloaded: Attachment is larger than 20 MB. Open SAM.gov for it.");
  });

  it("watches open pursuits only", () => {
    expect(isWatched("identified")).toBe(true);
    expect(isWatched("submitted")).toBe(true);
    expect(isWatched("won")).toBe(false);
    expect(isWatched("no_bid")).toBe(false);
  });
});

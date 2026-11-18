import { describe, expect, it } from "vitest";
import {
  alsoRemoveWords,
  approveCompanyTitle,
  approveLeftOutText,
  approveLine,
  approveReadyText,
  brainCheckPosition,
  mergedNote,
  newCompanyNote,
  progressText,
  redactionParts,
  refusalSummary,
  refusalText,
  splitForApprove,
  type ApprovalProgress,
} from "./importApprove";
import { approveRefusalFor } from "../../../../shared/importSheetRules";

const progress = (extra: Partial<ApprovalProgress>): ApprovalProgress => ({
  approvalId: "ap1" as ApprovalProgress["approvalId"],
  scope: "company",
  companyName: "Halden Foods",
  status: "running",
  stalled: false,
  total: 300,
  done: 40,
  approved: 40,
  refused: 0,
  startedAt: 1,
  mine: true,
  startedByName: undefined,
  ...extra,
});

describe("Approve's words (2026-11-17)", () => {
  it("names the action and the confirm", () => {
    expect(approveReadyText(1204)).toBe("Approve 1,204 ready");
    expect(approveLine(1)).toBe("Approve 1 file");
    expect(approveLine(6)).toBe("Approve 6 files");
    expect(approveCompanyTitle(77, "Halden Foods")).toBe("Approve 77 files of Halden Foods?");
    expect(newCompanyNote("Halden Foods", "Food and beverage", true)).toBe("Halden Foods is new. Approve adds it with the industry Food and beverage.");
    expect(newCompanyNote("Halden Foods", null, true)).toBe(
      "Halden Foods is new and has no industry yet. Its final PDs stay on To review until you pick one."
    );
    expect(newCompanyNote("Halden Foods", null, false)).toBe("Halden Foods is new. Approve adds it with no industry.");
    expect(mergedNote("Brightwell Dairy", "Brightwell Farms")).toBe(
      "Brightwell Dairy was merged into Brightwell Farms. Move these files to Brightwell Farms first, then approve them there."
    );
  });

  it("leaves out what the row alone says cannot be approved, by the server's rule", () => {
    const rows = [
      { id: "a", status: "pending_review", needsCheck: false },
      { id: "b", status: "pending_review", needsCheck: true },
      { id: "c", status: "fetched" },
      { id: "d", status: "failed", needsCheck: true },
      { id: "e", status: "deleted" },
    ] as const;
    const split = splitForApprove(rows.map((row) => ({ ...row })));
    expect(split.taken.map((row) => row.id)).toEqual(["a"]);
    expect(split.leftOut).toEqual([
      { reason: "needs_check", count: 2 },
      { reason: "being_read", count: 1 },
      { reason: "not_on_review", count: 1 },
    ]);
    expect(approveLeftOutText(split.leftOut)).toBe(
      "2 files were left out: they still need a check. 1 file was left out: it is still being read. 1 file was left out: it is no longer on To review."
    );
    expect(approveRefusalFor({ status: "approved" })).toBeNull();
  });

  it("says how far an approval is, what it did, and when it stopped", () => {
    expect(progressText(progress({}))).toBe("Approving files of Halden Foods: 40 of 300 done.");
    expect(progressText(progress({ mine: false, startedByName: "Robin Sample" }))).toBe(
      "Robin Sample is approving files of Halden Foods: 40 of 300 done."
    );
    expect(progressText(progress({ companyName: undefined, scope: "files" }))).toBe("Approving files: 40 of 300 done.");
    expect(progressText(progress({ status: "done", done: 300, approved: 296, refused: 4 }))).toBe(
      "Approved 296 files of Halden Foods. 4 were left on To review."
    );
    expect(progressText(progress({ status: "done", done: 1, approved: 1, refused: 0, total: 1 }))).toBe("Approved 1 file of Halden Foods.");
    expect(progressText(progress({ status: "done", done: 1, approved: 0, refused: 1, total: 1 }))).toBe(
      "No files were approved. 1 was left on To review."
    );
    expect(progressText(progress({ stalled: true }))).toBe("This approval stopped after 40 of 300 files. Approve again to go on.");
    expect(progressText(progress({ status: "stopped" }))).toBe("This approval stopped after 40 of 300 files. Approve again to go on.");
  });

  it("says why files were left, together and one by one", () => {
    expect(refusalSummary([{ reason: "needs_check" }, { reason: "needs_check" }, { reason: "no_industry" }])).toBe(
      "2 files still need a check. 1 file is a final PD whose company has no industry yet."
    );
    expect(refusalText({ reason: "company_merged", detail: "Merged into Brightwell Farms" })).toBe(
      "It belongs to a company that was merged into another one. Merged into Brightwell Farms."
    );
    expect(refusalText({ reason: "no_industry", detail: "Pick an industry for this company." })).toBe(
      "It is a final PD whose company has no industry yet. Pick an industry for this company."
    );
    expect(refusalText({ reason: "missing" })).toBe("It is no longer in Import.");
  });
});

describe("the Brain check's helpers", () => {
  it("marks each word the scrub hid", () => {
    expect(redactionParts("[redacted] built it at [redacted address], BN [redacted number].")).toEqual([
      { text: "[redacted]", mark: true },
      { text: " built it at ", mark: false },
      { text: "[redacted address]", mark: true },
      { text: ", BN ", mark: false },
      { text: "[redacted number]", mark: true },
      { text: ".", mark: false },
    ]);
    expect(redactionParts("Nothing hidden")).toEqual([{ text: "Nothing hidden", mark: false }]);
  });

  it("takes Also remove words split by commas or lines, each once", () => {
    expect(alsoRemoveWords(" KelpTrack,  Mill   Road site\nkelptrack,", ["Quay 7"])).toEqual(["Quay 7", "KelpTrack", "Mill Road site"]);
    expect(alsoRemoveWords("  ", [])).toEqual([]);
  });

  it("counts its place", () => {
    expect(brainCheckPosition(0, 12)).toBe("1 of 12");
    expect(brainCheckPosition(24, 12)).toBe("25 of 25");
  });
});

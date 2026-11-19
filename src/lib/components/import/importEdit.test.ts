import { describe, expect, it } from "vitest";
import {
  BATCH_MAX,
  changedText,
  changePatch,
  checkState,
  chunks,
  confirmLine,
  dateInputFromUtcDay,
  deletedReasonText,
  deletedText,
  deleteLine,
  fileSelectLabel,
  leftOutText,
  MOVE_CATEGORIES,
  moveBackGroups,
  movedText,
  CHOOSE_WRITER,
  putBackLine,
  putBackText,
  rowAbilities,
  runInChunks,
  sectionSelectLabel,
  settledIds,
  skippedText,
  splitForChange,
  stoppedText,
  utcDayFromDateInput,
  VERSION_CODES,
  writerMatchedText,
  yearEndCalendarStart,
  type BarChange,
  type BatchResult,
  type FileId,
} from "./importEdit";

/** Import sheet phase 3b: what rows may do, the year end day, batches and the bar's words. */
describe("rowAbilities", () => {
  const row = (status: string, category: string, deletedReason?: string) =>
    ({ status, category, deletedReason }) as Parameters<typeof rowAbilities>[0];

  it("lets a read file on To review change its labels, by category", () => {
    expect(rowAbilities(row("pending_review", "final_pd"), "review")).toEqual({
      edit: true,
      pdNumber: true,
      version: true,
      writer: true,
      reviewer: true,
      craReviewed: true,
      scienceCode: true,
      menu: true,
      remove: true,
      putBack: false,
      select: true,
      approvedMenu: false,
    });
    expect(rowAbilities(row("pending_review", "draft"), "review")).toMatchObject({ pdNumber: true, version: true, writer: true, reviewer: true, craReviewed: false, scienceCode: false });
    expect(rowAbilities(row("pending_review", "review_copy"), "review")).toMatchObject({ pdNumber: true, version: true, writer: true, scienceCode: false });
    for (const category of ["transcript", "supporting", "company_file", "unknown"]) {
      expect(rowAbilities(row("pending_review", category), "review"), category).toMatchObject({
        edit: true,
        pdNumber: false,
        version: false,
        writer: false,
        reviewer: false,
        craReviewed: false,
        scienceCode: false,
      });
    }
  });

  it("keeps the labels of a file being read or that could not be read, which can still be moved", () => {
    for (const status of ["discovered", "fetched"]) {
      expect(rowAbilities(row(status, "final_pd"), "review"), status).toMatchObject({
        edit: false,
        pdNumber: false,
        scienceCode: false,
        menu: true,
        // The server refuses to delete a file still being read.
        remove: false,
        select: true,
      });
    }
    expect(rowAbilities(row("failed", "final_pd"), "review")).toMatchObject({ edit: false, menu: true, remove: true, select: true });
  });

  it("puts back what a person deleted or rejected, never a file removed in OneDrive, and on Approved edits metadata only", () => {
    expect(rowAbilities(row("deleted", "draft", "deleted"), "deleted")).toMatchObject({ edit: false, menu: false, putBack: true, select: true });
    expect(rowAbilities(row("rejected", "draft", "rejected"), "deleted")).toMatchObject({ edit: false, menu: false, putBack: true, select: true });
    for (const status of ["rejected", "deleted"]) {
      // Never put back; selectable only for the bar's reviewer and CRA actions.
      expect(rowAbilities(row(status, "transcript", "removed_in_onedrive"), "deleted"), status).toMatchObject({ putBack: false, select: false });
      expect(rowAbilities(row(status, "draft", "removed_in_onedrive"), "deleted"), status).toMatchObject({ putBack: false, select: true });
    }
    // A final PD removed in OneDrive can still be selected and marked Reviewed by CRA.
    expect(rowAbilities(row("deleted", "final_pd", "removed_in_onedrive"), "deleted")).toMatchObject({
      putBack: false,
      reviewer: true,
      craReviewed: true,
      select: true,
    });
    // 2026-11-17: the reviewer can be set on Deleted too, and the CRA mark on a deleted final PD.
    expect(rowAbilities(row("deleted", "draft", "removed_in_onedrive"), "deleted")).toMatchObject({ reviewer: true, craReviewed: false });
    expect(rowAbilities(row("deleted", "final_pd", "deleted"), "deleted")).toMatchObject({ reviewer: true, craReviewed: true });
    expect(rowAbilities(row("deleted", "transcript", "deleted"), "deleted")).toMatchObject({ reviewer: false, craReviewed: false });
    // Being read: neither.
    expect(rowAbilities(row("fetched", "final_pd"), "review")).toMatchObject({ reviewer: false, craReviewed: false });
    // 2026-11-17 (edit after approval, Send back): writer, reviewer, science
    // code and the CRA mark by the shared rule, the approved menu and
    // Select; never a year, version, PD number, move or delete.
    expect(rowAbilities(row("approved", "final_pd"), "approved")).toEqual({
      edit: false,
      pdNumber: false,
      version: false,
      writer: true,
      reviewer: true,
      craReviewed: true,
      scienceCode: true,
      menu: false,
      remove: false,
      putBack: false,
      select: true,
      approvedMenu: true,
    });
    expect(rowAbilities(row("approved", "draft"), "approved")).toMatchObject({
      writer: true,
      reviewer: true,
      craReviewed: false,
      scienceCode: false,
      approvedMenu: true,
    });
    for (const category of ["transcript", "supporting", "company_file"]) {
      expect(rowAbilities(row("approved", category), "approved"), category).toMatchObject({
        writer: false,
        reviewer: false,
        craReviewed: false,
        scienceCode: false,
        select: true,
        approvedMenu: true,
      });
    }
    // An approved file listed on another tab (search) takes nothing there.
    expect(rowAbilities(row("approved", "final_pd"), "review")).toMatchObject({
      writer: false,
      reviewer: false,
      craReviewed: false,
      approvedMenu: false,
      select: false,
    });
  });
});

describe("the year end day", () => {
  it("stores the UTC midnight of the day picked, and reads a stored one back as that day", () => {
    expect(utcDayFromDateInput("2025-03-31")).toBe(Date.UTC(2025, 2, 31));
    expect(utcDayFromDateInput("2024-12-31")).toBe(Date.UTC(2024, 11, 31));
    expect(utcDayFromDateInput("2024-02-29")).toBe(Date.UTC(2024, 1, 29));
    expect(dateInputFromUtcDay(Date.UTC(2025, 2, 31))).toBe("2025-03-31");
    expect(dateInputFromUtcDay(Date.UTC(2024, 0, 1))).toBe("2024-01-01");
    // Round trip for every day of a year, whatever the machine's time zone.
    for (let day = 0; day < 366; day += 1) {
      const timestamp = Date.UTC(2024, 0, 1) + day * 86_400_000;
      expect(utcDayFromDateInput(dateInputFromUtcDay(timestamp))).toBe(timestamp);
    }
  });

  it("takes nothing that is not a real day", () => {
    expect(utcDayFromDateInput("")).toBeNull();
    expect(utcDayFromDateInput("2025-02-30")).toBeNull();
    expect(utcDayFromDateInput("2025-13-01")).toBeNull();
    expect(utcDayFromDateInput("March 31")).toBeNull();
    expect(dateInputFromUtcDay(undefined)).toBe("");
    expect(dateInputFromUtcDay(Number.NaN)).toBe("");
  });

  it("opens the calendar on the newest year end it is given, else on last year's Dec 31, never in this year on its own", () => {
    const today = new Date(2026, 10, 11);
    expect(yearEndCalendarStart([Date.UTC(2024, 11, 31), Date.UTC(2025, 2, 31), undefined], today)).toBe("2025-03-31");
    expect(yearEndCalendarStart([Date.UTC(2024, 5, 30)], today)).toBe("2024-06-30");
    // None known: the last year end that has surely passed.
    expect(yearEndCalendarStart([], today)).toBe("2025-12-31");
    expect(yearEndCalendarStart([undefined, null, Number.NaN], today)).toBe("2025-12-31");
    expect(yearEndCalendarStart([], new Date(2027, 0, 2))).toBe("2026-12-31");
  });
});

describe("a move's toast and Undo", () => {
  it("says where one file went", () => {
    expect(movedText({ category: "draft" })).toBe("Moved to Drafts");
    expect(movedText({ category: "review_copy" })).toBe("Moved to Review copies");
    expect(movedText({ company: "Halden Foods" })).toBe("Moved to Halden Foods");
  });

  it("groups the moved files by the value each had, and gives up on one it cannot set back", () => {
    const id = (name: string) => name as FileId;
    expect(
      moveBackGroups("category", [
        { _id: id("a"), before: "final_pd" },
        { _id: id("b"), before: "transcript" },
        { _id: id("c"), before: "final_pd" },
      ])
    ).toEqual([
      { patch: { category: "final_pd" }, ids: ["a", "c"] },
      { patch: { category: "transcript" }, ids: ["b"] },
    ]);
    expect(
      moveBackGroups("company", [
        { _id: id("a"), before: "Cedarline Systems" },
        { _id: id("b"), before: "Northgate Labs" },
      ])
    ).toEqual([
      { patch: { company: "Cedarline Systems" }, ids: ["a"] },
      { patch: { company: "Northgate Labs" }, ids: ["b"] },
    ]);
    // "No company yet" cannot be set back by a change, and an unknown value cannot either.
    expect(moveBackGroups("company", [{ _id: id("a"), before: "Cedarline Systems" }, { _id: id("b"), before: null }])).toBeNull();
    expect(moveBackGroups("category", [{ _id: id("a"), before: undefined }])).toBeNull();
    expect(moveBackGroups("category", [])).toEqual([]);
  });
});

describe("batches", () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `f${index}` as FileId);
  /** What the server says for a run: every file changed but the first, which is gone. */
  const answer = (part: FileId[]): BatchResult => ({
    changed: part.length - 1,
    changedIds: part.slice(1),
    skipped: [{ id: part[0], reason: "not_on_tab" }],
  });

  it("splits ids into runs of at most 100", () => {
    const ids = Array.from({ length: 250 }, (_, index) => `f${index}`);
    expect(BATCH_MAX).toBe(100);
    expect(chunks(ids).map((part) => part.length)).toEqual([100, 100, 50]);
    expect(chunks(ids.slice(0, 100)).map((part) => part.length)).toEqual([100]);
    expect(chunks([])).toEqual([]);
  });

  it("sends the runs one after another, keeps what each changed and skipped, and stops at the first that fails", async () => {
    const all = ids(250);
    const sent: FileId[][] = [];
    let inFlight = 0;
    const ok = await runInChunks(all, async (part) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      sent.push(part);
      await Promise.resolve();
      inFlight -= 1;
      return answer(part);
    });
    expect(sent.map((part) => part.length)).toEqual([100, 100, 50]);
    expect(ok.sent).toEqual(all);
    expect(ok.changedIds).toEqual(all.filter((id) => !["f0", "f100", "f200"].includes(id)));
    expect(ok.skipped).toEqual(["f0", "f100", "f200"].map((id) => ({ id, reason: "not_on_tab" })));
    expect(ok.error).toBeNull();

    const refusal = new Error("No");
    let calls = 0;
    const stopped = await runInChunks(all, async (part) => {
      calls += 1;
      if (calls === 2) throw refusal;
      return answer(part);
    });
    expect(calls).toBe(2);
    expect(stopped).toEqual({
      sent: all.slice(0, 100),
      changedIds: all.slice(1, 100),
      skipped: [{ id: "f0", reason: "not_on_tab" }],
      error: refusal,
    });
    // The selection drops what changed and what is gone; a file still on the tab stays.
    expect(
      settledIds({
        changedIds: ["a" as FileId],
        skipped: [
          { id: "b" as FileId, reason: "missing" },
          { id: "c" as FileId, reason: "being_read" },
          { id: "d" as FileId, reason: "does_not_apply" },
          { id: "e" as FileId, reason: "approved" },
        ],
      })
    ).toEqual(["a", "b", "e"]);
  });
});

describe("what a bar action takes", () => {
  const file = (id: string, status: string, category: string) =>
    ({ _id: id as FileId, name: `${id}.docx`, status, category }) as Parameters<typeof splitForChange>[1][number];
  const mixed = [
    file("pd", "pending_review", "final_pd"),
    file("draft", "pending_review", "draft"),
    file("t1", "pending_review", "transcript"),
    file("t2", "pending_review", "transcript"),
    file("t3", "pending_review", "transcript"),
    file("reading", "fetched", "final_pd"),
    file("failed", "failed", "supporting"),
  ];
  const taken = (kind: Parameters<typeof splitForChange>[0]) => splitForChange(kind, mixed).taken.map((row) => row._id);

  it("sends each action only the files the shared rule lets it change", () => {
    expect(taken("category")).toEqual(["pd", "draft", "t1", "t2", "t3", "reading", "failed"]);
    expect(taken("company")).toEqual(["pd", "draft", "t1", "t2", "t3", "reading", "failed"]);
    expect(taken("fiscalYearEnd")).toEqual(["pd", "draft", "t1", "t2", "t3"]);
    expect(taken("writer")).toEqual(["pd", "draft"]);
    expect(taken("pdNumber")).toEqual(["pd", "draft"]);
    expect(taken("scienceCode")).toEqual(["pd"]);
    expect(taken("delete")).toEqual(["pd", "draft", "t1", "t2", "t3", "failed"]);
  });

  it("says plainly what it left out and why, naming the files' kind when they share one", () => {
    const code = splitForChange("scienceCode", mixed.filter((row) => row.category === "transcript" || row._id === "pd"));
    expect(leftOutText(code.leftOut)).toBe("3 transcripts were left out: a science code only goes on a final PD.");
    expect(leftOutText(splitForChange("scienceCode", mixed).leftOut)).toBe(
      "4 files were left out: a science code only goes on a final PD. 1 final PD was left out: it is still being read. 1 supporting file was left out: it could not be read."
    );
    expect(leftOutText(splitForChange("writer", mixed.slice(1)).leftOut)).toBe(
      "3 transcripts were left out: a writer only goes on a final PD, draft or review copy. 1 final PD was left out: it is still being read. 1 supporting file was left out: it could not be read."
    );
    expect(leftOutText(splitForChange("pdNumber", mixed.slice(1)).leftOut)).toBe(
      "3 transcripts were left out: a PD number only goes on a final PD, draft or review copy. 1 final PD was left out: it is still being read. 1 supporting file was left out: it could not be read."
    );
    expect(leftOutText(splitForChange("delete", mixed).leftOut)).toBe("1 final PD was left out: it is still being read.");
    expect(leftOutText(splitForChange("category", mixed).leftOut)).toBe("");
  });

  it("sends the reviewer and the CRA mark only to the files they go on, on To review and Deleted (2026-11-17)", () => {
    expect(taken("reviewer")).toEqual(["pd", "draft"]);
    expect(taken("craReviewed")).toEqual(["pd"]);
    const deleted = [file("gone-pd", "deleted", "final_pd"), file("gone-draft", "rejected", "draft"), file("gone-notes", "deleted", "supporting")];
    expect(splitForChange("reviewer", deleted).taken.map((row) => row._id)).toEqual(["gone-pd", "gone-draft"]);
    expect(splitForChange("craReviewed", deleted).taken.map((row) => row._id)).toEqual(["gone-pd"]);
    expect(leftOutText(splitForChange("reviewer", mixed.slice(1)).leftOut)).toBe(
      "3 transcripts were left out: a reviewer only goes on a final PD, draft or review copy. 1 final PD was left out: it is still being read. 1 supporting file was left out: it could not be read."
    );
    expect(leftOutText(splitForChange("craReviewed", mixed.slice(0, 2)).leftOut)).toBe(
      "1 draft was left out: only a final PD is marked as reviewed by CRA."
    );
  });

  it("names the reviewer and CRA changes in plain words (2026-11-17)", () => {
    const reviewer: BarChange = { kind: "reviewer", reviewer: { kind: "name", name: "Priya Nair" }, reviewerName: "Priya Nair" };
    expect(confirmLine(reviewer, 6)).toBe("Set the reviewer to Priya Nair for 6 files");
    expect(changedText(reviewer, 1)).toBe("Reviewer set to Priya Nair for 1 file");
    expect(confirmLine({ kind: "craReviewed", reviewed: true }, 3)).toBe("Mark 3 files as reviewed by CRA");
    expect(changedText({ kind: "craReviewed", reviewed: true }, 3)).toBe("3 files marked as reviewed by CRA");
    expect(confirmLine({ kind: "craReviewed", reviewed: false }, 2)).toBe('Clear "Reviewed by CRA" on 2 files');
    expect(changedText({ kind: "craReviewed", reviewed: false }, 2)).toBe('Cleared "Reviewed by CRA" on 2 files');
  });

  it("names the files a call skipped, by reason", () => {
    const skipped = (reason: BatchResult["skipped"][number]["reason"], count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: `${reason}${index}` as FileId, reason }));
    expect(skippedText([...skipped("not_on_tab", 2), ...skipped("being_read", 1)], "review")).toBe(
      "2 files are no longer on To review. 1 file is still being read, so it cannot be deleted yet."
    );
    expect(skippedText(skipped("approved", 1), "review")).toBe("1 file is already approved.");
    expect(skippedText(skipped("not_on_tab", 1), "deleted")).toBe("1 file is no longer on Deleted.");
    expect(skippedText(skipped("removed_in_onedrive", 2), "deleted")).toBe("2 files were removed in OneDrive, so they stay on Deleted.");
    expect(skippedText(skipped("missing", 1), "review")).toBe("1 file is no longer in Import.");
    expect(skippedText([], "review")).toBe("");
  });
});

describe("checkbox names", () => {
  it("names each section and file box with its company, and a file box with its file name", () => {
    expect(sectionSelectLabel("Final PDs", "Cedarline Systems")).toBe("Select Final PDs in Cedarline Systems");
    expect(sectionSelectLabel("Unsorted", null)).toBe("Select Unsorted with no company yet");
    expect(fileSelectLabel("Site notes.pdf", "Site notes.pdf", "Halden Foods")).toBe("Select Site notes.pdf in Halden Foods");
    expect(fileSelectLabel("PD 4 Label vision check", "pd4.docx", "Cedarline Systems")).toBe(
      "Select PD 4 Label vision check (pd4.docx) in Cedarline Systems"
    );
  });
});

describe("checkState", () => {
  it("says whether every loaded file is selected, some, or none", () => {
    const selected = new Set(["a", "b"]);
    const has = (id: string) => selected.has(id);
    expect(checkState(["a", "b"], has)).toBe("all");
    expect(checkState(["a", "b", "c"], has)).toBe("some");
    expect(checkState(["c"], has)).toBe("none");
    expect(checkState([], has)).toBe("none");
  });
});

describe("the bar's words", () => {
  const year: BarChange = { kind: "fiscalYearEnd", fiscalYearEnd: Date.UTC(2025, 2, 31) };

  it("names the action on the confirm line, with the right plural", () => {
    expect(confirmLine({ kind: "category", category: "transcript" }, 6)).toBe("Move 6 files to Transcripts");
    expect(confirmLine({ kind: "category", category: "review_copy" }, 1)).toBe("Move 1 file to Review copies");
    expect(confirmLine(year, 6)).toBe("Set the year end to Mar 31, 2025 for 6 files");
    expect(confirmLine(year, 1)).toBe("Set the year end to Mar 31, 2025 for 1 file");
    expect(confirmLine({ kind: "company", company: "Halden Foods" }, 1_204)).toBe("Move 1,204 files to Halden Foods");
    expect(confirmLine({ kind: "writer", writer: { kind: "name", name: "Priya Nair" }, writerName: "Priya Nair" }, 2)).toBe("Set the writer to Priya Nair for 2 files");
    expect(confirmLine({ kind: "pdNumber", pdNumber: "12a" }, 3)).toBe("Set the PD number to 12a for 3 files");
    expect(confirmLine({ kind: "scienceCode", scienceCode: "2.02.09" }, 1)).toBe("Set the science code to 2.02.09 for 1 file");
    expect(deleteLine(6)).toBe("Delete 6 files");
    expect(deleteLine(1)).toBe("Delete 1 file");
    expect(putBackLine(3)).toBe("Put back 3 files");
  });

  it("says what was done, and how far a run got when it stopped", () => {
    expect(changedText({ kind: "category", category: "transcript" }, 6)).toBe("6 files moved to Transcripts");
    expect(changedText(year, 1)).toBe("Year end set to Mar 31, 2025 for 1 file");
    expect(changedText({ kind: "writer", writer: { kind: "name", name: "Sam Okafor" }, writerName: "Sam Okafor" }, 3)).toBe("Writer set to Sam Okafor for 3 files");
    expect(changedText({ kind: "pdNumber", pdNumber: "4" }, 1)).toBe("PD number set to 4 for 1 file");
    expect(deletedText(1)).toBe("1 file deleted");
    expect(deletedText(6)).toBe("6 files deleted");
    expect(putBackText(1)).toBe("1 file put back");
    // In the bar, the rest stay selected.
    expect(stoppedText("Changed", 100, 250, "Pick a fiscal year end date.", 150)).toBe(
      "Changed 100 of 250 files. 150 are still selected. Pick a fiscal year end date."
    );
    expect(stoppedText("Deleted", 100, 101, "No.", 1)).toBe("Deleted 100 of 101 files. 1 is still selected. No.");
    // A row's menu or an Undo: nothing is selected, so it says what did not happen.
    expect(stoppedText("Put back", 100, 150, "Try again.")).toBe("Put back 100 of 150 files. The other 50 were not put back. Try again.");
    expect(stoppedText("Deleted", 2, 3, "Try again.")).toBe("Deleted 2 of 3 files. The other 1 was not deleted. Try again.");
    expect(stoppedText("Changed", 0, 6, "Only the reason.")).toBe("Only the reason.");
  });

  it("sends each change as its own label", () => {
    expect(changePatch({ kind: "category", category: "draft" })).toEqual({ category: "draft" });
    expect(changePatch(year)).toEqual({ fiscalYearEnd: Date.UTC(2025, 2, 31) });
    expect(changePatch({ kind: "company", company: "Northgate Labs" })).toEqual({ company: "Northgate Labs" });
    expect(changePatch({ kind: "pdNumber", pdNumber: "7" })).toEqual({ pdNumber: "7" });
    const jordan = { kind: "name" as const, name: "Jordan Ellis" };
    expect(changePatch({ kind: "writer", writer: jordan, writerName: "Jordan Ellis" })).toEqual({ writer: jordan });
    expect(changePatch({ kind: "scienceCode", scienceCode: "1.02.02" })).toEqual({ scienceCode: "1.02.02" });
  });

  it("names the choices and why a file is on Deleted, with plain hyphens only", () => {
    expect(MOVE_CATEGORIES.map((entry) => entry.label)).toEqual([
      "Final PD",
      "Draft",
      "Review copy",
      "Transcript",
      "Supporting file",
      "Company file",
    ]);
    expect(VERSION_CODES.map((entry) => entry.label)).toEqual(["T - to be submitted", "S - submitted", "R - in review"]);
    expect(deletedReasonText("deleted")).toBe("Deleted in Import");
    expect(deletedReasonText("removed_in_onedrive")).toBe("Removed in OneDrive");
    expect(deletedReasonText("rejected")).toBe("Rejected");
    expect(deletedReasonText(undefined)).toBeNull();
    for (const words of [...VERSION_CODES.map((entry) => entry.label), confirmLine(year, 2)]) {
      expect(words).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("writers from initials (2026-11-12, 2026-11-16)", () => {
  it("asks a person to choose a writer in two words, with no initials in them", () => {
    expect(CHOOSE_WRITER).toBe("Choose writer");
  });

  it("says who the initials are, on how many files, and when more are still to follow", () => {
    expect(writerMatchedText("KT", "Kim Tran", 9, false)).toBe("KT is Kim Tran on 9 files");
    expect(writerMatchedText("KT", "Kim Tran", 1, false)).toBe("KT is Kim Tran on 1 file");
    expect(writerMatchedText("KT", "Kim Tran", 100, true)).toBe("KT is Kim Tran on 100 files so far");
    expect(writerMatchedText("KT", "Kim Tran", 0, false)).toBe("KT is Kim Tran");
  });
});

import { describe, expect, it } from "vitest";
import {
  companyFolderPaths,
  dragFileCount,
  dropBarText,
  historyCount,
  historyWho,
  intakeVerdict,
  leftOutText,
  sortIntake,
  SPOKEN_COUNT_PACE_MS,
  SPOKEN_SOON_MS,
  spokenDueAt,
  statusLine,
  walkDrop,
  type ActivityBatch,
  type DropEntry,
  type LocalSending,
} from "./importIntake";
import { newCountText, notSortedNote, otherCompaniesText } from "./importFormat";

/** A File of `size` bytes. */
function file(name: string, size = 10): File {
  return new File([new Uint8Array(size)], name);
}

/** A dropped folder or file, as the browser's entry API gives it. */
function fileEntry(fullPath: string, size = 10): DropEntry {
  const name = fullPath.split("/").pop()!;
  return { isFile: true, isDirectory: false, name, fullPath, file: (ok) => ok(file(name, size)) };
}
function folderEntry(fullPath: string, children: DropEntry[], pageSize = 100): DropEntry {
  const name = fullPath.split("/").pop()!;
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath,
    createReader: () => {
      let at = 0;
      // Like the browser: up to pageSize entries a call, then an empty call.
      return {
        readEntries: (ok) => {
          const page = children.slice(at, at + pageSize);
          at += page.length;
          ok(page);
        },
      };
    },
  };
}

describe("what a drop brings in", () => {
  it("walks folders, keeping each path from the dropped folder, and reads past a folder's first hundred", async () => {
    const many = Array.from({ length: 150 }, (_, index) => fileEntry(`/Halden Foods/2025/Supporting/file ${index}.pdf`));
    const files = await walkDrop([
      folderEntry("/Halden Foods", [
        folderEntry("/Halden Foods/2025", [
          folderEntry("/Halden Foods/2025/Submitted", [fileEntry("/Halden Foods/2025/Submitted/04 HaldenFoods 2025-06-30 T1.SO Proofing.docx")]),
          folderEntry("/Halden Foods/2025/Supporting", many),
        ]),
        // A hidden folder is not walked.
        folderEntry("/Halden Foods/.git", [fileEntry("/Halden Foods/.git/config.txt")]),
      ]),
      fileEntry("/loose notes.txt"),
    ]);
    expect(files).toHaveLength(152);
    expect(files.map((entry) => entry.path)).toContain("Halden Foods/2025/Submitted/04 HaldenFoods 2025-06-30 T1.SO Proofing.docx");
    expect(files.map((entry) => entry.path)).toContain("Halden Foods/2025/Supporting/file 149.pdf");
    expect(files.map((entry) => entry.path)).toContain("loose notes.txt");
    expect(files.some((entry) => entry.path.includes(".git"))).toBe(false);
  });

  it("leaves out junk, empty files, types Banhall does not read and files over 15 MB, with the upload route's rules", () => {
    expect(intakeVerdict("Halden Foods/2025/.DS_Store", 10)).toBe("junk");
    expect(intakeVerdict("Halden Foods/2025/Thumbs.db", 10)).toBe("junk");
    expect(intakeVerdict("Halden Foods/2025/~$Proofing.docx", 10)).toBe("junk");
    expect(intakeVerdict("Halden Foods/.hidden/notes.docx", 10)).toBe("junk");
    expect(intakeVerdict("Halden Foods/2025/notes.docx", 0)).toBe("empty");
    expect(intakeVerdict("Halden Foods/2025/budget.xlsx", 10)).toBe("type");
    expect(intakeVerdict("Halden Foods/2025/scan.pdf", 15 * 1024 * 1024 + 1)).toBe("size");
    for (const name of ["a.docx", "a.doc", "a.PDF", "a.txt", "a.vtt"]) expect(intakeVerdict(`X/${name}`, 10), name).toBe("add");

    const sorted = sortIntake([
      { file: file("a.docx"), path: "Halden Foods/2025/a.docx" },
      { file: file("a.docx", 20), path: "Halden Foods/2025/a.docx" },
      { file: file("b.xlsx"), path: "Halden Foods/2025/b.xlsx" },
      { file: file("c.xlsx"), path: "c.xlsx" },
      { file: file(".DS_Store"), path: "Halden Foods/.DS_Store" },
      { file: file("e.docx", 0), path: "e.docx" },
      { file: file("x.docx"), path: "../.." },
    ]);
    // Two files with one path both go in: only their bytes can tell whether they are one file.
    expect(sorted.add.map((entry) => [entry.path, entry.file.size])).toEqual([
      ["Halden Foods/2025/a.docx", 10],
      ["Halden Foods/2025/a.docx", 20],
    ]);
    expect(sorted.leftOut).toEqual({ junk: 2, type: 2, size: 0, empty: 1 });
    // Junk is left out without a word; the rest is said plainly.
    expect(leftOutText(sorted.leftOut)).toBe("3 files were left out: 2 are not a type Banhall reads, 1 is empty.");
    expect(leftOutText({ junk: 4, type: 0, size: 0, empty: 0 })).toBeNull();
    expect(leftOutText({ junk: 0, type: 0, size: 1, empty: 0 })).toBe("1 file was left out: 1 is over 15 MB.");
  });
});

describe("a dropped folder: one company, or a folder of companies", () => {
  const paths = (list: string[]) => companyFolderPaths(list.map((path) => ({ file: file(path.split("/").pop()!), path }))).map((entry) => entry.path);

  it("keeps a company folder's paths: its fiscal year folders sit one level below it", () => {
    const company = [
      "Halden Foods/2025 - Mar 31/Submitted/02 HaldenFoods 2025-03-31 S1.SO Fermentation.docx",
      "Halden Foods/2024 - Mar 31/WIP/Audio/Interview.vtt",
      "Halden Foods/Company docs/Engagement letter.pdf",
      "Halden Foods/Overview.docx",
    ];
    expect(paths(company)).toEqual(company);
  });

  it("takes a folder of three companies off every path: their fiscal year folders sit two levels below it", () => {
    expect(
      paths([
        "Clients/Halden Foods/2025 - Mar 31/Submitted/PD.docx",
        "Clients/Cedarline Systems/2025 - Dec 31/Drafts/plan.docx",
        "Clients/Cedarline Systems/Company docs/Org chart.pdf",
        "Clients/Northgate Labs/FY 2024/Audio/Kickoff.vtt",
        "Clients/Read me.txt",
      ])
    ).toEqual([
      "Halden Foods/2025 - Mar 31/Submitted/PD.docx",
      "Cedarline Systems/2025 - Dec 31/Drafts/plan.docx",
      "Cedarline Systems/Company docs/Org chart.pdf",
      "Northgate Labs/FY 2024/Audio/Kickoff.vtt",
      "Read me.txt",
    ]);
    // Through sortIntake too, which the drop and Add files both go through.
    const sorted = sortIntake([{ file: file("PD.docx"), path: "Clients/Halden Foods/2025 - Mar 31/Submitted/PD.docx" }]);
    expect(sorted.add.map((entry) => entry.path)).toEqual(["Halden Foods/2025 - Mar 31/Submitted/PD.docx"]);
  });

  it("reads each dropped folder on its own in a mix, and the level with more fiscal year folders wins inside one", () => {
    expect(
      paths([
        // A company folder, a folder of companies and a loose file, dropped together.
        "Halden Foods/2025 - Mar 31/Submitted/PD.docx",
        "Clients/Cedarline Systems/2025 - Dec 31/Drafts/plan.docx",
        "Clients/Northgate Labs/2024 - Sep 30/Drafts/notes.docx",
        // A year-like folder beside the companies does not outvote them.
        "Clients/2023 archive/old.docx",
        "loose notes.txt",
      ])
    ).toEqual([
      "Halden Foods/2025 - Mar 31/Submitted/PD.docx",
      "Cedarline Systems/2025 - Dec 31/Drafts/plan.docx",
      "Northgate Labs/2024 - Sep 30/Drafts/notes.docx",
      "2023 archive/old.docx",
      "loose notes.txt",
    ]);
    // One fiscal year folder below and one company-like folder: a tie keeps the paths.
    const tie = ["Halden Foods/2025 - Mar 31/Submitted/PD.docx", "Halden Foods/Engagement/2023 letter/letter.pdf"];
    expect(paths(tie)).toEqual(tie);
  });

  it("keeps the paths of a folder with no fiscal year folders, and of loose files", () => {
    const noYears = ["Halden Foods/Drafts/plan.docx", "Halden Foods/Company docs/Org chart.pdf", "Halden Foods/notes.txt"];
    expect(paths(noYears)).toEqual(noYears);
    const loose = ["Report.docx", "Interview.vtt", "Report 2025.pdf"];
    expect(paths(loose)).toEqual(loose);
  });
});

describe("the dark bar while files are dragged over the page", () => {
  const transfer = (types: string[]) =>
    ({ items: types.map((type) => ({ kind: "file", type })), types: ["Files"] }) as unknown as DataTransfer;

  it("counts the files only when it can tell what they are, since a folder cannot be opened while dragging", () => {
    expect(dragFileCount(transfer(["application/pdf", "application/pdf", "text/plain"]))).toBe(3);
    // A folder looks like a file with no type.
    expect(dragFileCount(transfer(["application/pdf", ""]))).toBeNull();
    expect(dragFileCount(transfer(["image/png"]))).toBeNull();
    expect(dropBarText(64)).toBe("Drop to add 64 files");
    expect(dropBarText(1)).toBe("Drop to add 1 file");
    expect(dropBarText(null)).toBe("Drop to add these files");
  });
});

describe("the status line under the toolbar", () => {
  const NOW = Date.UTC(2026, 10, 12, 9, 0);
  const batch = (extra: Partial<ActivityBatch>): ActivityBatch =>
    ({
      _id: "b1",
      source: "page",
      mine: true,
      addedByName: "Jordan Ellis",
      startedAt: NOW - 60_000,
      lastFileAt: NOW - 10_000,
      sendingDone: true,
      added: 52,
      alreadyHere: 0,
      failed: 0,
      read: 31,
      couldNotRead: 0,
      ...extra,
    }) as ActivityBatch;
  const local = (extra: Partial<LocalSending>): LocalSending => ({
    batchId: "b1",
    phase: "done",
    checking: 0,
    checked: 0,
    toSend: 0,
    sent: 0,
    failed: 0,
    ...extra,
  });
  const text = (...args: Parameters<typeof statusLine>) => statusLine(...args)?.text ?? null;

  it("says what this person's own files are doing, as drawn", () => {
    expect(text(null, [batch({})], NOW)).toBe("52 files added. 31 read so far.");
    expect(text(null, [batch({ alreadyHere: 12 })], NOW)).toBe("52 files added, 12 were already here. 31 read so far.");
    expect(text(null, [batch({ alreadyHere: 1, added: 1, read: 0 })], NOW)).toBe("1 file added, 1 was already here. 0 read so far.");
    expect(text(null, [batch({ added: 0, read: 0, alreadyHere: 12 })], NOW)).toBe("No new files. 12 files were already here.");
    expect(text(null, [batch({ read: 52, lastReadAt: NOW - 5_000 })], NOW)).toBe("52 files added. All read.");
    // A short while after every file is read, the line goes.
    expect(text(null, [batch({ read: 52, lastReadAt: NOW - 120_000, lastFileAt: NOW - 300_000 })], NOW)).toBeNull();
  });

  it("says what this tab is checking and sending, in the same line", () => {
    expect(text(local({ phase: "checking", checking: 64, checked: 20 }), [], NOW)).toBe("Checking 64 files. 20 checked so far.");
    expect(text(local({ phase: "sending", toSend: 64, sent: 20 }), [], NOW)).toBe("Sending 64 files. 20 sent so far.");
    // Another tab of the same person, from the server.
    expect(text(null, [batch({ sendingDone: false, toSend: 64, added: 20, read: 0 })], NOW)).toBe("Sending 64 files. 20 sent so far.");
  });

  it("says how many could not be sent, and offers Try again only where the files are", () => {
    const here = statusLine(local({ failed: 3 }), [batch({ failed: 3 })], NOW);
    expect(here).toEqual({ text: "52 files added. 31 read so far. 3 could not be sent.", retry: true });
    const elsewhere = statusLine(null, [batch({ failed: 3 })], NOW);
    expect(elsewhere).toEqual({ text: "52 files added. 31 read so far. 3 could not be sent.", retry: false });
    // Try again stays while the tab holds the files, even once the rest is read.
    expect(statusLine(local({ failed: 3 }), [batch({ failed: 3, read: 52, lastReadAt: NOW - 600_000, lastFileAt: NOW - 600_000 })], NOW)).toEqual({
      text: "52 files added. All read. 3 could not be sent.",
      retry: true,
    });
  });

  it("says when someone else is uploading, by name and total", () => {
    const theirs = batch({ mine: false, addedByName: "Sam Okafor", sendingDone: false, toSend: 412, added: 180, read: 90 });
    expect(text(null, [theirs], NOW)).toBe("Sam Okafor is uploading 412 files. 180 here so far.");
    expect(text(null, [{ ...theirs, sendingDone: true, added: 412, read: 300 }], NOW)).toBe("Sam Okafor added 412 files. 300 read so far.");
    // A send nobody finished (its tab closed) is not shown for ever.
    expect(text(null, [{ ...theirs, lastFileAt: NOW - 11 * 60_000 }], NOW)).toBeNull();
  });

  it("says the uploader is sending without a name or total, which it does not give", () => {
    const uploader = batch({ source: "uploader", mine: false, addedByName: null, added: 180, read: 120, lastFileAt: NOW - 30_000 });
    expect(text(null, [uploader], NOW)).toBe("The uploader is sending files. 180 here so far.");
    expect(text(null, [{ ...uploader, lastFileAt: NOW - 5 * 60_000 }], NOW)).toBe("The uploader sent 180 files. 120 read so far.");
    expect(text(null, [{ ...uploader, lastFileAt: NOW - 5 * 60_000, read: 180, lastReadAt: NOW - 5 * 60_000 }], NOW)).toBeNull();
    expect(text(null, [batch({ source: "onedrive", mine: true, added: 40, read: 0, lastFileAt: NOW - 10_000 })], NOW)).toBe(
      "OneDrive is syncing. 40 here so far."
    );
  });

  it("puts this tab first, then the person's own batch, then others'", () => {
    const uploader = batch({ _id: "u" as ActivityBatch["_id"], source: "uploader", mine: false, added: 5, read: 0, lastFileAt: NOW - 1_000 });
    const mine = batch({});
    expect(text(null, [uploader, mine], NOW)).toBe("52 files added. 31 read so far.");
    expect(text(local({ phase: "sending", toSend: 3, sent: 1 }), [uploader, mine], NOW)).toBe("Sending 3 files. 1 sent so far.");
    expect(text(null, [], NOW)).toBeNull();
  });

  it("is heard soon when its sentence changes, and at most once a minute when only a count moves", () => {
    expect(spokenDueAt("", 0, "Checking 64 files. 0 checked so far.", NOW)).toBe(NOW + SPOKEN_SOON_MS);
    expect(spokenDueAt("Checking 64 files. 63 checked so far.", NOW - 5_000, "Sending 64 files. 0 sent so far.", NOW)).toBe(NOW + SPOKEN_SOON_MS);
    expect(spokenDueAt("52 files added. 51 read so far.", NOW - 5_000, "52 files added. All read.", NOW)).toBe(NOW + SPOKEN_SOON_MS);
    // A count alone: a minute after the last words were spoken.
    expect(spokenDueAt("Sending 64 files. 20 sent so far.", NOW - 5_000, "Sending 64 files. 21 sent so far.", NOW)).toBe(NOW - 5_000 + SPOKEN_COUNT_PACE_MS);
    expect(spokenDueAt("Sending 1,204 files. 20 sent so far.", NOW - 90_000, "Sending 1,204 files. 1,100 sent so far.", NOW)).toBe(NOW + SPOKEN_SOON_MS);
    // Nothing on screen any more, or nothing new: cleared soon, or nothing to do.
    expect(spokenDueAt("52 files added. All read.", NOW - 5_000, "", NOW)).toBe(NOW + SPOKEN_SOON_MS);
    expect(spokenDueAt("52 files added. All read.", NOW - 5_000, "52 files added. All read.", NOW)).toBeNull();
  });
});

describe("New, Not sorted yet and History words", () => {
  it("says them plainly", () => {
    expect(newCountText(52)).toBe("52 new");
    expect(otherCompaniesText(6)).toBe("The other 6 companies have no new files.");
    expect(otherCompaniesText(1)).toBe("The other company has no new files.");
    expect(otherCompaniesText(0)).toBeNull();
    expect(notSortedNote(21, 21)).toBe("Each file moves to its category once Banhall has read it");
    expect(notSortedNote(3, 0)).toBe("Banhall could not tell what these files are");
    expect(notSortedNote(5, 2)).toBe("Files being read move to their category once Banhall has read them");
    expect(historyWho({ who: null, source: "uploader" })).toBe("Not recorded");
    expect(historyWho({ who: "Priya Nair", source: "page" })).toBe("Priya Nair");
    expect(historyCount(null)).toBe("Not counted");
    expect(historyCount(1204)).toBe("1,204");
  });
});

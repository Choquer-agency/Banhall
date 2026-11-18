import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  extensionLabel,
  formatReport,
  isInside,
  namePattern,
  outRefusal,
  parseArgs,
  runDryRun,
  sizeStats,
  versionInitialsGroups,
  walkFolder,
  type DryRunReport,
  type WalkIo,
} from "../scripts/import-dry-run/dryRun";

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");

/** A Word file whose body is this WordprocessingML (as convex/ai/fileReader.test.ts builds one). */
async function docxBody(body: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  return await zip.generateAsync({ type: "uint8array" });
}

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;

/** A sentence from the made-up files: it must never reach the report. */
const SECRET_SENTENCE = "The seal held at 4.2 bar in the third trial";

/** Made-up client and person names in the fixture's paths and text. */
const MADE_UP_NAMES = ["Cedarline", "CedarlineSystems", "Halden", "HaldenFoods", "Dana", "Whitlock", "Priya", "Nair", "Sam", "Okafor", "Kim", "Tran"];

let folder: string;
let scratch: string;

async function put(relPath: string, bytes: Uint8Array | string): Promise<void> {
  const file = path.join(folder, ...relPath.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      const stat = statSync(file, { throwIfNoEntry: false });
      return `${path.relative(dir, file)} ${stat?.size ?? "link"} ${stat?.mtimeMs ?? ""}`;
    })
    .sort();
}

beforeAll(async () => {
  scratch = mkdtempSync(path.join(tmpdir(), "import-dry-run-"));
  folder = path.join(scratch, "Applications");
  mkdirSync(folder);
  const year = "Cedarline Systems/2025 - Mar 31";
  const dwPd = await docxBody(
    paragraph("Cold chain sensor drift") +
      `<w:tbl><w:tr>${cell("Prepared by:")}${cell("Dana Whitlock")}</w:tr><w:tr>${cell("Reviewed by:")}${cell("Sam Okafor")}</w:tr></w:tbl>` +
      paragraph(SECRET_SENTENCE)
  );
  // Final PDs: two scheme-named (DW, and PN reviewed by SO), one not.
  await put(`${year}/Submitted/04 CedarlineSystems 2025-03-31 T1.DW Project4.docx`, dwPd);
  await put(
    `${year}/Submitted/05 CedarlineSystems 2025-03-31 R2.PN.SO Sensors.docx`,
    await docxBody(paragraph("Written by Priya Nair") + paragraph("Sensor housing trials, a longer text than the other one."))
  );
  await put(`${year}/Submitted/Cedarline Systems PD 2 final Priya Nair.docx`, await docxBody(paragraph("Author: Kim Tran")));
  // A version token with three initials groups, which the scheme does not read.
  await put(`${year}/Submitted/06 Cedarline Systems 2025-03-31 T0.DW.PN.SO Seals.docx`, await docxBody(paragraph("Prepared by Dana Whitlock")));
  // A draft with the same bytes as the DW final PD, with a version token.
  await put(`${year}/Drafts/04 CedarlineSystems 2025-03-31 R1.DW Project4.docx`, dwPd);
  await put(`${year}/In Review/notes for Sam Okafor.txt`, `${SECRET_SENTENCE}.`);
  await put(`${year}/WIP/Technical/Audio/interview Kim Tran.txt`, "Interviewer: what changed in the second trial?");
  await put(`${year}/Financials/claim.docx`, "not really a Word file");
  // Halden Foods: a company file, a final PD whose year folder has no year, a legacy .doc.
  await put("Halden Foods/Company profile.docx", await docxBody(paragraph("Halden Foods makes frozen meals.")));
  await put("Halden Foods/Fiscal Year Halden/Submitted/HaldenFoods Sam Okafor PD.docx", await docxBody(paragraph("No writer cue here.")));
  await put("Halden Foods/2024/old notes.doc", "legacy");
  await put("Halden Foods/2024/online only.pdf", "pretend this is online only");
  // Left out: loose file with no client folder is still imported (unknown); the rest are not.
  await put("loose notes.txt", "A loose file.");
  await put(".DS_Store", "x");
  await put(`${year}/Submitted/~$04 CedarlineSystems.docx`, "lock");
  await put(`${year}/photo of Dana Whitlock.png`, "png");
  await put(`${year}/budget.whitlock`, "a type named after a person");
  await put(`${year}/empty.txt`, "");
  symlinkSync(path.join(folder, "loose notes.txt"), path.join(folder, "link to notes.txt"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function expectNoMadeUpNames(output: string): void {
  for (const name of MADE_UP_NAMES) {
    expect(output, name).not.toMatch(new RegExp(`\\b${name}\\b`, "i"));
  }
  expect(output).not.toContain(SECRET_SENTENCE);
  expect(output).not.toContain("Cold chain");
  expect(output).not.toContain(folder);
}

describe("import dry run", () => {
  let report: DryRunReport;

  beforeAll(async () => {
    const before = snapshot(folder);
    report = await runDryRun(folder, {
      readText: true,
      platform: "darwin",
      isLocal: (absolutePath) => !absolutePath.endsWith("online only.pdf"),
    });
    // Read-only: no file in the folder was added, removed or changed.
    expect(snapshot(folder)).toEqual(before);
  });

  it("counts files, categories, companies and fiscal years with the server's classifier", () => {
    expect(report.files).toEqual({
      seen: 18,
      linksSkipped: 1,
      foldersNotOpened: 0,
      filesNotOpened: 0,
      systemOrHidden: 2,
      looseTopLevel: 1,
      typeNotImported: 2,
      typeNotImportedByExtension: { ".png": 1, other: 1 },
      empty: 1,
      tooLarge: 0,
      pathRefused: 0,
      wouldImport: 11,
      onlineOnly: 1,
    });
    expect(report.byCategory).toEqual({
      final_pd: 5,
      draft: 1,
      review_copy: 1,
      transcript: 1,
      supporting: 3,
      company_file: 1,
      unknown: 0,
    });
    expect(report.company).toEqual({ found: 12, notFound: 0, distinctCompanies: 2, companyYearGroups: 2 });
    expect(report.fiscalYear).toEqual({ found: 10, folderWithoutYear: 1, noFolder: 1, yearEndDayAssumed: 2 });
    expect(report.warnings).toEqual([]);
  });

  it("counts final PD names that parse, and initials only", () => {
    expect(report.finalPdNames).toEqual({
      total: 5,
      // The wider name reader (this layer) also reads a name with three or
      // more initials groups: it parses, with no writer or reviewer set.
      parses: 3,
      doesNotParse: 2,
      withVersion: 3,
      withWriterInitials: 2,
      withReviewerInitials: 1,
      withFiscalYearEnd: 3,
      withPdNumber: 3,
      byInitialsGroups: { "0": 2, "1": 1, "2": 1, "3": 1 },
    });
    expect(report.longVersionInitials).toEqual({ firstGroup: { DW: 1 }, laterGroups: { PN: 1, SO: 1 } });
    expect(report.draftAndReviewNames).toEqual({ total: 2, withVersion: 1 });
    expect(report.writerInitials).toEqual({ DW: 2, PN: 1 });
    expect(report.reviewerInitials).toEqual({ SO: 1 });
    expect(report.unparsedFinalPdPatterns).toEqual([
      { pattern: "Word Word PD 2 final Word Word.docx", count: 1 },
      { pattern: "WordWord Word Word PD.docx", count: 1 },
    ]);
  });

  it("reads text with the import's reader: writer names that fit the initials, sizes, duplicates, failures", () => {
    expect(report.writerNames).toEqual({
      finalPd: { withInitials: 2, textNameMatches: 2, textNamesNoMatch: 0, noTextName: 0, notRead: 0 },
      draftOrReview: { withInitials: 1, textNameMatches: 1, textNamesNoMatch: 0, noTextName: 0, notRead: 0 },
    });
    expect(report.text).toMatchObject({
      read: 9,
      noText: { "legacy .doc (not read)": 1 },
      couldNotRead: { "the reader failed (damaged or protected)": 1 },
      sameTextGroups: 1,
      filesInSameTextGroups: 2,
      sameBytesGroups: 1,
      filesInSameBytesGroups: 2,
    });
    expect(report.text?.finalPdTextChars).toMatchObject({ count: 5 });
  });

  it("prints counts and placeholders, never a made-up client or person name or any file text", () => {
    const output = formatReport(report);
    expect(output.split("\n")[1]).toMatch(/^Privacy: .*no client names and no person names/);
    expect(output).toContain("Final PD: 5");
    expect(output).toContain("would be imported, online only (not opened): 1");
    expect(output).toContain("by initials groups in the version token (such as T1.AA.BB): 0 2, 1 1, 2 1, 3 1");
    expect(output).toContain("writer: DW 2, PN 1");
    expectNoMadeUpNames(output);
    expectNoMadeUpNames(JSON.stringify(report));
  });

  it("skips text with --no-text", async () => {
    const names = await runDryRun(folder, { readText: false, platform: "darwin", isLocal: () => true });
    expect(names.text).toBeNull();
    expect(names.writerNames).toBeNull();
    expect(names.byCategory.final_pd).toBe(5);
    expect(formatReport(names)).toContain("Text: not read");
  });

  it("on Windows reads no text when PowerShell cannot say which files are local, and says so at the top", async () => {
    const before = snapshot(folder);
    const closed = await runDryRun(folder, { readText: true, platform: "win32", listLocalFiles: async () => null });
    expect(closed.readText).toBe(false);
    expect(closed.text).toBeNull();
    expect(closed.files.onlineOnly).toBe(12);
    expect(closed.files.wouldImport).toBe(0);
    const lines = formatReport(closed).split("\n");
    expect(lines[3]).toMatch(/^Warning: Text was not read: PowerShell could not tell/);
    expect(lines.indexOf("Files")).toBeGreaterThan(3);
    expect(snapshot(folder)).toEqual(before);
  });

  it("on Windows reads only the files PowerShell lists as on this computer", async () => {
    const local = path.join(folder, "Cedarline Systems", "2025 - Mar 31", "Submitted", "04 CedarlineSystems 2025-03-31 T1.DW Project4.docx");
    const one = await runDryRun(folder, { readText: true, platform: "win32", listLocalFiles: async () => new Set([local.toLowerCase()]) });
    expect(one.files).toMatchObject({ wouldImport: 1, onlineOnly: 11 });
    expect(one.text?.read).toBe(1);
    expect(one.warnings).toEqual([]);
  });

  it("warns when the folder looks like the wrong level", async () => {
    const company = await runDryRun(path.join(folder, "Cedarline Systems"), { readText: false, platform: "darwin", isLocal: () => true });
    expect(company.warnings.join(" ")).toMatch(/looks like one company's folder/);
    const above = await runDryRun(scratch, { readText: false, platform: "darwin", isLocal: () => true });
    expect(above.warnings.join(" ")).toMatch(/looks like the one above the client folders/);
    for (const warning of [...company.warnings, ...above.warnings]) expectNoMadeUpNames(warning);
  });
});

describe("import dry run helpers", () => {
  it("replaces every word of a name pattern and keeps digits and scheme words", () => {
    expect(namePattern("Cedarline Systems PD 2 final.docx")).toBe("Word Word PD 2 final.docx");
    expect(namePattern("03 CedarlineSystems 2025-03-31 R1.DW.PN Title.docx")).toBe("03 WordWord 2025-03-31 R1.AA.AA Word.docx");
    expect(namePattern("HALDEN FOODS draft v3 (dana).pdf")).toBe("WORD WORD draft v3 (word).pdf");
    // Words with decomposed accents stay one word.
    expect(namePattern("Jose\u0301 Nu\u0301n\u0303ez PD.docx")).toBe("Word Word PD.docx");
  });

  it("keeps only 1 and 2 digit numbers, years and dates; other digit runs become #", () => {
    expect(namePattern("1234567 Ontario Inc PD 2 final.docx")).toBe("####### Word Word PD 2 final.docx");
    expect(namePattern("Call 604-555-2012 Dana.docx")).toBe("Word ###-###-#### Word.docx");
    expect(namePattern("Account 2012.3344 PD.docx")).toBe("Word ####.#### PD.docx");
    expect(namePattern("FY2025 Dana 2025-03-31 R12 final 2024.docx")).toBe("FY2025 Word 2025-03-31 R12 final 2024.docx");
    expect(namePattern("2025-13-01 Plan 123.docx")).toBe("####-##-## Word ###.docx");
  });

  it("hides every digit of a number written in groups, Unicode digits too (Greptile on #40)", () => {
    expect(namePattern("Client 06 12 34 56 78.docx")).toBe("Word ## ## ## ## ##.docx");
    expect(namePattern("Dana (416) 555 0199 PD.docx")).toBe("Word (###) ### #### PD.docx");
    // Groups next to each other are never kept, even when one looks like a year or a date.
    expect(namePattern("PD 2 2025-03-31.docx")).toBe("PD # ####-##-##.docx");
    // Non-ASCII digits are always hidden.
    expect(namePattern("Halden \u0661\u0662 PD.docx")).toBe("Word ## PD.docx");
    expect(namePattern("Halden \u0661\u0662\u0663\u0664\u0665 PD.docx")).toBe("Word ##### PD.docx");
  });

  it("names only known file types; any other extension is other", () => {
    expect(extensionLabel("budget.xlsx")).toBe(".xlsx");
    expect(extensionLabel("notes.whitlock")).toBe("other");
    expect(extensionLabel("no extension")).toBe("other");
  });

  it("reads the initials groups of a version token", () => {
    expect(versionInitialsGroups("06 Cedarline 2025-03-31 T0.dw.PN.SO.KT Seals.docx")).toEqual(["DW", "PN", "SO", "KT"]);
    expect(versionInitialsGroups("04 Cedarline 2025-03-31 T1.DW.docx")).toEqual(["DW"]);
    expect(versionInitialsGroups("Cedarline PD final.docx")).toBeNull();
  });

  it("decides file or folder with lstat when readdir calls an entry a link, and never follows a real link", async () => {
    // As Windows readdir reports OneDrive placeholders: every reparse point looks like a link.
    const dirent = (name: string) => ({ name, isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true });
    const stat = (kind: "file" | "folder" | "link") => ({
      isFile: () => kind === "file",
      isDirectory: () => kind === "folder",
      isSymbolicLink: () => kind === "link",
    });
    const tree: Record<string, string[]> = {
      [path.join("/r")]: ["Placeholder folder", "real link", "broken"],
      [path.join("/r", "Placeholder folder")]: ["placeholder.docx"],
    };
    const kinds: Record<string, "file" | "folder" | "link"> = {
      [path.join("/r", "Placeholder folder")]: "folder",
      [path.join("/r", "Placeholder folder", "placeholder.docx")]: "file",
      [path.join("/r", "real link")]: "link",
    };
    const io: WalkIo = {
      readdir: async (dir) => (tree[dir] ?? []).map(dirent),
      lstat: async (file) => {
        if (!(file in kinds)) throw Object.assign(new Error("gone"), { code: "ENOENT" });
        return stat(kinds[file]);
      },
    };
    const visited: string[] = [];
    for (const platform of ["win32", "darwin"] as const) {
      visited.length = 0;
      const counts = await walkFolder(path.join("/r"), async (file) => void visited.push(file), { io, platform });
      expect(visited).toEqual([path.join("/r", "Placeholder folder", "placeholder.docx")]);
      expect(counts).toEqual({ links: 1, foldersNotOpened: 0, entriesNotOpened: 1 });
    }
  });

  it("parses arguments and refuses an --out inside the folder", () => {
    expect(parseArgs(["/x", "--no-text", "--out", "r.json"])).toEqual({ folder: "/x", readText: false, out: "r.json", help: false });
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["/x", "--out=r.json"]).out).toBe("r.json");
    expect(() => parseArgs(["--nope"])).toThrow(/unknown option/);
    expect(() => parseArgs(["/a", "/b"])).toThrow(/one folder/);
    expect(isInside("/a/b", "/a/b/c.json")).toBe(true);
    expect(isInside("/a/b", "/a/c.json")).toBe(false);
    // A name that only starts with two dots is still inside (Greptile on #40).
    expect(isInside("/a/b", "/a/b/..report.json")).toBe(true);
    expect(isInside("/a/b", "/a/b/..")).toBe(false);
  });

  it("refuses an --out inside the folder through a link, and an existing file", () => {
    const alias = path.join(scratch, "alias");
    symlinkSync(folder, alias);
    try {
      expect(outRefusal(folder, path.join(alias, "r.json"))).toMatch(/outside the folder/);
      expect(outRefusal(alias, path.join(folder, "r.json"))).toMatch(/outside the folder/);
      writeFileSync(path.join(scratch, "taken.json"), "{}");
      expect(outRefusal(folder, path.join(scratch, "taken.json"))).toMatch(/already exists/);
      expect(outRefusal(folder, path.join(scratch, "new.json"))).toBeNull();
    } finally {
      rmSync(alias);
      rmSync(path.join(scratch, "taken.json"), { force: true });
    }
  });

  it("works out text size stats", () => {
    expect(sizeStats([])).toBeNull();
    expect(sizeStats([5, 1, 3, 2, 4])).toEqual({ count: 5, min: 1, median: 3, p95: 5, max: 5 });
  });
});

describe("import dry run command", () => {
  it(
    "runs from the command line, writes the JSON outside the folder and refuses one inside it",
    async () => {
      const out = path.join(scratch, "report.json");
      const before = snapshot(folder);
      const { stdout } = await run(process.execPath, ["scripts/import-dry-run.mjs", folder, "--out", out], { cwd: repoRoot });
      expect(stdout).toContain("Import dry run");
      expect(stdout).toContain("Final PD: 5");
      expectNoMadeUpNames(stdout);
      const json = JSON.parse(readFileSync(out, "utf8"));
      expect(json.byCategory.final_pd).toBe(5);
      expectNoMadeUpNames(JSON.stringify(json));
      expect(snapshot(folder)).toEqual(before);

      const refused = await run(process.execPath, ["scripts/import-dry-run.mjs", folder, "--out", path.join(folder, "r.json")], {
        cwd: repoRoot,
      }).catch((error: { code: number; stderr: string }) => error);
      expect(refused).toMatchObject({ code: 2 });
      expect((refused as { stderr: string }).stderr).toContain("--out must be outside the folder");
      expect(snapshot(folder)).toEqual(before);

      const existing = await run(process.execPath, ["scripts/import-dry-run.mjs", folder, `--out=${out}`], { cwd: repoRoot }).catch(
        (error: { code: number; stderr: string }) => error
      );
      expect(existing).toMatchObject({ code: 2 });
      expect((existing as { stderr: string }).stderr).toContain("already exists");

      const help = await run(process.execPath, ["scripts/import-dry-run.mjs", "--help"], { cwd: repoRoot });
      expect(help.stdout).toContain("Usage (from the Banhall folder, after npm ci):");
    },
    90_000
  );
});

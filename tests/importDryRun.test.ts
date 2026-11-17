import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatReport,
  isInside,
  namePattern,
  parseArgs,
  runDryRun,
  sizeStats,
  type DryRunReport,
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
      cloudOnly: (absolutePath) => absolutePath.endsWith("online only.pdf"),
    });
    // Read-only: no file in the folder was added, removed or changed.
    expect(snapshot(folder)).toEqual(before);
  });

  it("counts files, categories, companies and fiscal years with the server's classifier", () => {
    expect(report.files).toMatchObject({
      seen: 16,
      linksSkipped: 1,
      systemOrHidden: 2,
      typeNotImported: 1,
      typeNotImportedByExtension: { ".png": 1 },
      empty: 1,
      tooLarge: 0,
      wouldImport: 12,
      notDownloaded: 1,
    });
    expect(report.byCategory).toEqual({
      final_pd: 4,
      draft: 1,
      review_copy: 1,
      transcript: 1,
      supporting: 3,
      company_file: 1,
      unknown: 1,
    });
    expect(report.company).toEqual({ found: 11, notFound: 1, distinctCompanies: 2, companyYearGroups: 2 });
    expect(report.fiscalYear).toEqual({ found: 9, folderWithoutYear: 1, noFolder: 2, yearEndDayAssumed: 2 });
  });

  it("counts final PD names that parse, and initials only", () => {
    expect(report.finalPdNames).toEqual({
      total: 4,
      parses: 2,
      doesNotParse: 2,
      withVersion: 2,
      withWriterInitials: 2,
      withReviewerInitials: 1,
      withFiscalYearEnd: 2,
      withPdNumber: 2,
    });
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
    expect(report.text?.finalPdTextChars).toMatchObject({ count: 4 });
  });

  it("prints counts and placeholders, never a made-up client or person name or any file text", () => {
    const output = formatReport(report);
    expect(output.split("\n")[1]).toMatch(/^Privacy: .*no client names and no person names/);
    expect(output).toContain("Final PD: 4");
    expect(output).toContain("not downloaded (online only in OneDrive, so not opened): 1");
    expect(output).toContain("writer: DW 2, PN 1");
    expectNoMadeUpNames(output);
    expectNoMadeUpNames(JSON.stringify(report));
  });

  it("skips text with --no-text", async () => {
    const names = await runDryRun(folder, { readText: false, cloudOnly: () => false });
    expect(names.text).toBeNull();
    expect(names.writerNames).toBeNull();
    expect(names.byCategory.final_pd).toBe(4);
    expect(formatReport(names)).toContain("Text: not read (--no-text)");
  });
});

describe("import dry run helpers", () => {
  it("replaces every word of a name pattern and keeps digits and scheme words", () => {
    expect(namePattern("Cedarline Systems PD 2 final.docx")).toBe("Word Word PD 2 final.docx");
    expect(namePattern("03 CedarlineSystems 2025-03-31 R1.DW.PN Title.docx")).toBe("03 WordWord 2025-03-31 R1.AA.AA Word.docx");
    expect(namePattern("HALDEN FOODS draft v3 (dana).pdf")).toBe("WORD WORD draft v3 (word).pdf");
  });

  it("parses arguments and refuses an --out inside the folder", () => {
    expect(parseArgs(["/x", "--no-text", "--out", "r.json"])).toEqual({ folder: "/x", readText: false, out: "r.json", help: false });
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(() => parseArgs(["--nope"])).toThrow(/unknown option/);
    expect(() => parseArgs(["/a", "/b"])).toThrow(/one folder/);
    expect(isInside("/a/b", "/a/b/c.json")).toBe(true);
    expect(isInside("/a/b", "/a/c.json")).toBe(false);
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
      expect(stdout).toContain("Final PD: 4");
      expectNoMadeUpNames(stdout);
      const json = JSON.parse(readFileSync(out, "utf8"));
      expect(json.byCategory.final_pd).toBe(4);
      expectNoMadeUpNames(JSON.stringify(json));
      expect(snapshot(folder)).toEqual(before);

      const refused = await run(process.execPath, ["scripts/import-dry-run.mjs", folder, "--out", path.join(folder, "r.json")], {
        cwd: repoRoot,
      }).catch((error: { code: number; stderr: string }) => error);
      expect(refused).toMatchObject({ code: 2 });
      expect((refused as { stderr: string }).stderr).toContain("--out must be outside the folder");
      expect(snapshot(folder)).toEqual(before);

      const help = await run(process.execPath, ["scripts/import-dry-run.mjs", "--help"], { cwd: repoRoot });
      expect(help.stdout).toContain("Usage:");
    },
    90_000
  );
});

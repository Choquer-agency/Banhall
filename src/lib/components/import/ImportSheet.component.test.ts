import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ImportSheet from "./ImportSheet.svelte";
import {
  __activeQueryArgs,
  __activeQueryCount,
  __loadMoreCalls,
  __paginatedInitialSizes,
  __paginatedReloadSizes,
  __resetConvexStub,
  __setPaginatedRows,
  __setPaginatedRowsForArgs,
} from "$lib/test/convex-svelte-stub.svelte";
import { board } from "$lib/test/boardScale";

/**
 * The Import sheet (2026-11-11 phase 3a, boards ao3 and ao5): company
 * bands, their sections and file rows, read only. Made-up companies and
 * people throughout.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];
const one = (selector: string, root: ParentNode = document) => root.querySelector<HTMLElement>(selector);
const band = (key: string) => one(`[data-import-band="${key}"]`)!;
const section = (bandKey: string, category: string) => one(`[data-import-section="${category}"]`, band(bandKey))!;

const AMBER = "rgb(180, 83, 9)"; // --color-warning-ink-muted
const MAR_31_2025 = Date.UTC(2025, 2, 31);
const DEC_31_2024 = Date.UTC(2024, 11, 31);

const CEDARLINE = {
  companyKey: "cedarline systems",
  displayName: "Cedarline Systems",
  total: 223,
  needsCheck: 15,
  ready: 200,
  beingRead: 8,
  categories: {
    company_file: { total: 4, needsCheck: 0, fiscalYears: { none: 4 } },
    supporting: { total: 102, needsCheck: 3, fiscalYears: { "2025": 61, "2024": 41 }, checkReasons: { could_not_read: 2, no_text: 1 } },
    transcript: { total: 17, needsCheck: 0, fiscalYears: { "2025": 10, "2024": 7 } },
    review_copy: { total: 31, needsCheck: 0, fiscalYears: { "2025": 18, "2024": 13 } },
    draft: { total: 45, needsCheck: 0, fiscalYears: { "2025": 26, "2024": 19 } },
    final_pd: {
      total: 24,
      needsCheck: 12,
      fiscalYears: { "2025": 13, "2024": 11 },
      checkReasons: { no_science_code: 4, no_writer: 8 },
    },
  },
  company: { via: "name", clientId: "c1", name: "Cedarline Systems", industry: "Software" },
  isNew: false,
};
const HALDEN = {
  companyKey: "halden foods",
  displayName: "Halden Foods",
  total: 98,
  needsCheck: 98,
  ready: 0,
  beingRead: 0,
  categories: {
    // No reasons: a band row from before they were counted.
    transcript: { total: 6, needsCheck: 6, fiscalYears: { "2025": 4, "2024": 2 } },
    final_pd: { total: 4, needsCheck: 4, fiscalYears: { "2025": 3, "2024": 1 }, checkReasons: { no_science_code: 4 } },
    supporting: { total: 88, needsCheck: 88, fiscalYears: { "2025": 88 }, checkReasons: { no_fiscal_year: 88 } },
  },
  company: null,
  isNew: true,
};
const NO_COMPANY = {
  companyKey: "",
  displayName: "",
  total: 6,
  needsCheck: 6,
  ready: 0,
  beingRead: 0,
  categories: {
    unknown: { total: 6, needsCheck: 6, fiscalYears: { none: 6 }, checkReasons: { no_company: 6, unknown_category: 6 } },
  },
  company: null,
  isNew: false,
};
// The server lists the no-company band first, and the sheet keeps its order.
const BANDS = [NO_COMPANY, CEDARLINE, HALDEN];
const OFF = { tab: "review", onlyToCheck: false };
const ON = { tab: "review", onlyToCheck: true };

function fileRow(id: string, extra: Record<string, unknown>) {
  return {
    _id: id,
    name: `${id}.docx`,
    category: "final_pd",
    status: "pending_review",
    editedLabels: [],
    needsCheck: false,
    checkReasons: [],
    size: 2048,
    ...extra,
  };
}

const FINAL_PDS = [
  fileRow("pd1", {
    pdNumber: "1",
    pdTitle: "Route planning engine",
    fiscalYearEnd: MAR_31_2025,
    fiscalYearEndAssumed: false,
    versionCode: "T",
    versionNumber: 2,
    writerName: "Dana Whitlock",
    writerInitials: "DW",
    scienceCode: "2.02.09",
    scienceCodeSource: "document",
  }),
  fileRow("pd2", {
    pdNumber: "2",
    pdTitle: "Yard map solver",
    fiscalYearEnd: DEC_31_2024,
    fiscalYearEndAssumed: true,
    versionCode: "T",
    versionNumber: 1,
    writerInitials: "KT",
    scienceCode: "2.02.09",
    scienceCodeSource: "document",
  }),
  fileRow("pd3", {
    pdNumber: "3",
    pdTitle: "Sensor data pipeline",
    fiscalYearEnd: MAR_31_2025,
    versionCode: "T",
    versionNumber: 3,
    writerName: "Priya Nair",
    scienceCode: "1.02.02",
    scienceCodeSource: "person",
  }),
  fileRow("pd4", {
    pdNumber: "4",
    pdTitle: "Label vision check",
    fiscalYearEnd: MAR_31_2025,
    versionCode: "T",
    versionNumber: 1,
    needsCheck: true,
    checkReasons: ["no_science_code", "no_writer"],
  }),
  fileRow("pd5", {
    pdNumber: "5",
    pdTitle: "Shelf gap finder",
    status: "fetched",
    fiscalYearEnd: MAR_31_2025,
    versionCode: "T",
    versionNumber: 2,
    writerName: "Sam Okafor",
  }),
];

const filesArgs = (companyKey: string, category: string, onlyToCheck = false) => ({
  tab: "review",
  companyKey,
  category,
  onlyToCheck,
});

function seedBands(rows: unknown[] = BANDS, more = false) {
  __setPaginatedRows("ingestion:sheetCompanies", rows, { more });
}

async function openCedarline() {
  await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
  await expect.poll(() => band("cedarline systems").hasAttribute("data-import-band-open")).toBe(true);
}

describe("ImportSheet", () => {
  beforeEach(() => {
    __resetConvexStub();
  });

  it("lists closed company bands with their counts, the new company label, and No company yet first as the server sends it", async () => {
    seedBands();
    await render(ImportSheet, { tab: "review", onlyToCheck: false });

    await expect.element(page.getByRole("table", { name: "Files to review" })).toBeVisible();
    // The server's order: No company yet first, so its place never moves as pages load.
    expect(all("[data-import-band]").map((node) => node.dataset.importBand)).toEqual([
      "",
      "cedarline systems",
      "halden foods",
    ]);
    // Closed by default, and closed companies read no files.
    for (const toggle of all("[data-import-band-toggle]")) expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(__activeQueryCount("ingestion:sheetFiles")).toBe(0);
    expect(all("[data-import-section]")).toHaveLength(0);

    const cedarline = band("cedarline systems");
    expect(text(one("[data-import-band-name]", cedarline))).toBe("Cedarline Systems");
    expect(text(one("[data-import-band-industry]", cedarline))).toBe("Software");
    expect(text(one("[data-import-band-files]", cedarline))).toBe("223 files");
    const words = all("[data-import-band-status] span", cedarline);
    expect(words.map((node) => text(node))).toEqual(["8 being read", "200 ready", "15 to check"]);
    expect(getComputedStyle(words[2]).color).toBe(AMBER);
    expect(getComputedStyle(words[1]).color).not.toBe(AMBER);

    const halden = band("halden foods");
    const label = one("[data-import-band-new]", halden)!;
    expect(text(label)).toBe("New company");
    // The success tokens: --color-success-soft fill, --color-success-ink text.
    expect(getComputedStyle(label).backgroundColor).toBe("rgb(220, 252, 231)");
    expect(getComputedStyle(label).color).toBe("rgb(22, 101, 52)");
    expect(one("[data-import-band-industry]", halden)).toBeNull();
    // A zero is left out, never amber.
    expect(all("[data-import-band-status] span", halden).map((node) => text(node))).toEqual(["98 to check"]);

    const none = band("");
    expect(text(one("[data-import-band-name]", none))).toBe("No company yet");
    expect(one("[data-import-band-new]", none)).toBeNull();

    // Board sizes: a 36px header and 52px bands.
    expect(one("[data-import-sheet-header]")!.getBoundingClientRect().height).toBeCloseTo(board(36), 0);
    expect(one('[role="row"]', cedarline)!.getBoundingClientRect().height).toBeCloseTo(board(52), 0);
    // The band line is the strongest hairline (--color-line).
    expect(getComputedStyle(one('[role="row"]', cedarline)!).borderTopColor).toBe("rgb(218, 229, 227)");
  });

  it("shows no status words on the approved tab", async () => {
    seedBands([{ ...CEDARLINE, needsCheck: 0, beingRead: 0, ready: 223 }]);
    await render(ImportSheet, { tab: "approved", onlyToCheck: false });
    await expect.element(page.getByRole("table", { name: "Approved files" })).toBeVisible();
    expect(text(one("[data-import-band-files]"))).toBe("223 files");
    expect(all("[data-import-band-status] span")).toHaveLength(0);
  });

  it("opens a company to its sections in fixed order, with Final PDs open and the rest closed", async () => {
    seedBands();
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "final_pd"), FINAL_PDS, { more: true });
    await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await openCedarline();

    const cedarline = band("cedarline systems");
    expect(all("[data-import-section]", cedarline).map((node) => node.dataset.importSection)).toEqual([
      "final_pd",
      "draft",
      "review_copy",
      "transcript",
      "supporting",
      "company_file",
    ]);
    expect(all("[data-import-section-label]", cedarline).map((node) => text(node))).toEqual([
      "Final PDs",
      "Drafts",
      "Review copies",
      "Transcripts",
      "Supporting files",
      "Company files",
    ]);
    // Small capitals on screen.
    expect(getComputedStyle(one("[data-import-section-label]", cedarline)!).textTransform).toBe("uppercase");
    expect(all("[data-import-section-count]", cedarline).map((node) => text(node))).toEqual(["24", "45", "31", "17", "102", "4"]);
    expect(text(one("[data-import-section-years]", section("cedarline systems", "final_pd")))).toBe(
      "13 in FY 2025, 11 in FY 2024"
    );
    expect(text(one("[data-import-section-years]", section("cedarline systems", "company_file")))).toBe("No fiscal year");

    const toggles = all("[data-import-section-toggle]", cedarline);
    expect(toggles.map((node) => node.getAttribute("aria-expanded"))).toEqual(["true", "false", "false", "false", "false", "false"]);
    // A closed section offers "Show N"; an open one does not.
    expect(text(section("cedarline systems", "draft"))).toContain("Show 45");
    expect(text(section("cedarline systems", "final_pd"))).not.toContain("Show 24");
    // Only the open section reads its files. First pages: five final PDs,
    // three of anything else, or all of a section with only one or two more.
    expect(__activeQueryArgs("ingestion:sheetFiles")).toEqual([filesArgs("cedarline systems", "final_pd")]);
    const sizes = __paginatedInitialSizes("ingestion:sheetFiles").map((entry) => entry.initialNumItems);
    expect(sizes).toEqual([5, 3, 3, 3, 3, 4]);

    // Opening Drafts reads its files.
    await userEvent.click(page.getByRole("button", { name: /^Drafts/ }));
    await expect.poll(() => __activeQueryArgs("ingestion:sheetFiles")).toEqual([
      filesArgs("cedarline systems", "final_pd"),
      filesArgs("cedarline systems", "draft"),
    ]);

    // Closing the company and opening it again starts from Final PDs alone.
    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
    await expect.poll(() => all("[data-import-section]").length).toBe(0);
    await openCedarline();
    expect(all("[data-import-section-toggle]", band("cedarline systems")).map((node) => node.getAttribute("aria-expanded"))[1]).toBe("false");
  });

  it("hides sections with no files, and Unsorted unless it has some", async () => {
    seedBands([{ ...HALDEN, categories: { ...HALDEN.categories, draft: { total: 0, needsCheck: 0, fiscalYears: {} } } }, NO_COMPANY]);
    await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await userEvent.click(page.getByRole("button", { name: "Halden Foods" }));
    await expect.poll(() => all("[data-import-section]", band("halden foods")).map((node) => node.dataset.importSection)).toEqual([
      "final_pd",
      "transcript",
      "supporting",
    ]);
    await userEvent.click(page.getByRole("button", { name: "No company yet" }));
    await expect.poll(() => all("[data-import-section-label]", band("")).map((node) => text(node))).toEqual(["Unsorted"]);
  });

  it("lists a section's files: year only, version, writer or initials, and the science code with the AI mark only from the document", async () => {
    seedBands();
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "final_pd"), FINAL_PDS, { more: true });
    await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await openCedarline();
    await expect.poll(() => all("[data-import-file]").length).toBe(5);

    const row = (id: string) => one(`[data-import-file="${id}"]`)!;
    const cell = (id: string, name: string) => one(`[data-import-cell="${name}"]`, row(id))!;

    expect(text(one("[data-import-file-prefix]", row("pd1")))).toBe("PD 1");
    expect(text(one("[data-import-file-title]", row("pd1")))).toBe("Route planning engine");
    // The year alone on screen; the year end is for the tooltip (and screen readers).
    expect(one("[data-import-year]", row("pd1"))!.firstChild!.textContent).toBe("2025");
    expect(one("[data-import-year] .sr-only", row("pd1"))!.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    expect(text(cell("pd1", "version"))).toBe("T2");
    expect(text(cell("pd1", "writer"))).toBe("Dana Whitlock");
    expect(text(one("[data-import-code]", row("pd1")))).toBe("2.02.09");
    expect(text(one("[data-import-code-title]", row("pd1")))).toBe("Software engineering and technology");
    const mark = one('[data-ai-mark="aurora"]', cell("pd1", "science-code"))!;
    expect(mark.getAttribute("aria-label")).toBe("Filled in by AI");

    // Initials only: muted.
    const initials = one("[data-import-writer-tone]", row("pd2"))!;
    expect(text(initials)).toBe("KT");
    expect(initials.dataset.importWriterTone).toBe("muted");
    expect(getComputedStyle(initials).color).toBe("rgb(107, 127, 123)");

    // A code a person set: no mark, the code still lines up.
    expect(one('[data-ai-mark="aurora"]', cell("pd3", "science-code"))).toBeNull();
    expect(text(one("[data-import-code]", row("pd3")))).toBe("1.02.02");
    expect(one("[data-import-code]", row("pd3"))!.getBoundingClientRect().left).toBeCloseTo(
      one("[data-import-code]", row("pd1"))!.getBoundingClientRect().left,
      0
    );

    // Board sizes: 44px rows; the fixed columns' rules line up with the header's.
    expect(row("pd1").getBoundingClientRect().height).toBeCloseTo(board(44), 0);
    const headerCells = all('[data-import-sheet-header] [role="columnheader"]');
    const rowCells = all('[role="cell"]', row("pd1"));
    for (const index of [1, 2, 3, 4]) {
      expect(rowCells[index].getBoundingClientRect().left).toBeCloseTo(headerCells[index].getBoundingClientRect().left, 0);
    }
    expect(getComputedStyle(rowCells[1]).borderLeftWidth).toBe("1px");
  });

  it("puts the year end in the fiscal year's tooltip, and says when it was assumed", async () => {
    seedBands();
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "final_pd"), FINAL_PDS);
    await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await openCedarline();
    await expect.poll(() => all("[data-import-file]").length).toBe(5);

    const tooltip = () => one("[data-tooltip-content]");
    await userEvent.hover(one('[data-import-file="pd1"] [data-import-year]')!);
    await expect.poll(() => text(tooltip())).toBe("Year ended Mar 31, 2025");
    await userEvent.unhover(one('[data-import-file="pd1"] [data-import-year]')!);
    await expect.poll(() => tooltip()).toBeNull();
    await userEvent.hover(one('[data-import-file="pd2"] [data-import-year]')!);
    await expect.poll(() => text(tooltip())).toBe("Year end not in the folder name. Using Dec 31, 2024 for now.");
    await userEvent.unhover(one('[data-import-file="pd2"] [data-import-year]')!);
    // The PD title's tooltip gives the file name, on hover too.
    await userEvent.hover(one('[data-import-file="pd1"] [data-import-file-title]')!);
    await expect.poll(() => text(tooltip())).toBe("pd1.docx");
  });

  it("keeps the tooltip words out of the tab order: on To review each editable cell's control is its one tab stop", async () => {
    seedBands();
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "final_pd"), FINAL_PDS, { more: true });
    await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await openCedarline();
    await expect.poll(() => all("[data-import-file]").length).toBe(5);

    for (const node of [...all("[data-import-year]"), ...all("[data-import-file-title]")]) {
      expect(node.tabIndex, node.textContent ?? "").toBe(-1);
    }
    expect(text(one('[data-import-file="pd1"] [data-import-year] .sr-only'))).toBe(", Year ended Mar 31, 2025");
    // Phase 3b: from Final PDs, Tab reaches PD 1's cells in order, then its "...".
    one("[data-import-section-toggle]", section("cedarline systems", "final_pd"))!.focus();
    const pd1 = one('[data-import-file="pd1"]')!;
    for (const selector of ["[data-import-year-edit]", "[data-import-version-edit]", "[data-import-writer-edit]", "[data-import-code-edit]", "[data-import-row-menu]"]) {
      await userEvent.tab();
      expect(document.activeElement, selector).toBe(one(selector, pd1));
    }
    // The year control is not inside the tooltip's own trigger: it is the trigger.
    expect(one("[data-import-year-edit]", pd1)!.querySelector("button, [tabindex='0']")).toBeNull();
    // A file still being read has only its "...".
    const pd5 = one('[data-import-file="pd5"]')!;
    expect(all("button", pd5).map((node) => node.hasAttribute("data-import-row-menu"))).toEqual([true]);
  });

  it("leaves Approved read only: Tab passes over its rows", async () => {
    seedBands([{ ...CEDARLINE, needsCheck: 0, beingRead: 0, ready: 223 }]);
    __setPaginatedRowsForArgs(
      "ingestion:sheetFiles",
      { ...filesArgs("cedarline systems", "final_pd"), tab: "approved" },
      FINAL_PDS.map((row) => ({ ...row, status: "approved" })),
      { more: true }
    );
    await render(ImportSheet, { tab: "approved", onlyToCheck: false });
    await openCedarline();
    await expect.poll(() => all("[data-import-file]").length).toBe(5);
    expect(all("[data-import-file] button")).toHaveLength(0);
    one("[data-import-section-toggle]", section("cedarline systems", "final_pd"))!.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(one("[data-import-show-more-files]"));
  });

  it("marks in amber only what needs a person, and shows a file still being read with empty cells", async () => {
    seedBands();
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "final_pd"), FINAL_PDS, { more: true });
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "supporting"), [
      fileRow("wb", {
        name: "Whiteboard photo.pdf",
        category: "supporting",
        status: "failed",
        fiscalYearEnd: MAR_31_2025,
        needsCheck: true,
        checkReasons: ["could_not_read"],
      }),
      fileRow("notes", { name: "Site notes.pdf", category: "supporting", fiscalYearEnd: MAR_31_2025 }),
      // Read, but no text came out: a scan.
      fileRow("scan", {
        name: "Signed letter.pdf",
        category: "supporting",
        fiscalYearEnd: MAR_31_2025,
        needsCheck: true,
        checkReasons: ["no_text"],
      }),
    ]);
    await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await openCedarline();
    await expect.poll(() => all("[data-import-file]").length).toBe(5);

    // The sections' notes, from the band's counts: the reasons, one file
    // counted under each of its reasons.
    const finalNote = one("[data-import-section-note]", section("cedarline systems", "final_pd"))!;
    expect(text(finalNote)).toBe("8 need a writer, 4 need a science code");
    expect(getComputedStyle(finalNote).color).toBe(AMBER);
    expect(text(one("[data-import-section-note]", section("cedarline systems", "supporting")))).toBe(
      "2 could not be read, 1 with no text"
    );
    // Sections with nothing to check have no note, and nothing but the open
    // section's files is read.
    expect(one("[data-import-section-note]", section("cedarline systems", "draft"))).toBeNull();
    expect(__activeQueryArgs("ingestion:sheetFiles")).toEqual([filesArgs("cedarline systems", "final_pd")]);
    // A band row from before the reasons were counted says how many to check.
    await userEvent.click(page.getByRole("button", { name: "Halden Foods" }));
    await expect.poll(() => text(one("[data-import-section-note]", section("halden foods", "transcript")))).toBe("6 to check");
    expect(text(one("[data-import-section-note]", section("halden foods", "supporting")))).toBe("88 need a fiscal year");
    await userEvent.click(page.getByRole("button", { name: "Halden Foods" }));
    await expect.poll(() => band("halden foods").hasAttribute("data-import-band-open")).toBe(false);

    // A final PD with no writer and no science code: the amber pick controls (phase 3b).
    const pd4 = one('[data-import-file="pd4"]')!;
    const noWriter = one("[data-import-writer-tone]", pd4)!;
    expect(text(noWriter)).toBe("Pick a writer");
    expect(getComputedStyle(noWriter).color).toBe(AMBER);
    const noCode = one("[data-import-code-missing]", pd4)!;
    expect(text(noCode)).toBe("Pick a code");
    expect(getComputedStyle(noCode).color).toBe(AMBER);

    // Still being read: muted words after the name, and empty cells.
    const pd5 = one('[data-import-file="pd5"]')!;
    const reading = one("[data-import-file-state]", pd5)!;
    expect(text(reading)).toBe("Being read");
    expect(getComputedStyle(reading).color).toBe("rgb(107, 127, 123)");
    for (const name of ["fiscal-year", "version", "writer", "science-code"]) {
      expect(text(one(`[data-import-cell="${name}"]`, pd5))).toBe("");
    }

    // Could not be read: amber words after the name. A plain supporting
    // file's empty writer and code cells are not amber: they do not apply.
    await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
    await expect.poll(() => one('[data-import-file="wb"]')).not.toBeNull();
    const failed = one('[data-import-file="wb"] [data-import-file-state]')!;
    expect(text(failed)).toBe("Could not be read");
    expect(getComputedStyle(failed).color).toBe(AMBER);
    const notes = one('[data-import-file="notes"]')!;
    expect(text(one('[data-import-cell="writer"]', notes))).toBe("");
    expect(text(one('[data-import-cell="science-code"]', notes))).toBe("");

    // Read with no text (phase 3b fixes): amber words after the name; it is
    // a read file, so its year end can be set and it can be moved or deleted.
    const scan = one('[data-import-file="scan"]')!;
    const noText = one("[data-import-file-state]", scan)!;
    expect(text(noText)).toBe("No text could be read");
    expect(getComputedStyle(noText).color).toBe(AMBER);
    expect(one("[data-import-year-edit]", scan)).not.toBeNull();
    expect(one("[data-import-row-menu]", scan)).not.toBeNull();
  });

  it("asks for 25 more files with Show more, and for the next companies", async () => {
    seedBands(BANDS, true);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "final_pd"), FINAL_PDS, { more: true });
    await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await openCedarline();

    const more = page.getByRole("button", { name: "Show 19 more final PDs" });
    await expect.element(more).toBeVisible();
    await userEvent.click(more);
    expect(__loadMoreCalls("ingestion:sheetFiles")).toEqual([
      { args: filesArgs("cedarline systems", "final_pd"), numItems: 25 },
    ]);

    const companies = page.getByRole("button", { name: "Show more companies" });
    await userEvent.click(companies);
    expect(__loadMoreCalls("ingestion:sheetCompanies")).toEqual([{ args: { tab: "review", onlyToCheck: false }, numItems: 25 }]);
  });

  it("with To check on, reads only files to check and counts only those", async () => {
    seedBands();
    await render(ImportSheet, { tab: "review", onlyToCheck: true });
    expect(__activeQueryArgs("ingestion:sheetCompanies")).toEqual([{ tab: "review", onlyToCheck: true }]);
    await openCedarline();
    const cedarline = band("cedarline systems");
    expect(all("[data-import-section]", cedarline).map((node) => node.dataset.importSection)).toEqual(["final_pd", "supporting"]);
    expect(all("[data-import-section-count]", cedarline).map((node) => text(node))).toEqual(["12", "3"]);
    // The year split counts every file, so it steps aside while filtering.
    expect(one("[data-import-section-years]", cedarline)).toBeNull();
    expect(__activeQueryArgs("ingestion:sheetFiles")).toEqual([filesArgs("cedarline systems", "final_pd", true)]);
  });

  it("says so calmly when a tab is empty, and while it loads", async () => {
    const { rerender } = await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await expect.element(page.getByRole("status", { name: "Loading companies" })).toBeVisible();
    seedBands([]);
    await expect.element(page.getByText("Nothing is waiting for review.")).toBeVisible();
    await rerender({ tab: "deleted", onlyToCheck: false });
    await expect.element(page.getByText("Nothing has been deleted.")).toBeVisible();
    await rerender({ tab: "review", onlyToCheck: true });
    await expect.element(page.getByText("Nothing needs a check.")).toBeVisible();
  });

  it("opens and shows a company asked for by the search, reading on until it is loaded", async () => {
    seedBands([CEDARLINE], true);
    const { rerender } = await render(ImportSheet, { tab: "review", onlyToCheck: false, jump: null });
    await rerender({ tab: "review", onlyToCheck: false, jump: { key: "halden foods" } });
    // Not loaded yet: it reads on, a full page at a time.
    await expect.poll(() => __loadMoreCalls("ingestion:sheetCompanies").map((call) => call.numItems)).toEqual([100]);
    seedBands([CEDARLINE, HALDEN]);
    await expect.poll(() => band("halden foods")?.hasAttribute("data-import-band-open")).toBe(true);
    await expect.poll(() => document.activeElement === one("[data-import-band-toggle]", band("halden foods"))).toBe(true);
    expect(band("cedarline systems").hasAttribute("data-import-band-open")).toBe(false);
  });

  it("opens a company and a section with Enter and with Space, pointing aria-controls only at what is shown", async () => {
    seedBands();
    await render(ImportSheet, { tab: "review", onlyToCheck: false });
    const toggle = one("[data-import-band-toggle]", band("cedarline systems"))!;
    await expect.poll(() => toggle.isConnected).toBe(true);
    // Closed: nothing to point at.
    expect(toggle.hasAttribute("aria-controls")).toBe(false);

    toggle.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBe(
      one("[data-import-band-sections]", band("cedarline systems"))
    );

    const drafts = one("[data-import-section-toggle]", section("cedarline systems", "draft"))!;
    expect(drafts.hasAttribute("aria-controls")).toBe(false);
    drafts.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => drafts.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(drafts.getAttribute("aria-controls")!)).toBe(
      one("[data-import-section-files]", section("cedarline systems", "draft"))
    );
    await userEvent.keyboard(" ");
    await expect.poll(() => drafts.getAttribute("aria-expanded")).toBe("false");
    expect(drafts.hasAttribute("aria-controls")).toBe(false);
    await userEvent.keyboard(" ");
    await expect.poll(() => drafts.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(drafts);

    // Space on the company closes it, and opens it again.
    toggle.focus();
    await userEvent.keyboard(" ");
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.hasAttribute("aria-controls")).toBe(false);
    expect(all("[data-import-section]")).toHaveLength(0);
    await userEvent.keyboard(" ");
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the companies and an open company's files on screen while To check reloads them", async () => {
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", OFF, BANDS);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "final_pd"), FINAL_PDS, { more: true });
    const { rerender } = await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await openCedarline();
    await expect.poll(() => all("[data-import-file]").length).toBe(5);
    const cedarline = band("cedarline systems");
    const finalPds = section("cedarline systems", "final_pd");

    await rerender({ tab: "review", onlyToCheck: true });
    await expect.poll(() => __activeQueryArgs("ingestion:sheetFiles")).toEqual([
      filesArgs("cedarline systems", "final_pd", true),
    ]);
    // Neither list has come back yet: the same companies, the same open
    // company with the same files, and no loading rows.
    expect(__activeQueryArgs("ingestion:sheetCompanies")).toEqual([ON]);
    expect(all("[data-import-band]").map((node) => node.dataset.importBand)).toEqual(["", "cedarline systems", "halden foods"]);
    expect(one("[data-import-sheet-loading]")).toBeNull();
    expect(one("[data-import-sheet-empty]")).toBeNull();
    expect(band("cedarline systems")).toBe(cedarline);
    expect(cedarline.hasAttribute("data-import-band-open")).toBe(true);
    expect(all("[data-import-file]", cedarline).map((node) => node.dataset.importFile)).toEqual(["pd1", "pd2", "pd3", "pd4", "pd5"]);
    expect(one("[data-import-file-skeleton]")).toBeNull();
    // Each list asks for as many as it listed, never less than its first page.
    expect(__paginatedReloadSizes("ingestion:sheetCompanies")).toEqual([{ args: ON, initialNumItems: 25 }]);
    expect(__paginatedReloadSizes("ingestion:sheetFiles")).toEqual([
      { args: filesArgs("cedarline systems", "final_pd", true), initialNumItems: 5 },
    ]);

    // The new lists come. The company is still open, never redrawn, with the files to check.
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", ON, BANDS);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "final_pd", true), [FINAL_PDS[3]]);
    await expect.poll(() => all("[data-import-file]").map((node) => node.dataset.importFile)).toEqual(["pd4"]);
    expect(band("cedarline systems")).toBe(cedarline);
    expect(section("cedarline systems", "final_pd")).toBe(finalPds);
    expect(all("[data-import-section]", cedarline).map((node) => node.dataset.importSection)).toEqual(["final_pd", "supporting"]);
    // Nothing more was read for it: the open company was on the first page.
    expect(__loadMoreCalls("ingestion:sheetCompanies")).toEqual([]);
  });

  it("asks for as many companies as were listed when To check changes", async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      ...HALDEN,
      companyKey: `northgate labs ${String(index).padStart(2, "0")}`,
      displayName: `Northgate Labs ${index}`,
    }));
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", OFF, many, { more: true });
    const { rerender } = await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await expect.poll(() => all("[data-import-band]").length).toBe(30);
    await rerender({ tab: "review", onlyToCheck: true });
    await expect.poll(() => __paginatedReloadSizes("ingestion:sheetCompanies")).toEqual([{ args: ON, initialNumItems: 30 }]);
    expect(all("[data-import-band]")).toHaveLength(30);
  });

  it("keeps an open company on screen when To check goes off until the full list reaches it", async () => {
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", ON, [HALDEN]);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("halden foods", "final_pd", true), [
      fileRow("h1", { pdNumber: "1", pdTitle: "Fermentation control", needsCheck: true, checkReasons: ["no_science_code"] }),
    ]);
    const { rerender } = await render(ImportSheet, { tab: "review", onlyToCheck: true });
    await userEvent.click(page.getByRole("button", { name: "Halden Foods" }));
    await expect.poll(() => one('[data-import-file="h1"]')).not.toBeNull();
    const halden = band("halden foods");

    await rerender({ tab: "review", onlyToCheck: false });
    // The full list's first page ends before Halden Foods: it reads on, a
    // full page at a time, and Halden Foods stays where it was meanwhile.
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", OFF, [NO_COMPANY, CEDARLINE], { more: true });
    await expect.poll(() => __loadMoreCalls("ingestion:sheetCompanies")).toEqual([{ args: OFF, numItems: 100 }]);
    expect(all("[data-import-band]").map((node) => node.dataset.importBand)).toEqual(["halden foods"]);
    expect(band("halden foods")).toBe(halden);
    expect(halden.hasAttribute("data-import-band-open")).toBe(true);
    expect(one("[data-import-show-more-companies]")).toBeNull();

    __setPaginatedRowsForArgs("ingestion:sheetCompanies", OFF, [NO_COMPANY, CEDARLINE, HALDEN]);
    await expect.poll(() => all("[data-import-band]").map((node) => node.dataset.importBand)).toEqual([
      "",
      "cedarline systems",
      "halden foods",
    ]);
    expect(band("halden foods")).toBe(halden);
    expect(halden.hasAttribute("data-import-band-open")).toBe(true);
  });

  it("offers Show N more only while the section's count says more are left, never an empty Show more", async () => {
    const NORTHGATE = {
      companyKey: "northgate labs",
      displayName: "Northgate Labs",
      total: 17,
      needsCheck: 2,
      ready: 15,
      beingRead: 0,
      categories: {
        final_pd: { total: 10, needsCheck: 2, fiscalYears: { "2025": 10 }, checkReasons: { no_science_code: 2 } },
        review_copy: { total: 3, needsCheck: 0, fiscalYears: { "2025": 3 } },
        transcript: { total: 4, needsCheck: 0, fiscalYears: { "2025": 4 } },
      },
      company: null,
      isNew: true,
    };
    const args = (category: string, onlyToCheck = false) => ({ tab: "review", companyKey: "northgate labs", category, onlyToCheck });
    const copies = [1, 2, 3].map((n) => fileRow(`rc${n}`, { category: "review_copy", pdNumber: String(n), versionCode: "R", versionNumber: 1 }));
    const calls = [1, 2, 3].map((n) => fileRow(`tr${n}`, { name: `Call ${n}.vtt`, category: "transcript" }));
    // Each read still says it can load more, as a page that holds exactly the rest does until an empty page comes back.
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", OFF, [NORTHGATE], { more: false });
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", ON, [NORTHGATE], { more: false });
    __setPaginatedRowsForArgs("ingestion:sheetFiles", args("final_pd"), FINAL_PDS, { more: true });
    __setPaginatedRowsForArgs("ingestion:sheetFiles", args("final_pd", true), FINAL_PDS.slice(0, 2), { more: true });
    __setPaginatedRowsForArgs("ingestion:sheetFiles", args("review_copy"), copies, { more: true });
    // One more than the page listed: four transcripts, three listed.
    __setPaginatedRowsForArgs("ingestion:sheetFiles", args("transcript"), calls, { more: true });
    const { rerender } = await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await userEvent.click(page.getByRole("button", { name: "Northgate Labs" }));
    await userEvent.click(page.getByRole("button", { name: /^Review copies/ }));
    await userEvent.click(page.getByRole("button", { name: /^Transcripts/ }));
    const showMore = (category: string) => one("[data-import-show-more-files]", section("northgate labs", category));
    await expect.poll(() => one('[data-import-file="tr3"]')).not.toBeNull();
    await expect.poll(() => one('[data-import-file="rc3"]')).not.toBeNull();

    // Ten final PDs, five listed: the numbered form.
    expect(text(showMore("final_pd"))).toBe("Show 5 more final PDs");
    // Exactly full: three review copies, all three listed. No row at all.
    expect(showMore("review_copy")).toBeNull();
    expect(text(section("northgate labs", "review_copy"))).not.toContain("Show more");
    // One more than listed: numbered, singular.
    expect(text(showMore("transcript"))).toBe("Show 1 more transcript");
    expect(all("[data-import-show-more-files]").map((node) => text(node))).not.toContain("Show more transcripts");

    // To check on: two final PDs to check, both listed. No row.
    await rerender({ tab: "review", onlyToCheck: true });
    await expect.poll(() => all('[data-import-section="final_pd"] [data-import-file]').length).toBe(2);
    expect(text(one("[data-import-section-count]", section("northgate labs", "final_pd")))).toBe("2");
    expect(showMore("final_pd")).toBeNull();
  });

  it("hides Show more on the Deleted tab when every deleted file is listed", async () => {
    const deleted = {
      ...CEDARLINE,
      total: 2,
      needsCheck: 0,
      ready: 2,
      beingRead: 0,
      categories: { transcript: { total: 2, needsCheck: 0, fiscalYears: { "2024": 2 } } },
    };
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "deleted", onlyToCheck: false }, [deleted]);
    __setPaginatedRowsForArgs(
      "ingestion:sheetFiles",
      { tab: "deleted", companyKey: "cedarline systems", category: "transcript", onlyToCheck: false },
      [
        fileRow("d1", { name: "2023-11-21 Cedarline servo call.txt", category: "transcript", status: "deleted", deletedReason: "deleted" }),
        fileRow("d2", { name: "2024-11-14 Cedarline vision interview.vtt", category: "transcript", status: "deleted", deletedReason: "deleted" }),
      ],
      { more: true }
    );
    // The boards' window, where the screenshot cut these names short.
    await page.viewport(1440, 900);
    await render(ImportSheet, { tab: "deleted", onlyToCheck: false });
    await openCedarline();
    await userEvent.click(page.getByRole("button", { name: /^Transcripts/ }));
    await expect.poll(() => all("[data-import-file]").length).toBe(2);
    expect(one("[data-import-show-more-files]")).toBeNull();

    // Why each file is here sits at the row's end, before Put back, so the name has the File column.
    const row = one('[data-import-file="d1"]')!;
    const reason = one("[data-import-file-deleted-reason]", row)!;
    expect(text(reason)).toBe("Deleted in Import");
    expect(reason.closest('[data-import-cell="science-code"]')).not.toBeNull();
    expect(reason.compareDocumentPosition(one("[data-import-put-back]", row)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const name = one("[data-import-file-title]", row)!;
    expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
  });

  it("leaves a cell empty where the file's category does not take its label, even with a value stored", async () => {
    seedBands();
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "draft"), [
      // A final PD moved to Drafts: its code is still stored, but a draft shows none.
      fileRow("moved", { ...FINAL_PDS[0], _id: "moved", category: "draft" }),
    ]);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "company_file"), [
      fileRow("glossary", { name: "Cedarline glossary.docx", category: "company_file" }),
    ]);
    await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await openCedarline();
    await userEvent.click(page.getByRole("button", { name: /^Drafts/ }));
    await userEvent.click(page.getByRole("button", { name: /^Company files/ }));
    await expect.poll(() => one('[data-import-file="glossary"]')).not.toBeNull();
    await expect.poll(() => one('[data-import-file="moved"]')).not.toBeNull();

    const moved = one('[data-import-file="moved"]')!;
    expect(text(one('[data-import-cell="science-code"]', moved))).toBe("");
    expect(one("[data-import-code-edit], [data-import-code-pick]", moved)).toBeNull();
    // A draft takes a version and a writer.
    expect(text(one('[data-import-cell="version"]', moved))).toBe("T2");
    expect(text(one('[data-import-cell="writer"]', moved))).toBe("Dana Whitlock");
    // A company file's fiscal year cell is empty: its section already says "No fiscal year".
    expect(text(one('[data-import-cell="fiscal-year"]', one('[data-import-file="glossary"]')!))).toBe("");
    expect(text(one("[data-import-section-years]", section("cedarline systems", "company_file")))).toBe("No fiscal year");
  });

  it("reads past empty pages a few times before offering Show more companies, and never calls it empty", async () => {
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", OFF, [], { more: true });
    await render(ImportSheet, { tab: "review", onlyToCheck: false });
    await expect.poll(() => __loadMoreCalls("ingestion:sheetCompanies")).toEqual([{ args: OFF, numItems: 25 }]);
    expect(one("[data-import-sheet-empty]")).toBeNull();
    // Each further empty page is read past, up to three in all.
    for (let round = 0; round < 4; round += 1) {
      __setPaginatedRowsForArgs("ingestion:sheetCompanies", OFF, [], { more: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(__loadMoreCalls("ingestion:sheetCompanies")).toHaveLength(3);
    // Then the way on is offered, not "Nothing is waiting for review."
    await expect.element(page.getByRole("button", { name: "Show more companies" })).toBeVisible();
    expect(one("[data-import-sheet-empty]")).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Show more companies" }));
    expect(__loadMoreCalls("ingestion:sheetCompanies")).toHaveLength(4);
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", OFF, [CEDARLINE]);
    await expect.poll(() => all("[data-import-band]").map((node) => node.dataset.importBand)).toEqual(["cedarline systems"]);
  });
});

/**
 * The sheet on laptop windows (live QA fixes, 2026-11-11). The widths are
 * the sheet's own on the real page with the admin sidebar open: 900px in a
 * 1280px window, 714px in a 1100px one, 1060px in a 1440px one (the boards).
 * The window is set too, so the root size (and every rem) is the real one.
 */
describe("ImportSheet on laptop windows", () => {
  const LAPTOPS = [
    { window: 1280, sheet: 900 },
    { window: 1100, sheet: 714 },
  ];

  const WIDE_ROWS = [
    fileRow("lactose", {
      name: "01 BrightwellDairy 2025-03-31 T2.DW LactoseFreeProcessValidation.docx",
      pdNumber: "1",
      pdTitle: "Lactose free process validation",
      fiscalYearEnd: MAR_31_2025,
      versionCode: "T",
      versionNumber: 2,
      writerInitials: "DW",
      scienceCode: "2.02.09",
      scienceCodeSource: "document",
    }),
    // A final PD with nothing filled in: both amber pick controls.
    fileRow("bare", { name: "Brightwell final PD - membrane line.docx", fiscalYearEnd: MAR_31_2025, needsCheck: true, checkReasons: ["no_science_code", "no_writer"] }),
  ];
  const NOTE_ROWS = [
    // Read, no text came out: the note must never take the name's place.
    fileRow("scan", {
      name: "Membrane cleaning cycle log.pdf",
      category: "supporting",
      fiscalYearEnd: MAR_31_2025,
      needsCheck: true,
      checkReasons: ["no_text"],
    }),
    fileRow("broken", { name: "Prototype invoice.pdf", category: "supporting", status: "failed", fiscalYearEnd: MAR_31_2025, needsCheck: true, checkReasons: ["could_not_read"] }),
  ];

  let holder: HTMLDivElement | null = null;

  beforeEach(() => {
    __resetConvexStub();
  });
  afterEach(() => {
    holder?.remove();
    holder = null;
  });

  async function mountAt(windowWidth: number, sheetWidth: number) {
    await page.viewport(windowWidth, 900);
    seedBands([CEDARLINE]);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "final_pd"), WIDE_ROWS, { more: true });
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "supporting"), NOTE_ROWS, { more: true });
    holder = document.createElement("div");
    holder.style.width = `${sheetWidth}px`;
    document.body.append(holder);
    await render(ImportSheet, { target: holder, props: { tab: "review", onlyToCheck: false } });
    await openCedarline();
    await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
    await expect.poll(() => all("[data-import-file]").length).toBe(4);
    await document.fonts.ready;
  }

  const box = (node: Element) => node.getBoundingClientRect();
  /** Every element in a cell that draws something stays inside the cell (sr-only words aside). */
  function overflowing(cell: HTMLElement): string[] {
    const outer = box(cell);
    return [...cell.querySelectorAll<HTMLElement>("*")]
      .filter((node) => !node.closest(".sr-only") && box(node).width > 0)
      .filter((node) => box(node).right > outer.right + 0.5 || box(node).left < outer.left - 0.5)
      .map((node) => `${node.tagName} "${text(node)}"`);
  }

  for (const { window: windowWidth, sheet } of LAPTOPS) {
    it(`keeps every column readable in a ${windowWidth}px window: the name has room, nothing runs into the next column`, async () => {
      await mountAt(windowWidth, sheet);
      const scroller = one("[data-import-sheet]")!;
      // It fits: nothing to scroll at this width.
      expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);

      for (const row of all("[data-import-file]")) {
        const id = row.dataset.importFile!;
        // The name keeps real room, even beside "No text could be read".
        expect(box(one("[data-import-file-title]", row)!).width, id).toBeGreaterThan(board(110));
        const cells = all(':scope > [role="cell"]', row);
        for (const [index, cell] of cells.entries()) {
          expect(overflowing(cell), `${id} cell ${index}`).toEqual([]);
          const next = cells[index + 1];
          if (next) expect(box(cell).right, `${id} cell ${index}`).toBeLessThanOrEqual(box(next).left + 0.5);
        }
      }
      // The note gives way first, and still shows a few letters.
      const note = one('[data-import-file="scan"] [data-import-file-state]')!;
      expect(box(note).width).toBeGreaterThan(board(40));
      expect(note.getAttribute("title")).toBe("No text could be read");

      // The fixed columns line up with the header's, rows 24px in or not.
      const header = all('[data-import-sheet-header] [role="columnheader"]');
      const bandCells = all(':scope > [role="row"] > [role="cell"]', band("cedarline systems"));
      for (const row of all("[data-import-file]")) {
        const cells = all(':scope > [role="cell"]', row);
        for (const index of [1, 2, 3, 4]) expect(box(cells[index]).left).toBeCloseTo(box(header[index]).left, 0);
      }
      // The band: its status words sit in the sheet, past "N files", and never run off its end.
      const files = one("[data-import-band-files]", band("cedarline systems"))!;
      const words = all("[data-import-band-status] span", band("cedarline systems"));
      expect(words.map((node) => text(node))).toEqual(["8 being read", "200 ready", "15 to check"]);
      for (const word of words) {
        expect(box(word).left, text(word)).toBeGreaterThanOrEqual(box(files).right);
        expect(box(word).right, text(word)).toBeLessThanOrEqual(box(scroller).right + 0.5);
        expect(box(word).bottom, text(word)).toBeLessThanOrEqual(box(bandCells.at(-1)!).bottom + 0.5);
      }
      for (const cell of bandCells) expect(overflowing(cell)).toEqual([]);
      // A section's "Show N" stays on its row.
      const drafts = one('[data-import-section="draft"] [role="row"]')!;
      const showDrafts = [...drafts.querySelectorAll<HTMLElement>("span")].find((node) => text(node) === "Show 45")!;
      expect(box(showDrafts).right).toBeLessThanOrEqual(box(drafts).right + 0.5);
    });
  }

  it("scrolls sideways in its own area below the narrowest it can be, the header and the band words with it", async () => {
    await mountAt(1100, 560);
    const scroller = one("[data-import-sheet]")!;
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    // The header is as wide as what scrolls, so it scrolls with the rows.
    const header = one("[data-import-sheet-header]")!;
    expect(box(header).width).toBeCloseTo(scroller.scrollWidth, 0);
    // Everything can be reached by scrolling: the band's words end inside the scrolled area.
    const end = box(scroller).left + scroller.scrollWidth;
    for (const word of all("[data-import-band-status] span")) expect(box(word).right).toBeLessThanOrEqual(end + 0.5);
    for (const row of all("[data-import-file]")) {
      for (const cell of all(':scope > [role="cell"]', row)) expect(overflowing(cell)).toEqual([]);
    }
    scroller.scrollLeft = scroller.scrollWidth;
    await expect.poll(() => box(all("[data-import-band-status] span").at(-1)!).right).toBeLessThanOrEqual(box(scroller).right + 0.5);
  });

  it("fits a common science code title at the boards' 1440px, and keeps no room for the row's ... until the row is hovered", async () => {
    await mountAt(1440, 1060);
    const lactose = one('[data-import-file="lactose"]')!;
    const title = one("[data-import-code-title]", lactose)!;
    expect(text(title)).toBe("Software engineering and technology");
    expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth);
    const menu = one("[data-import-row-menu]", lactose)!;
    expect(getComputedStyle(menu).opacity).toBe("0");
    // On hover the ... shows over the cell's end, clear of the code's words.
    await userEvent.hover(lactose);
    await expect.poll(() => getComputedStyle(menu).opacity).toBe("1");
    await expect.poll(() => box(menu).left).toBeGreaterThanOrEqual(box(one("[data-import-code-edit]", lactose)!).right - 0.5);
    expect(box(menu).right).toBeLessThanOrEqual(box(one('[data-import-cell="science-code"]', lactose)!).right);
  });

  it("gives a cut name or science code title in full in a tooltip, with no new tab stops", async () => {
    await mountAt(1100, 714);
    const tooltip = () => one("[data-tooltip-content]");
    const lactose = one('[data-import-file="lactose"]')!;
    // The code title is cut here: hover shows it whole.
    const codeTitle = one("[data-import-code-title]", lactose)!;
    expect(codeTitle.scrollWidth).toBeGreaterThan(codeTitle.clientWidth);
    await userEvent.hover(codeTitle);
    await expect.poll(() => text(tooltip())).toBe("2.02.09 Software engineering and technology");
    await userEvent.unhover(codeTitle);
    await expect.poll(() => tooltip()).toBeNull();
    // And on keyboard focus of the code's control.
    one("[data-import-version-edit]", lactose)!.focus();
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(one("[data-import-code-edit]", lactose));
    await expect.poll(() => text(tooltip())).toBe("2.02.09 Software engineering and technology");
    (document.activeElement as HTMLElement).blur();

    // A cut file name: the tooltip gives it whole.
    const scan = one('[data-import-file="scan"] [data-import-file-title]')!;
    expect(scan.scrollWidth).toBeGreaterThan(scan.clientWidth);
    await userEvent.hover(scan);
    await expect.poll(() => text(tooltip())).toBe("Membrane cleaning cycle log.pdf");
    await userEvent.unhover(scan);
    await expect.poll(() => tooltip()).toBeNull();
    // A name that fits says nothing more.
    const broken = one('[data-import-file="broken"] [data-import-file-title]')!;
    expect(broken.scrollWidth).toBeLessThanOrEqual(broken.clientWidth);
    await userEvent.hover(broken);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(tooltip()).toBeNull();
    // None of these words is a tab stop.
    for (const node of [...all("[data-import-file-title]"), ...all("[data-import-code-title]")]) expect(node.tabIndex).toBe(-1);
  });
});

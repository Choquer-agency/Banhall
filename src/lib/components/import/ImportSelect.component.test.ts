import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ImportPage from "./ImportPage.svelte";
import ToastHarness from "$lib/test/ToastHarness.svelte";
import {
  __activeQueryArgs,
  __mutationCalls,
  __resetConvexStub,
  __setMutationHandler,
  __setPaginatedRowsForArgs,
  __setQueryData,
  __setQueryDataForArgs,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { viewAs } from "$lib/shell/viewAs.svelte";

/**
 * Selecting many files on the Import page (2026-11-11 phase 3b, boards ao4
 * and ao6): Select's checkbox column, company and category checkboxes over
 * the loaded files, the dark bar's changes in runs of 100, Delete with Undo,
 * the Deleted tab's Put back, and the bar stepping aside for a search.
 * Made-up companies and people.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];
const one = (selector: string, root: ParentNode = document) => root.querySelector<HTMLElement>(selector);
const bar = () => one("[data-import-selection-bar]");
const barCount = () => text(one("[data-import-bar-count]"));
const left = (node: Element | null) => node!.getBoundingClientRect().left;

const WASH = "rgb(241, 250, 249)"; // --color-primary-wash

type Ids = { ids: string[] };
/** The server's answer to a batch call that changed every file it was sent. */
const changedAll = (args: unknown) => {
  const { ids } = args as Ids;
  return { changed: ids.length, changedIds: ids, skipped: [] };
};
/** A server failure with no words for people. */
const serverError = () => new Error("[CONVEX M(ingestion:setSheetLabels)] Server Error");

const totals = (files: number, companies: number, needsCheck = 0) => ({
  files,
  companies,
  needsCheck,
  ready: files - needsCheck,
  beingRead: 0,
  complete: true,
});

const CEDARLINE = {
  companyKey: "cedarline systems",
  displayName: "Cedarline Systems",
  total: 179,
  needsCheck: 2,
  ready: 176,
  beingRead: 1,
  categories: {
    final_pd: { total: 24, needsCheck: 2, fiscalYears: { "2025": 24 }, checkReasons: { no_writer: 2 } },
    supporting: { total: 150, needsCheck: 0, fiscalYears: { "2025": 150 } },
    company_file: { total: 5, needsCheck: 0, fiscalYears: { none: 5 } },
  },
  company: { via: "name", clientId: "c1", name: "Cedarline Systems", industry: "Software" },
  isNew: false,
};

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    name: `${id}.docx`,
    category: "final_pd",
    status: "pending_review",
    editedLabels: [],
    needsCheck: false,
    checkReasons: [],
    size: 2048,
    fiscalYearEnd: Date.UTC(2025, 2, 31),
    ...extra,
  };
}

const FINAL_PDS = [
  row("pd1", { pdNumber: "1", pdTitle: "Route planning engine", versionCode: "T", versionNumber: 2, writerName: "Dana Whitlock" }),
  row("pd2", { pdNumber: "2", pdTitle: "Yard map solver", versionCode: "T", versionNumber: 1, writerName: "Priya Nair" }),
  row("pd3", { pdNumber: "3", pdTitle: "Sensor data pipeline", versionCode: "T", versionNumber: 3, writerName: "Sam Okafor" }),
  row("pd4", { pdNumber: "4", pdTitle: "Label vision check", needsCheck: true, checkReasons: ["no_writer"] }),
  row("pd5", { pdNumber: "5", pdTitle: "Shelf gap finder", status: "fetched" }),
];
const SUPPORTING = Array.from({ length: 150 }, (_, index) =>
  row(`s${String(index).padStart(3, "0")}`, { name: `Call notes ${index}.docx`, category: "supporting" })
);

const filesArgs = (category: string, tab = "review", onlyToCheck = false) => ({
  tab,
  companyKey: "cedarline systems",
  category,
  onlyToCheck,
});

function seedPage() {
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "review" }, totals(179, 1, 2));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "approved" }, totals(40, 1));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "deleted" }, totals(3, 1));
  for (const onlyToCheck of [false, true]) {
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "review", onlyToCheck }, [CEDARLINE]);
  }
  // The final PDs list five of 24: more are not loaded.
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), FINAL_PDS, { more: true });
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd", "review", true), [FINAL_PDS[3]]);
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("supporting"), SUPPORTING);
  for (const name of ["ingestion:setSheetLabels", "ingestion:removeItems", "ingestion:restoreItems"]) {
    __setMutationHandler(name, changedAll);
  }
}

async function mount() {
  // The page and its bar at the boards' width.
  await page.viewport(1440, 900);
  await render(ToastHarness);
  await render(ImportPage);
  await expect.element(page.getByRole("button", { name: "Cedarline Systems" })).toBeVisible();
}

async function selectOn() {
  await userEvent.click(page.getByRole("button", { name: "Select", exact: true }));
  await expect.poll(() => one("[data-import-select-header]")).not.toBeNull();
}

async function openCedarline() {
  await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
  await expect.poll(() => all("[data-import-file]").length).toBe(5);
}

const fileBox = (id: string) => one(`[data-import-file-select="${id}"]`)!;
const sectionBox = (category: string) => one(`[data-import-section-select="${category}"]`)!;
const bandBox = () => one('[data-import-band-select="cedarline systems"]')!;

describe("selecting files on the Import page", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    viewAs.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __resetAuthState();
    __setPageUrl("/admin/import");
    __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
    __setQueryData("users:getCurrentUser", { _id: "a", role: "admin", firstName: "Jordan", lastName: "Ellis" });
    __setQueryData("ingestion:writerChoices", {
      members: [
        { userId: "u1", label: "Dana Whitlock", writerId: null, linkedWriterId: null },
        { userId: "u2", label: "Priya Nair", writerId: null, linkedWriterId: null },
      ],
      pastWriters: [],
    });
  });

  it("reveals the fixed checkbox column on every row with Select, without shifting any column or file name", async () => {
    seedPage();
    await mount();
    await openCedarline();
    const header = () => all('[data-import-sheet-header] [role="columnheader"]');
    const fixedBefore = header().slice(-5).map(left);
    const yearBefore = left(one('[data-import-file="pd1"] [data-import-cell="fiscal-year"]'));
    const titleBefore = left(one('[data-import-file="pd1"] [data-import-file-prefix]'));
    // Checkboxes sit in the fixed left gutter so hover-to-select never shifts rows.
    expect(one("[data-import-select-header]")).toBeNull();
    expect(getComputedStyle(fileBox("pd1").closest("[data-import-select-cell]")!).opacity).toBe("0");

    await selectOn();
    expect(page.getByRole("button", { name: "Select", exact: true }).element().getAttribute("aria-pressed")).toBe("true");
    // The header keeps its 6 columns; the company, each section and each file row reveal their boxes.
    expect(header()).toHaveLength(6);
    expect(bandBox()).not.toBeNull();
    await expect.poll(() => getComputedStyle(fileBox("pd1").closest("[data-import-select-cell]")!).opacity).toBe("1");
    expect(all("[data-import-section-select]").map((node) => node.dataset.importSectionSelect)).toEqual(["final_pd", "supporting", "company_file"]);
    expect(all("[data-import-file-select]").map((node) => node.dataset.importFileSelect)).toEqual(["pd1", "pd2", "pd3", "pd4", "pd5"]);
    // Zero horizontal shift: every column and file title stays put.
    expect(header().slice(-5).map(left)).toEqual(fixedBefore);
    expect(left(one('[data-import-file="pd1"] [data-import-cell="fiscal-year"]'))).toBeCloseTo(yearBefore, 0);
    expect(left(one('[data-import-file="pd1"] [data-import-file-prefix]'))).toBeCloseTo(titleBefore, 0);
    // Every box lines up at the sheet's left, however deep its row.
    const boxes = [bandBox(), sectionBox("final_pd"), fileBox("pd1")].map(left);
    expect(boxes[1]).toBeCloseTo(boxes[0], 0);
    expect(boxes[2]).toBeCloseTo(boxes[0], 0);
    // The file names sit cleanly past the boxes.
    expect(left(one('[data-import-file="pd1"] [data-import-file-prefix]'))).toBeGreaterThan(boxes[0] + 20);
  });

  it("selects the loaded files of a category, shows some with a dash, and counts in the bar", async () => {
    seedPage();
    await mount();
    await selectOn();
    await openCedarline();
    expect(bar()).toBeNull();

    await userEvent.click(sectionBox("final_pd"));
    // The five listed, never the 19 not loaded: the bar's count is the truth.
    await expect.poll(barCount).toBe("5 files selected");
    expect(sectionBox("final_pd").getAttribute("aria-checked")).toBe("true");
    for (const id of ["pd1", "pd2", "pd3", "pd4", "pd5"]) {
      expect(one(`[data-import-file="${id}"]`)!.hasAttribute("data-import-file-selected"), id).toBe(true);
    }
    // The selected row wash settles smoothly.
    await expect.poll(() => getComputedStyle(one('[data-import-file="pd1"]')!).backgroundColor).toBe(WASH);
    // The company has other sections closed: all its loaded files are selected.
    expect(bandBox().getAttribute("aria-checked")).toBe("true");

    await userEvent.click(fileBox("pd2"));
    await expect.poll(barCount).toBe("4 files selected");
    expect(sectionBox("final_pd").getAttribute("aria-checked")).toBe("mixed");
    expect(bandBox().getAttribute("aria-checked")).toBe("mixed");
    await expect.poll(() => getComputedStyle(one('[data-import-file="pd2"]')!).backgroundColor).not.toBe(WASH);

    // A dash clicked selects them all again; all clicked clears them.
    await userEvent.click(sectionBox("final_pd"));
    await expect.poll(barCount).toBe("5 files selected");
    await userEvent.click(sectionBox("final_pd"));
    await expect.poll(bar).toBeNull();

    // A closed section's box opens it and selects its files when they come.
    await userEvent.click(sectionBox("supporting"));
    await expect.poll(barCount).toBe("150 files selected");
    expect(one('[data-import-section="supporting"]')!.hasAttribute("data-import-section-open")).toBe(true);
  });

  it("keeps the selection through To check and closing the company; a tab change or Select off clears it", async () => {
    seedPage();
    await mount();
    await selectOn();
    await openCedarline();
    await userEvent.click(fileBox("pd1"));
    await userEvent.click(fileBox("pd4"));
    await expect.poll(barCount).toBe("2 files selected");

    await userEvent.click(page.getByRole("checkbox", { name: /^To check/ }));
    await expect.poll(() => __activeQueryArgs("ingestion:sheetCompanies")).toEqual([{ tab: "review", onlyToCheck: true }]);
    await expect.poll(() => all("[data-import-file]").map((node) => node.dataset.importFile)).toEqual(["pd4"]);
    expect(barCount()).toBe("2 files selected");
    expect(fileBox("pd4").getAttribute("aria-checked")).toBe("true");
    await userEvent.click(page.getByRole("checkbox", { name: /^To check/ }));
    await expect.poll(() => all("[data-import-file]").length).toBe(5);

    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
    await expect.poll(() => all("[data-import-file]").length).toBe(0);
    expect(barCount()).toBe("2 files selected");

    // Select off clears it; on again starts empty.
    await userEvent.click(page.getByRole("button", { name: "Select", exact: true }));
    await expect.poll(bar).toBeNull();
    await selectOn();
    await openCedarline();
    expect(all("[data-import-file-selected]")).toHaveLength(0);

    // A tab change turns Select off and clears it.
    await userEvent.click(fileBox("pd1"));
    await expect.poll(barCount).toBe("1 file selected");
    await userEvent.click(page.getByRole("tab", { name: /^Approved/ }));
    await expect.poll(bar).toBeNull();
    // Approved has Select too (2026-11-17, for Send back to review), off after the tab change.
    await expect.element(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(page.getByRole("tab", { name: /^To review/ }));
    await expect.element(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "false");
  });

  it("moves the selection to a category from the bar in runs of at most 100, then clears it", async () => {
    seedPage();
    await mount();
    await selectOn();
    await openCedarline();
    await userEvent.click(sectionBox("supporting"));
    await expect.poll(barCount).toBe("150 files selected");

    const toolbar = page.getByRole("toolbar", { name: "Selected files" });
    expect([...toolbar.element().querySelectorAll("button")].map((node) => node.getAttribute("aria-label") ?? text(node))).toEqual([
      "Category",
      "Fiscal year",
      "More",
      "Approve",
      "Delete",
      "Clear selection",
    ]);
    await userEvent.click(page.getByRole("button", { name: "Category", exact: true }));
    // The six, the files' shared category checked, no confirm until one is picked.
    expect(all("[data-import-bar-category-choice]").map((node) => text(node))).toEqual([
      "Final PD",
      "Draft",
      "Review copy",
      "Transcript",
      "Supporting file",
      "Company file",
    ]);
    expect(one('[data-import-bar-category-choice="supporting"] [aria-label="Now"]')).not.toBeNull();
    expect(one("[data-import-bar-confirm]")).toBeNull();
    await userEvent.click(one('[data-import-bar-category-choice="transcript"]')!);
    // The pick takes the wash (board ao6).
    const picked = one('[data-import-bar-category-choice="transcript"]')!;
    expect(picked.getAttribute("aria-pressed")).toBe("true");
    await expect.poll(() => getComputedStyle(picked).backgroundColor).toBe(WASH);
    const confirm = page.getByRole("button", { name: "Move 150 files to Transcripts" });
    await expect.element(confirm).toBeVisible();
    expect(__mutationCalls("ingestion:setSheetLabels")).toEqual([]);
    await userEvent.click(confirm);

    await expect.poll(() => __mutationCalls("ingestion:setSheetLabels").length).toBe(2);
    const calls = __mutationCalls("ingestion:setSheetLabels") as Array<{ ids: string[]; patch: unknown }>;
    expect(calls.map((call) => call.ids.length)).toEqual([100, 50]);
    expect(calls.flatMap((call) => call.ids)).toEqual(SUPPORTING.map((file) => file._id));
    for (const call of calls) expect(call.patch).toEqual({ category: "transcript" });
    await expect.poll(bar).toBeNull();
    await expect.element(page.getByText("150 files moved to Transcripts")).toBeVisible();
  });

  it("offers Undo for a move when every moved file is on screen, setting each one's category or company back", async () => {
    seedPage();
    __setQueryDataForArgs(
      "ingestion:sheetSearch",
      { tab: "review", text: "halden foods" },
      { files: [], companies: [{ companyKey: "halden foods", displayName: "Halden Foods", total: 98, needsCheck: 0 }] }
    );
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("supporting"), SUPPORTING.slice(0, 3));
    await mount();
    await selectOn();
    await openCedarline();
    await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
    await expect.poll(() => one('[data-import-file="s000"]')).not.toBeNull();
    for (const id of ["pd1", "pd2", "s000"]) await userEvent.click(fileBox(id));

    await userEvent.click(page.getByRole("button", { name: "Category", exact: true }));
    await userEvent.click(one('[data-import-bar-category-choice="draft"]')!);
    await userEvent.click(page.getByRole("button", { name: "Move 3 files to Drafts" }));
    await expect.element(page.getByText("3 files moved to Drafts")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Undo" }));
    // Each file back to the category it had, one call per category.
    await expect.poll(() => __mutationCalls("ingestion:setSheetLabels").slice(1)).toEqual([
      { ids: ["pd1", "pd2"], patch: { category: "final_pd" } },
      { ids: ["s000"], patch: { category: "supporting" } },
    ]);

    // A company move goes back to the company whose band listed the file.
    await userEvent.click(fileBox("pd3"));
    await userEvent.click(page.getByRole("button", { name: "More", exact: true }));
    await userEvent.click(one('[data-import-bar-more-choice="company"]')!);
    await userEvent.fill(page.getByRole("combobox", { name: "Company" }), "halden foods");
    await expect.poll(() => one('[data-import-name-option="Halden Foods"]')).not.toBeNull();
    await userEvent.click(one('[data-import-name-option="Halden Foods"]')!);
    await userEvent.click(page.getByRole("button", { name: "Move 1 file to Halden Foods" }));
    const moved = page.getByText("1 file moved to Halden Foods").element().closest<HTMLElement>("[data-sonner-toast]")!;
    await userEvent.click(moved.querySelector<HTMLElement>("[data-button]")!);
    await expect.poll(() => __mutationCalls("ingestion:setSheetLabels").at(-1)).toEqual({
      ids: ["pd3"],
      patch: { company: "Cedarline Systems" },
    });

    // A selected file no longer on screen (its company closed): what it had is not known, so no Undo.
    await userEvent.click(fileBox("pd4"));
    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
    await expect.poll(() => all("[data-import-file]").length).toBe(0);
    await userEvent.click(page.getByRole("button", { name: "Category", exact: true }));
    await userEvent.click(one('[data-import-bar-category-choice="transcript"]')!);
    await userEvent.click(page.getByRole("button", { name: "Move 1 file to Transcripts" }));
    const noUndo = page.getByText("1 file moved to Transcripts").element().closest<HTMLElement>("[data-sonner-toast]")!;
    expect(noUndo.querySelector("[data-button]")).toBeNull();
  });

  it("opens the bar's year end calendar on the newest year end among the selected files on screen, else last year's Dec 31", async () => {
    seedPage();
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("supporting"), [
      row("old", { name: "Bench data.pdf", category: "supporting", fiscalYearEnd: Date.UTC(2023, 5, 30) }),
      row("mid", { name: "Site notes.pdf", category: "supporting", fiscalYearEnd: Date.UTC(2024, 11, 31) }),
    ]);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("company_file"), [
      row("cf1", { name: "Glossary.docx", category: "company_file", fiscalYearEnd: undefined }),
    ]);
    await mount();
    await selectOn();
    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
    await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
    await userEvent.click(page.getByRole("button", { name: /^Company files/ }));
    await expect.poll(() => one('[data-import-file="cf1"]')).not.toBeNull();
    await expect.poll(() => one('[data-import-file="mid"]')).not.toBeNull();

    for (const id of ["old", "mid", "cf1"]) await userEvent.click(fileBox(id));
    await userEvent.click(page.getByRole("button", { name: "Fiscal year", exact: true }));
    // December 2024, the newest of the year ends selected.
    await expect.poll(() => one('[role="gridcell"][data-value="2024-12-15"]')).not.toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Dec 31", exact: true }));
    await expect.element(page.getByRole("button", { name: "Set the year end to Dec 31, 2024 for 3 files" })).toBeVisible();
    // Mar 31 is in the year on screen too.
    await userEvent.click(page.getByRole("button", { name: "Mar 31", exact: true }));
    await expect.element(page.getByRole("button", { name: "Set the year end to Mar 31, 2024 for 3 files" })).toBeVisible();
    await userEvent.keyboard("{Escape}");

    // Only a file with no year end: last year's Dec 31, never this year's.
    await userEvent.click(page.getByRole("button", { name: "Clear selection" }));
    await userEvent.click(fileBox("cf1"));
    await userEvent.click(page.getByRole("button", { name: "Fiscal year", exact: true }));
    const lastYear = new Date().getFullYear() - 1;
    await expect.poll(() => one(`[role="gridcell"][data-value="${lastYear}-12-15"]`)).not.toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Dec 31", exact: true }));
    await expect.element(page.getByRole("button", { name: `Set the year end to Dec 31, ${lastYear} for 1 file` })).toBeVisible();
  });

  it("stops at a failed run, says how many changed, drops what changed or left the tab, and keeps the rest selected", async () => {
    seedPage();
    let call = 0;
    __setMutationHandler("ingestion:setSheetLabels", (args) => {
      call += 1;
      if (call === 2) throw serverError();
      // One file of the first run was approved elsewhere meanwhile.
      const { ids } = args as Ids;
      return { changed: 99, changedIds: ids.filter((id) => id !== "s042"), skipped: [{ id: "s042", reason: "not_on_tab" }] };
    });
    await mount();
    await selectOn();
    await openCedarline();
    await userEvent.click(sectionBox("supporting"));
    await expect.poll(barCount).toBe("150 files selected");

    await userEvent.click(page.getByRole("button", { name: "Fiscal year", exact: true }));
    // The same calendar; a pick waits for its confirm line. It opens on the
    // selected files' year end (Mar 31, 2025), so Dec 31 is in 2025.
    await userEvent.click(page.getByRole("button", { name: "Dec 31" }));
    const year = 2025;
    const confirm = page.getByRole("button", { name: `Set the year end to Dec 31, ${year} for 150 files` });
    await expect.element(confirm).toBeVisible();
    expect(__mutationCalls("ingestion:setSheetLabels")).toEqual([]);
    await userEvent.click(confirm);

    await expect
      .element(page.getByText("Changed 99 of 150 files. 50 are still selected. Something went wrong. Try again."))
      .toBeVisible();
    await expect.element(page.getByText("1 file is no longer on To review.")).toBeVisible();
    const calls = __mutationCalls("ingestion:setSheetLabels") as Array<{ ids: string[]; patch: unknown }>;
    expect(calls.map((entry) => entry.ids.length)).toEqual([100, 50]);
    expect(calls[0].patch).toEqual({ fiscalYearEnd: Date.UTC(year, 11, 31) });
    // The 99 changed and the one gone leave the selection; the 50 not sent stay.
    await expect.poll(barCount).toBe("50 files selected");
    expect(fileBox("s042").getAttribute("aria-checked")).toBe("false");
    expect(fileBox("s099").getAttribute("aria-checked")).toBe("false");
    expect(fileBox("s100").getAttribute("aria-checked")).toBe("true");
  });

  it("sends each bar action only the files it can change, and says which it left out and why", async () => {
    seedPage();
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("transcript"), [
      row("t1", { name: "Call one.vtt", category: "transcript" }),
      row("t2", { name: "Call two.vtt", category: "transcript" }),
      row("t3", { name: "Call three.vtt", category: "transcript" }),
    ]);
    const withTranscripts = {
      ...CEDARLINE,
      categories: { ...CEDARLINE.categories, transcript: { total: 3, needsCheck: 0, fiscalYears: { "2025": 3 } } },
    };
    for (const onlyToCheck of [false, true]) {
      __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "review", onlyToCheck }, [withTranscripts]);
    }
    __setQueryDataForArgs(
      "ingestion:sheetSearch",
      { tab: "review", text: "halden foods" },
      { files: [], companies: [{ companyKey: "halden foods", displayName: "Halden Foods", total: 98, needsCheck: 0 }] }
    );
    await mount();
    await selectOn();
    await openCedarline();
    await userEvent.click(page.getByRole("button", { name: /^Transcripts/ }));
    await expect.poll(() => one('[data-import-file="t1"]')).not.toBeNull();
    // Four final PDs (one still being read) and three transcripts.
    for (const id of ["pd1", "pd2", "pd4", "pd5", "t1", "t2", "t3"]) await userEvent.click(fileBox(id));
    await expect.poll(barCount).toBe("7 files selected");

    // A science code: final PDs that are read, only.
    await userEvent.click(page.getByRole("button", { name: "More", exact: true }));
    await userEvent.click(one('[data-import-bar-more-choice="scienceCode"]')!);
    await userEvent.fill(page.getByRole("combobox", { name: "Science code" }), "2.02.09");
    await userEvent.click(one('[data-science-code="2.02.09"]')!);
    await expect.element(page.getByRole("button", { name: "Set the science code to 2.02.09 for 3 files" })).toBeVisible();
    expect(text(one("[data-import-bar-left-out]"))).toBe(
      "3 transcripts were left out: a science code only goes on a final PD. 1 final PD was left out: it is still being read."
    );
    await userEvent.click(page.getByRole("button", { name: "Set the science code to 2.02.09 for 3 files" }));
    await expect.poll(() => __mutationCalls("ingestion:setSheetLabels")).toEqual([
      { ids: ["pd1", "pd2", "pd4"], patch: { scienceCode: "2.02.09" } },
    ]);
    await expect.element(page.getByText("Science code set to 2.02.09 for 3 files")).toBeVisible();
    await expect.poll(bar).toBeNull();

    // A year end: every read file; the one being read is left out.
    for (const id of ["pd1", "pd5", "t1"]) await userEvent.click(fileBox(id));
    await userEvent.click(page.getByRole("button", { name: "Fiscal year", exact: true }));
    await userEvent.click(page.getByRole("button", { name: "Dec 31", exact: true }));
    await expect.element(page.getByRole("button", { name: "Set the year end to Dec 31, 2025 for 2 files" })).toBeVisible();
    expect(text(one("[data-import-bar-left-out]"))).toBe("1 final PD was left out: it is still being read.");
    await userEvent.click(page.getByRole("button", { name: /^Set the year end to Dec 31/ }));
    await expect.poll(() => (__mutationCalls("ingestion:setSheetLabels").at(-1) as Ids).ids).toEqual(["pd1", "t1"]);
    await expect.poll(bar).toBeNull();

    // A writer: final PDs, drafts and review copies; none of three transcripts takes one, so there is no confirm.
    for (const id of ["t1", "t2", "t3"]) await userEvent.click(fileBox(id));
    await userEvent.click(page.getByRole("button", { name: "More", exact: true }));
    await userEvent.click(one('[data-import-bar-more-choice="writer"]')!);
    await userEvent.click(one('[data-import-name-option="user:u2"]')!);
    expect(text(one("[data-import-bar-left-out]"))).toBe(
      "3 transcripts were left out: a writer only goes on a final PD, draft or review copy."
    );
    expect(one("[data-import-bar-confirm]")).toBeNull();
    await userEvent.keyboard("{Escape}");

    // Category and company take every file, being read or not.
    await userEvent.click(fileBox("pd5"));
    await userEvent.click(page.getByRole("button", { name: "More", exact: true }));
    await userEvent.click(one('[data-import-bar-more-choice="company"]')!);
    await userEvent.fill(page.getByRole("combobox", { name: "Company" }), "halden foods");
    await expect.poll(() => one('[data-import-name-option="Halden Foods"]')).not.toBeNull();
    await userEvent.click(one('[data-import-name-option="Halden Foods"]')!);
    expect(one("[data-import-bar-left-out]")).toBeNull();
    await expect.element(page.getByRole("button", { name: "Move 4 files to Halden Foods" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(barCount).toBe("4 files selected");
    await userEvent.click(page.getByRole("button", { name: "Category", exact: true }));
    await userEvent.click(one('[data-import-bar-category-choice="draft"]')!);
    expect(one("[data-import-bar-left-out]")).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Move 4 files to Drafts" }));
    await expect.poll(() => (__mutationCalls("ingestion:setSheetLabels").at(-1) as Ids).ids).toEqual(["t1", "t2", "t3", "pd5"]);
  });

  it("sets a writer from More with a confirm line, using the writer picker", async () => {
    seedPage();
    await mount();
    await selectOn();
    await openCedarline();
    await userEvent.click(fileBox("pd1"));
    await userEvent.click(fileBox("pd4"));
    await userEvent.click(page.getByRole("button", { name: "More", exact: true }));
    expect(all("[data-import-bar-more-choice]").map((node) => text(node))).toEqual(["Company", "Writer", "Reviewer", "PD number", "Science code", "Reviewed by CRA"]);
    await userEvent.click(one('[data-import-bar-more-choice="writer"]')!);
    await userEvent.click(one('[data-import-name-option="user:u2"]')!);
    // The picked one is checked in the list.
    expect(one('[data-import-name-option="user:u2"]')?.getAttribute("aria-current")).toBe("true");
    const confirm = page.getByRole("button", { name: "Set the writer to Priya Nair for 2 files" });
    await expect.element(confirm).toBeVisible();
    await userEvent.click(confirm);
    // Set on these files alone (2026-11-16: the writer by who it is, not by name).
    await expect.poll(() => __mutationCalls("ingestion:setSheetLabels")).toEqual([
      { ids: ["pd1", "pd4"], patch: { writer: { kind: "user", userId: "u2" } } },
    ]);
    await expect.poll(bar).toBeNull();
  });

  it("sets one PD number on the selected files from More, by the server's rule, leaving out a file still being read (Greptile fix)", async () => {
    seedPage();
    await mount();
    await selectOn();
    await openCedarline();
    for (const id of ["pd1", "pd4", "pd5"]) await userEvent.click(fileBox(id));
    await userEvent.click(page.getByRole("button", { name: "More", exact: true }));
    await userEvent.click(one('[data-import-bar-more-choice="pdNumber"]')!);
    const search = one("[data-import-name-search]") as HTMLInputElement;
    await expect.poll(() => all("[data-import-name-option]").length).toBe(20);
    await userEvent.fill(search, "100");
    await expect.element(page.getByText("A PD number is 1 to 99, with an optional letter, for example 4 or 12a.")).toBeVisible();
    expect(one("[data-import-bar-confirm]")).toBeNull();
    await userEvent.fill(search, "3");
    await expect.poll(() => all("[data-import-name-option]").map((node) => text(node))).toEqual(["PD 3", "PD 13"]);
    await userEvent.click(one('[data-import-name-option="3"]')!);
    expect(text(one("[data-import-bar-left-out]"))).toBe("1 final PD was left out: it is still being read.");
    const confirm = page.getByRole("button", { name: "Set the PD number to 3 for 2 files" });
    await expect.element(confirm).toBeVisible();
    await userEvent.click(confirm);
    await expect.poll(() => __mutationCalls("ingestion:setSheetLabels")).toEqual([{ ids: ["pd1", "pd4"], patch: { pdNumber: "3" } }]);
    await expect.element(page.getByText("PD number set to 3 for 2 files")).toBeVisible();
    await expect.poll(bar).toBeNull();
  });

  it("deletes the selection after saying nothing changes outside Import, and Undo puts back the same files", async () => {
    seedPage();
    await mount();
    await selectOn();
    await openCedarline();
    for (const id of ["pd1", "pd3", "pd5"]) await userEvent.click(fileBox(id));
    await expect.poll(barCount).toBe("3 files selected");

    await userEvent.click(page.getByRole("button", { name: "Delete", exact: true }));
    await expect.poll(() => text(one("[data-import-delete-note]"))).toBe(
      "Deleting only takes a file out of Import. Nothing changes on anyone's computer or in OneDrive."
    );
    // pd5 is still being read, so it is left out.
    expect(text(one("[data-import-delete-left-out]"))).toBe("1 final PD was left out: it is still being read.");
    expect(__mutationCalls("ingestion:removeItems")).toEqual([]);
    await userEvent.click(page.getByRole("button", { name: "Delete 2 files" }));
    await expect.poll(() => __mutationCalls("ingestion:removeItems")).toEqual([{ ids: ["pd1", "pd3"] }]);
    await expect.element(page.getByText("2 files deleted")).toBeVisible();
    await expect.poll(bar).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Undo" }));
    await expect.poll(() => __mutationCalls("ingestion:restoreItems")).toEqual([{ ids: ["pd1", "pd3"] }]);
  });

  it("puts back with Undo only what a partial delete took out, and drops the rest that left the tab", async () => {
    seedPage();
    // pd3 was approved elsewhere while it was selected.
    __setMutationHandler("ingestion:removeItems", (args) => {
      const { ids } = args as Ids;
      return {
        changed: ids.length - 1,
        changedIds: ids.filter((id) => id !== "pd3"),
        skipped: [{ id: "pd3", reason: "approved" }],
      };
    });
    await mount();
    await selectOn();
    await openCedarline();
    for (const id of ["pd1", "pd2", "pd3"]) await userEvent.click(fileBox(id));
    await userEvent.click(page.getByRole("button", { name: "Delete", exact: true }));
    await userEvent.click(page.getByRole("button", { name: "Delete 3 files" }));
    await expect.element(page.getByText("2 files deleted")).toBeVisible();
    await expect.element(page.getByText("1 file is already approved.")).toBeVisible();
    await expect.poll(bar).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Undo" }));
    await expect.poll(() => __mutationCalls("ingestion:restoreItems")).toEqual([{ ids: ["pd1", "pd2"] }]);
  });

  it("says how far a failed Undo got, without saying anything is still selected", async () => {
    seedPage();
    let call = 0;
    __setMutationHandler("ingestion:restoreItems", (args) => {
      call += 1;
      if (call === 2) throw serverError();
      return changedAll(args);
    });
    await mount();
    await selectOn();
    await openCedarline();
    await userEvent.click(sectionBox("supporting"));
    await expect.poll(barCount).toBe("150 files selected");
    await userEvent.click(page.getByRole("button", { name: "Delete", exact: true }));
    await userEvent.click(page.getByRole("button", { name: "Delete 150 files" }));
    await expect.element(page.getByText("150 files deleted")).toBeVisible();
    await expect.poll(bar).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Undo" }));
    await expect
      .element(page.getByText("Put back 100 of 150 files. The other 50 were not put back. Something went wrong. Try again."))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("still selected");
  });

  it("drops a selected file that leaves its open section, unless another open section lists it", async () => {
    seedPage();
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("supporting"), SUPPORTING.slice(0, 3));
    await mount();
    await selectOn();
    await openCedarline();
    await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
    await expect.poll(() => one('[data-import-file="s000"]')).not.toBeNull();
    for (const id of ["pd1", "pd2", "pd3", "s000"]) await userEvent.click(fileBox(id));
    await expect.poll(barCount).toBe("4 files selected");

    // pd2 was approved elsewhere: the section reads again without it.
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), FINAL_PDS.filter((entry) => entry._id !== "pd2"), { more: true });
    await expect.poll(barCount).toBe("3 files selected");
    expect(one('[data-import-file="pd2"]')).toBeNull();

    // pd3 moved to Supporting files, which is open and lists it: it stays selected.
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), FINAL_PDS.filter((entry) => !["pd2", "pd3"].includes(entry._id)), { more: true });
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("supporting"), [...SUPPORTING.slice(0, 3), { ...FINAL_PDS[2], category: "supporting" }]);
    await expect.poll(() => one('[data-import-section="supporting"] [data-import-file="pd3"]')).not.toBeNull();
    await expect.poll(barCount).toBe("3 files selected");
    expect(fileBox("pd3").getAttribute("aria-checked")).toBe("true");

    // "To check" lists fewer files, but none of them left: the selection stays.
    await userEvent.click(page.getByRole("checkbox", { name: /^To check/ }));
    await expect.poll(() => all("[data-import-file]").map((node) => node.dataset.importFile)).toEqual(["pd4"]);
    expect(barCount()).toBe("3 files selected");
  });

  it("uses up a closed section's request when it lists nothing selectable, so it never selects files later", async () => {
    seedPage();
    // Under "To check" the final PDs section lists only pd4; with it hidden too, it lists nothing.
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd", "review", true), []);
    await mount();
    await selectOn();
    await userEvent.click(page.getByRole("checkbox", { name: /^To check/ }));
    await expect.poll(() => __activeQueryArgs("ingestion:sheetCompanies")).toEqual([{ tab: "review", onlyToCheck: true }]);
    // Ticking the closed company opens it with Final PDs, which list nothing.
    await userEvent.click(bandBox());
    await expect.poll(() => one('[data-import-section="final_pd"]')?.hasAttribute("data-import-section-open")).toBe(true);
    await expect.poll(() => __activeQueryArgs("ingestion:sheetFiles")).toEqual([filesArgs("final_pd", "review", true)]);
    expect(bar()).toBeNull();
    // Later rows there, and another section opened, are not selected by it.
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd", "review", true), [FINAL_PDS[3]]);
    await expect.poll(() => one('[data-import-file="pd4"]')).not.toBeNull();
    await userEvent.click(page.getByRole("checkbox", { name: /^To check/ }));
    await expect.poll(() => all("[data-import-file]").length).toBe(5);
    await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
    await expect.poll(() => all("[data-import-file]").length).toBe(155);
    expect(bar()).toBeNull();
  });

  it("gives each open section of a ticked company its own request, used up as each lists", async () => {
    // The page with no files read yet: every section is still reading.
    __setQueryDataForArgs("ingestion:sheetTotals", { tab: "review" }, totals(179, 1, 2));
    __setQueryDataForArgs("ingestion:sheetTotals", { tab: "approved" }, totals(40, 1));
    __setQueryDataForArgs("ingestion:sheetTotals", { tab: "deleted" }, totals(3, 1));
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "review", onlyToCheck: false }, [CEDARLINE]);
    await mount();
    await selectOn();
    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
    await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
    await expect.poll(() => __activeQueryArgs("ingestion:sheetFiles")).toEqual([filesArgs("final_pd"), filesArgs("supporting")]);

    await userEvent.click(bandBox());
    expect(bar()).toBeNull();
    // Each section selects its own files when they come, in whatever order.
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("supporting"), SUPPORTING);
    await expect.poll(barCount).toBe("150 files selected");
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), FINAL_PDS, { more: true });
    await expect.poll(barCount).toBe("155 files selected");
    // Both requests are used up: a section opened after selects nothing.
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("company_file"), [
      row("cf1", { name: "Glossary.docx", category: "company_file", fiscalYearEnd: undefined }),
    ]);
    await userEvent.click(page.getByRole("button", { name: /^Company files/ }));
    await expect.poll(() => one('[data-import-file="cf1"]')).not.toBeNull();
    expect(fileBox("cf1").getAttribute("aria-checked")).toBe("false");
    expect(barCount()).toBe("155 files selected");
  });

  it("names each checkbox with its company, and a file's with its file name", async () => {
    seedPage();
    await mount();
    await selectOn();
    await openCedarline();
    expect(bandBox().getAttribute("aria-label")).toBe("Select Cedarline Systems");
    expect(sectionBox("final_pd").getAttribute("aria-label")).toBe("Select Final PDs in Cedarline Systems");
    expect(sectionBox("supporting").getAttribute("aria-label")).toBe("Select Supporting files in Cedarline Systems");
    expect(fileBox("pd1").getAttribute("aria-label")).toBe("Select PD 1 Route planning engine (pd1.docx) in Cedarline Systems");
    const names = all("[data-import-select-cell] [aria-label]").map((node) => node.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("lifts its toasts above the bar while the bar shows", async () => {
    seedPage();
    __setMutationHandler("ingestion:setSheetLabels", () => {
      throw serverError();
    });
    await mount();
    await selectOn();
    await openCedarline();
    await userEvent.click(fileBox("pd1"));
    await userEvent.click(page.getByRole("button", { name: "Category", exact: true }));
    await userEvent.click(one('[data-import-bar-category-choice="draft"]')!);
    await userEvent.click(page.getByRole("button", { name: "Move 1 file to Drafts" }));
    // The run failed, so the file stays selected and the bar stays.
    const toastCard = () => page.getByText("Something went wrong. Try again.").element().closest<HTMLElement>("[data-sonner-toast]")!;
    await expect.poll(() => toastCard()).not.toBeNull();
    await expect.poll(barCount).toBe("1 file selected");
    await expect.poll(() => toastCard().getBoundingClientRect().bottom).toBeLessThanOrEqual(bar()!.getBoundingClientRect().top);
    // A menu over the bar opens into that space: the toast steps aside until it closes.
    await userEvent.click(page.getByRole("button", { name: "Category", exact: true }));
    await expect.poll(() => getComputedStyle(toastCard()).visibility).toBe("hidden");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => getComputedStyle(toastCard()).visibility).toBe("visible");
    // When the bar goes, the toast drops back to its place.
    const lifted = toastCard().getBoundingClientRect().bottom;
    await userEvent.click(page.getByRole("button", { name: "Clear selection" }));
    await expect.poll(bar).toBeNull();
    await expect.poll(() => toastCard().getBoundingClientRect().bottom).toBeGreaterThan(lifted);
  });

  it("hides the bar and turns Select off while a search shows", async () => {
    seedPage();
    __setQueryDataForArgs("ingestion:sheetSearch", { tab: "review", text: "ce" }, { companies: [], files: [] });
    await mount();
    await selectOn();
    await openCedarline();
    await userEvent.click(fileBox("pd1"));
    await expect.poll(barCount).toBe("1 file selected");

    await userEvent.fill(page.getByRole("searchbox", { name: "Find a file or company" }), "ce");
    await expect.poll(() => one("[data-import-search-results]")).not.toBeNull();
    await expect.poll(bar).toBeNull();
    const toggle = page.getByRole("button", { name: "Select", exact: true });
    await expect.element(toggle).toBeDisabled();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
    // Search results never offer a checkbox.
    expect(one("[data-import-search-results] [data-import-file-select]")).toBeNull();

    await userEvent.click(page.getByRole("button", { name: "Clear the search" }));
    await expect.poll(barCount).toBe("1 file selected");
    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("puts back a deleted file from its row or the bar, and says why each file is on Deleted", async () => {
    seedPage();
    const deletedBand = { ...CEDARLINE, total: 4, needsCheck: 0, ready: 4, beingRead: 0, categories: { draft: { total: 4, needsCheck: 0, fiscalYears: { "2025": 4 } } } };
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "deleted", onlyToCheck: false }, [deletedBand]);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd", "deleted"), []);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("draft", "deleted"), [
      row("d1", { name: "Plan draft.docx", category: "draft", status: "deleted", deletedReason: "deleted" }),
      row("d2", { name: "Old draft.docx", category: "draft", status: "deleted", deletedReason: "deleted" }),
      row("d3", { name: "Moved draft.docx", category: "draft", status: "rejected", deletedReason: "removed_in_onedrive" }),
      row("d4", { name: "Spare draft.docx", category: "draft", status: "rejected", deletedReason: "rejected" }),
    ]);
    await mount();
    await userEvent.click(page.getByRole("tab", { name: /^Deleted/ }));
    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
    await userEvent.click(page.getByRole("button", { name: /^Drafts/ }));
    await expect.poll(() => all("[data-import-file]").length).toBe(4);

    expect(all("[data-import-file-deleted-reason]").map((node) => text(node))).toEqual([
      "Deleted in Import",
      "Deleted in Import",
      "Removed in OneDrive",
      "Rejected",
    ]);
    // Not editable here; a file a person deleted or rejected can be put back, one removed in OneDrive cannot.
    expect(all("[data-import-file] [data-import-year-edit], [data-import-file] [data-import-row-menu]")).toHaveLength(0);
    expect(all("[data-import-put-back]").map((node) => node.dataset.importPutBack)).toEqual(["d1", "d2", "d4"]);

    await userEvent.click(one('[data-import-put-back="d1"]')!);
    await expect.poll(() => __mutationCalls("ingestion:restoreItems")).toEqual([{ ids: ["d1"] }]);
    await expect.element(page.getByText("1 file put back")).toBeVisible();
    // Select here offers Put back, More (the reviewer and the CRA mark, 2026-11-17) and the X.
    await selectOn();
    // A file removed in OneDrive is selectable for the reviewer and the CRA mark, never put back.
    expect(one('[data-import-file-select="d3"]')).not.toBeNull();
    await userEvent.click(one('[data-import-section-select="draft"]')!);
    await expect.poll(barCount).toBe("4 files selected");
    const toolbar = page.getByRole("toolbar", { name: "Selected files" });
    expect([...toolbar.element().querySelectorAll("button")].map((node) => node.getAttribute("aria-label") ?? text(node))).toEqual([
      "Put back 3 files",
      "More",
      "Clear selection",
    ]);
    // The toast from before sits above the bar now.
    const toastCard = page.getByText("1 file put back").element().closest<HTMLElement>("[data-sonner-toast]")!;
    await expect.poll(() => toastCard.getBoundingClientRect().bottom).toBeLessThanOrEqual(bar()!.getBoundingClientRect().top);
    await userEvent.click(page.getByRole("button", { name: "Put back 3 files" }));
    await expect.poll(() => __mutationCalls("ingestion:restoreItems").at(-1)).toEqual({ ids: ["d1", "d2", "d4"] });
    await expect.poll(bar).toBeNull();
  });

  it("clears the selection with the bar's X", async () => {
    seedPage();
    await mount();
    await selectOn();
    await openCedarline();
    await userEvent.click(fileBox("pd1"));
    await expect.poll(barCount).toBe("1 file selected");
    await userEvent.click(page.getByRole("button", { name: "Clear selection" }));
    await expect.poll(bar).toBeNull();
    expect(fileBox("pd1").getAttribute("aria-checked")).toBe("false");
    // Focus goes to Select, not to the page, as the bar goes.
    expect(document.activeElement).toBe(one("[data-import-select-toggle]"));
    // Select stays on.
    expect(one("[data-import-select-header]")).not.toBeNull();
  });
});


describe("captures", () => {
  // Written to the ignored .vitest-attachments/import-3b/ for review against boards ao4 to ao6.
  const shot = (name: string) => page.screenshot({ path: `../../../../.vitest-attachments/import-3b/${name}.png` });

  beforeEach(() => {
    __resetConvexStub();
    __resetAuthState();
    __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
    __setQueryData("users:getCurrentUser", { _id: "a", role: "admin", firstName: "Jordan", lastName: "Ellis" });
    __setQueryData("ingestion:writerChoices", {
      members: [
        { userId: "u1", label: "Dana Whitlock", writerId: null, linkedWriterId: null },
        { userId: "u2", label: "Priya Nair", writerId: null, linkedWriterId: null },
      ],
      pastWriters: [{ writerId: "w-so", label: "SO", initials: "SO", nameFromDocument: false }],
    });
  });

  it("one file's calendar and pickers, then the selection, its bar and a menu over it", async () => {
    seedPage();
    await mount();
    await openCedarline();
    await userEvent.hover(one('[data-import-file="pd2"]')!);
    await userEvent.click(one('[data-import-file="pd4"] [data-import-year-edit]')!);
    await expect.poll(() => one("[data-date-quick-picks]")).not.toBeNull();
    await shot("calendar");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(one('[data-import-file="pd4"] [data-import-writer-pick]')!);
    await expect.poll(() => all("[data-import-name-option]").length).toBe(3);
    await shot("writer-picker");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(one('[data-import-file="pd1"] [data-import-version-edit]')!);
    await expect.poll(() => one("[data-import-version-menu]")).not.toBeNull();
    await shot("version-menu");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(one('[data-import-file="pd2"] [data-import-row-menu]')!);
    await userEvent.click(page.getByRole("menuitem", { name: "Move to another category" }));
    await expect.poll(() => all("[data-import-move-category]").length).toBe(6);
    await shot("row-menu");
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");

    await selectOn();
    for (const id of ["pd1", "pd3", "pd4"]) await userEvent.click(fileBox(id));
    await userEvent.click(sectionBox("company_file"));
    await expect.poll(barCount).toBe("3 files selected");
    await shot("selected");
    await userEvent.click(page.getByRole("button", { name: "Category", exact: true }));
    await userEvent.click(one('[data-import-bar-category-choice="transcript"]')!);
    await shot("category-menu");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(page.getByRole("button", { name: "Delete", exact: true }));
    await expect.poll(() => one("[data-import-delete-note]")).not.toBeNull();
    await shot("delete-confirm");
  });
});

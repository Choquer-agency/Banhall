import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ImportPage from "./ImportPage.svelte";
import ToastHarness from "$lib/test/ToastHarness.svelte";
import {
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
import { WIDER_TEXT, cellRoom, wordsRoom, wordsWidth } from "$lib/test/textRoom";

/**
 * Reviewers on the Import page and "Reviewed by CRA" (2026-11-17): the
 * Reviewer column after Writer, its picker (the writer's own list), a
 * choice on a file that follows its reviewer initials as a firm-wide pick,
 * a choice on any other file for that file alone, the selection bar's
 * Reviewer and Reviewed by CRA on To review and Deleted, and the quiet CRA
 * tag. Captures at 1280 and 1100 go to .vitest-attachments/import-reviewer/.
 * Made-up companies and people.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];
const one = (selector: string, root: ParentNode = document) => root.querySelector<HTMLElement>(selector);
const fileRow = (id: string) => one(`[data-import-file="${id}"]`)!;
const inRow = (id: string, selector: string) => one(selector, fileRow(id))!;
const bar = () => one("[data-import-selection-bar]");
const box = (node: Element) => node.getBoundingClientRect();

const AMBER = "rgb(168, 80, 15)"; // --color-gap-text
const CAPTURES = "../../../../.vitest-attachments/import-reviewer";

type Ids = { ids: string[] };
const changedAll = (args: unknown) => {
  const { ids } = args as Ids;
  return { changed: ids.length, changedIds: ids, skipped: [] };
};

const totals = (files: number) => ({ files, companies: 1, needsCheck: 0, ready: files, beingRead: 0, complete: true });

const CEDARLINE = {
  companyKey: "cedarline systems",
  displayName: "Cedarline Systems",
  total: 6,
  needsCheck: 1,
  ready: 6,
  beingRead: 0,
  categories: {
    final_pd: { total: 5, needsCheck: 1, fiscalYears: { "2025": 5 }, checkReasons: { unmatched_initials: 1 } },
    supporting: { total: 1, needsCheck: 0, fiscalYears: { "2025": 1 } },
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
    versionCode: "T",
    versionNumber: 1,
    scienceCode: "2.02.09",
    scienceCodeSource: "document",
    ...extra,
  };
}

const FINAL_PDS = [
  // Reviewer from the file name's initials: plain words.
  row("pd1", {
    pdNumber: "1",
    pdTitle: "Label vision check",
    writerName: "Dana Whitlock",
    writerId: "w-dana",
    writerNameSource: "initials",
    writerInitials: "DW",
    reviewerInitials: "PN",
    reviewerName: "Priya Nair",
    reviewerId: "w-priya",
    reviewerHasLogin: true,
    reviewerSource: "initials",
    craReviewed: true,
  }),
  // Reviewer initials two people share: no reviewer, a quiet "Choose reviewer", nothing to check for it.
  row("pd2", { pdNumber: "2", pdTitle: "Yard map solver", writerName: "Sam Okafor", writerId: "w-sam", writerNameSource: "initials", writerInitials: "SO", reviewerInitials: "KT" }),
  // A reviewer a person set on this file.
  row("pd3", {
    pdNumber: "3",
    pdTitle: "Cold chain sensor drift",
    writerName: "DW",
    writerId: "w-dw",
    writerNameSource: "initials",
    writerInitials: "DW",
    reviewerInitials: "PN",
    reviewerName: "Kim Tran",
    reviewerId: "w-kim",
    reviewerSource: "person",
  }),
  // Writer initials two people share: the amber "Choose writer"; no reviewer initials at all.
  row("pd4", { pdNumber: "4", pdTitle: "Shelf life model", writerInitials: "KT", needsCheck: true, checkReasons: ["unmatched_initials"] }),
  // A past writer as reviewer (no login).
  row("pd5", { pdNumber: "5", pdTitle: "Pallet count camera", writerName: "Sam Okafor", writerId: "w-sam", reviewerInitials: "SO", reviewerName: "SO", reviewerId: "w-so", reviewerHasLogin: false, reviewerSource: "initials" }),
];
const SUPPORTING = [row("sup1", { name: "Site notes.pdf", category: "supporting", versionCode: undefined, versionNumber: undefined, scienceCode: undefined })];

const filesArgs = (category: string, tab = "review", onlyToCheck = false) => ({ tab, companyKey: "cedarline systems", category, onlyToCheck });

function seedPage() {
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "review" }, totals(6));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "approved" }, totals(5));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "deleted" }, totals(2));
  for (const onlyToCheck of [false, true]) {
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "review", onlyToCheck }, [CEDARLINE]);
  }
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), FINAL_PDS);
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("supporting"), SUPPORTING);
  for (const name of ["ingestion:setSheetLabels", "ingestion:removeItems", "ingestion:restoreItems", "ingestion:setFileReviewers", "ingestion:setCraReviewed"]) {
    __setMutationHandler(name, changedAll);
  }
  __setMutationHandler("ingestion:matchWriterInitials", (args: unknown) => {
    const { initials } = args as { initials: string };
    return { initials, writerId: "w-priya", writerName: "Priya Nair", previous: null, changed: 3, more: false };
  });
}

async function mount(width = 1440) {
  await page.viewport(width, 900);
  await render(ToastHarness);
  await render(ImportPage);
  await expect.element(page.getByRole("button", { name: "Cedarline Systems" })).toBeVisible();
}

async function openCedarline(count = FINAL_PDS.length) {
  await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
  await expect.poll(() => all("[data-import-file]").length).toBe(count);
}

async function openSupporting() {
  await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
  await expect.poll(() => one('[data-import-file="sup1"]')).not.toBeNull();
}

async function selectOn() {
  await userEvent.click(page.getByRole("button", { name: "Select", exact: true }));
  await expect.poll(() => one("[data-import-select-header]")).not.toBeNull();
}

describe("reviewers on the Import page", () => {
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
        { userId: "u1", label: "Dana Whitlock", writerId: "w-dana", linkedWriterId: null },
        { userId: "u2", label: "Priya Nair", writerId: "w-priya", linkedWriterId: null },
      ],
      pastWriters: [{ writerId: "w-so", label: "SO", initials: "SO" }],
    });
  });

  it("shows a Reviewer column after Writer: a reviewer as plain words, a missing one quietly, never amber", async () => {
    seedPage();
    await mount();
    await openCedarline();
    await openSupporting();
    const header = all('[data-import-sheet-header] [role="columnheader"]').map((node) => text(node));
    expect(header).toEqual(["File", "Fiscal year", "Version", "Writer", "Reviewer", "Science code"]);
    // Each row's Reviewer cell lines up under its header.
    const reviewerHeader = all('[data-import-sheet-header] [role="columnheader"]')[4];
    for (const id of ["pd1", "pd2", "sup1"]) {
      expect(box(inRow(id, '[data-import-cell="reviewer"]')).left).toBeCloseTo(box(reviewerHeader).left, 0);
    }
    expect(text(inRow("pd1", '[data-import-cell="reviewer"]'))).toBe("Priya Nair");
    expect(inRow("pd1", "[data-import-reviewer-tone]").dataset.importReviewerTone).toBe("ink");
    // Initials two people share: "Choose reviewer", muted, not the amber pick control.
    const choose = inRow("pd2", "[data-import-reviewer-choose]");
    expect(text(choose)).toBe("Choose reviewer");
    expect(getComputedStyle(choose).color).not.toBe(AMBER);
    expect(one('[data-import-cell="reviewer"] [data-import-writer-pick]', fileRow("pd2"))).toBeNull();
    // No reviewer initials at all: the same quiet words.
    expect(text(inRow("pd4", "[data-import-reviewer-choose]"))).toBe("Choose reviewer");
    // A supporting file takes no reviewer.
    expect(text(inRow("sup1", '[data-import-cell="reviewer"]'))).toBe("");
    // The name each control says starts with its words.
    expect(inRow("pd1", "[data-import-reviewer-edit]").getAttribute("aria-label")).toBe(
      "Reviewer Priya Nair, from the initials PN. Change the reviewer for PN"
    );
    expect(inRow("pd3", "[data-import-reviewer-edit]").getAttribute("aria-label")).toBe("Reviewer Kim Tran. Change the reviewer");
  });

  it("shows Reviewed by CRA as a quiet tag on the row, and the row's ... sets and clears it", async () => {
    seedPage();
    await mount();
    await openCedarline();
    const tag = inRow("pd1", "[data-import-file-cra]");
    // Short on a laptop window, with the whole words on hover and for screen readers.
    expect(tag.getAttribute("title")).toBe("Reviewed by CRA");
    expect(text(one(".sr-only", tag))).toBe("Reviewed by CRA");
    // Full-width Import sheet (no Admin sidebar) gives the File cell room for the full label beside the title.
    expect(getComputedStyle(inRow("pd1", "[data-import-file-cra-words]")).display).not.toBe("none");
    expect(box(inRow("pd1", "[data-import-file-title]")).width).toBeGreaterThan(80);
    expect(getComputedStyle(tag).color).not.toBe(AMBER);
    expect(getComputedStyle(tag).fontWeight).toBe("400");
    expect(one("[data-import-file-cra]", fileRow("pd2"))).toBeNull();
    // The tag sits after the name, inside the File cell.
    expect(box(tag).right).toBeLessThanOrEqual(box(inRow("pd1", '[data-import-cell="file"]')).right);

    await userEvent.click(inRow("pd1", "[data-import-row-menu]"));
    await userEvent.click(page.getByRole("menuitem", { name: 'Clear "Reviewed by CRA"' }));
    await expect.poll(() => __mutationCalls("ingestion:setCraReviewed")).toEqual([{ ids: ["pd1"], reviewed: false }]);
    await expect.element(page.getByText('Cleared "Reviewed by CRA"', { exact: true })).toBeVisible();
    await userEvent.click(inRow("pd2", "[data-import-row-menu]"));
    await userEvent.click(page.getByRole("menuitem", { name: "Mark as reviewed by CRA" }));
    await expect.poll(() => __mutationCalls("ingestion:setCraReviewed").at(-1)).toEqual({ ids: ["pd2"], reviewed: true });
    // A supporting file's menu has no such item.
    await openSupporting();
    await userEvent.click(inRow("sup1", "[data-import-row-menu]"));
    await expect.element(page.getByRole("menuitem", { name: "Move to another company" })).toBeVisible();
    expect(one('[data-import-row-action="cra"]')).toBeNull();
    await userEvent.keyboard("{Escape}");
  });

  it("opens the writer's own picker for the reviewer: team members, then past writers with No login", async () => {
    seedPage();
    await mount();
    await openCedarline();
    await userEvent.click(inRow("pd2", "[data-import-reviewer-edit]"));
    await expect.poll(() => all("[data-import-name-option]").map((node) => text(node.querySelector("span")))).toEqual([
      "Dana Whitlock",
      "Priya Nair",
      "SO",
    ]);
    expect(one("[data-import-name-search]")?.getAttribute("placeholder")).toBe("Find or type a reviewer");
    expect(text(one('[data-import-name-option="writer:w-so"]'))).toContain("No login");
    await userEvent.keyboard("{Escape}");
    // The current reviewer is checked.
    await userEvent.click(inRow("pd1", "[data-import-reviewer-edit]"));
    await expect.poll(() => one('[data-import-name-option="user:u2"]')?.getAttribute("aria-current")).toBe("true");
    await userEvent.keyboard("{Escape}");
  });

  it("makes a choice on a file that follows its reviewer initials a pick for the whole firm, with Undo", async () => {
    seedPage();
    await mount();
    await openCedarline();
    await userEvent.click(inRow("pd2", "[data-import-reviewer-edit]"));
    await userEvent.click(one('[data-import-name-option="user:u2"]')!);
    await expect.poll(() => __mutationCalls("ingestion:matchWriterInitials")).toEqual([
      { initials: "KT", writer: { kind: "user", userId: "u2" } },
    ]);
    await expect.element(page.getByText("KT is Priya Nair on 3 files")).toBeVisible();
    expect(__mutationCalls("ingestion:setFileReviewers")).toEqual([]);
  });

  it("says the reviewer could not be saved when a pick from the Reviewer cell fails", async () => {
    seedPage();
    __setMutationHandler("ingestion:matchWriterInitials", () => {
      throw new Error("[CONVEX M(ingestion:matchWriterInitials)] Server Error");
    });
    await mount();
    await openCedarline();
    await userEvent.click(inRow("pd2", "[data-import-reviewer-edit]"));
    await userEvent.click(one('[data-import-name-option="user:u2"]')!);
    await expect.element(page.getByText("The reviewer could not be saved.")).toBeVisible();
  });

  it("sets a file's reviewer alone when a person set it before, or the file has no reviewer initials", async () => {
    seedPage();
    await mount();
    await openCedarline();
    await userEvent.click(inRow("pd3", "[data-import-reviewer-edit]"));
    await userEvent.click(one('[data-import-name-option="user:u1"]')!);
    await expect.poll(() => __mutationCalls("ingestion:setFileReviewers")).toEqual([{ ids: ["pd3"], reviewer: { kind: "user", userId: "u1" } }]);
    await userEvent.click(inRow("pd4", "[data-import-reviewer-edit]"));
    await userEvent.click(one('[data-import-name-option="writer:w-so"]')!);
    await expect.poll(() => __mutationCalls("ingestion:setFileReviewers").at(-1)).toEqual({ ids: ["pd4"], reviewer: { kind: "writer", writerId: "w-so" } });
    expect(__mutationCalls("ingestion:matchWriterInitials")).toEqual([]);
  });

  it("sets the reviewer and the CRA mark from the selection bar, sending only the files they go on", async () => {
    seedPage();
    await mount();
    await selectOn();
    await openCedarline();
    for (const id of ["pd1", "pd2"]) await userEvent.click(one(`[data-import-file-select="${id}"]`)!);
    await openSupporting();
    await expect.poll(() => one('[data-import-file-select="sup1"]')).not.toBeNull();
    await userEvent.click(one('[data-import-file-select="sup1"]')!);

    await userEvent.click(page.getByRole("button", { name: "More", exact: true }));
    await userEvent.click(one('[data-import-bar-more-choice="reviewer"]')!);
    await userEvent.click(one('[data-import-name-option="user:u2"]')!);
    expect(text(one("[data-import-bar-left-out]"))).toBe(
      "1 supporting file was left out: a reviewer only goes on a final PD, draft or review copy."
    );
    await userEvent.click(page.getByRole("button", { name: "Set the reviewer to Priya Nair for 2 files" }));
    // Set on these files alone, never a pick.
    await expect.poll(() => __mutationCalls("ingestion:setFileReviewers")).toEqual([{ ids: ["pd1", "pd2"], reviewer: { kind: "user", userId: "u2" } }]);
    expect(__mutationCalls("ingestion:matchWriterInitials")).toEqual([]);
    await expect.poll(bar).toBeNull();

    for (const id of ["pd2", "sup1"]) await userEvent.click(one(`[data-import-file-select="${id}"]`)!);
    await userEvent.click(page.getByRole("button", { name: "More", exact: true }));
    await userEvent.click(one('[data-import-bar-more-choice="craReviewed"]')!);
    await userEvent.click(one('[data-import-bar-cra-choice="mark"]')!);
    expect(text(one("[data-import-bar-left-out]"))).toBe("1 supporting file was left out: only a final PD is marked as reviewed by CRA.");
    await userEvent.click(page.getByRole("button", { name: "Mark 1 file as reviewed by CRA" }));
    await expect.poll(() => __mutationCalls("ingestion:setCraReviewed")).toEqual([{ ids: ["pd2"], reviewed: true }]);
    await expect.element(page.getByText("1 file marked as reviewed by CRA")).toBeVisible();
  });

  it("lets the reviewer be set on Deleted, by row and from the bar, and on Approved for one file alone", async () => {
    seedPage();
    const deletedBand = { ...CEDARLINE, total: 2, needsCheck: 0, categories: { final_pd: { total: 2, needsCheck: 0, fiscalYears: { "2025": 2 } } } };
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "deleted", onlyToCheck: false }, [deletedBand]);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd", "deleted"), [
      row("d1", { pdNumber: "6", pdTitle: "Old route model", status: "deleted", deletedReason: "deleted", reviewerInitials: "KT" }),
      row("d2", { pdNumber: "7", pdTitle: "Old yard map", status: "rejected", deletedReason: "rejected", reviewerName: "SO", reviewerId: "w-so", reviewerSource: "initials", reviewerInitials: "SO" }),
    ]);
    const approvedBand = { ...CEDARLINE, total: 1, needsCheck: 0, categories: { final_pd: { total: 1, needsCheck: 0, fiscalYears: { "2025": 1 } } } };
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "approved", onlyToCheck: false }, [approvedBand]);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd", "approved"), [
      row("a1", { pdNumber: "8", pdTitle: "Approved plan", status: "approved", reviewerName: "Priya Nair", reviewerId: "w-priya", reviewerInitials: "PN", craReviewed: true }),
      row("a2", { pdNumber: "9", pdTitle: "Approved no reviewer", status: "approved", reviewerInitials: "KT" }),
    ]);
    await mount();

    await userEvent.click(page.getByRole("tab", { name: /^Deleted/ }));
    await openCedarline(2);
    expect(text(inRow("d1", "[data-import-reviewer-choose]"))).toBe("Choose reviewer");
    await userEvent.click(inRow("d2", "[data-import-reviewer-edit]"));
    await userEvent.click(one('[data-import-name-option="user:u1"]')!);
    // d2 follows its initials: a pick for SO.
    await expect.poll(() => __mutationCalls("ingestion:matchWriterInitials")).toEqual([{ initials: "SO", writer: { kind: "user", userId: "u1" } }]);
    await selectOn();
    for (const id of ["d1", "d2"]) await userEvent.click(one(`[data-import-file-select="${id}"]`)!);
    await userEvent.click(page.getByRole("button", { name: "More", exact: true }));
    expect(all("[data-import-bar-more-choice]").map((node) => text(node))).toEqual(["Reviewer", "Reviewed by CRA"]);
    await userEvent.click(one('[data-import-bar-more-choice="reviewer"]')!);
    await userEvent.click(one('[data-import-name-option="user:u2"]')!);
    await userEvent.click(page.getByRole("button", { name: "Set the reviewer to Priya Nair for 2 files" }));
    await expect.poll(() => __mutationCalls("ingestion:setFileReviewers")).toEqual([{ ids: ["d1", "d2"], reviewer: { kind: "user", userId: "u2" } }]);
    await expect.poll(bar).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Select", exact: true }));

    await userEvent.click(page.getByRole("tab", { name: /^Approved/ }));
    await openCedarline(2);
    // 2026-11-17 (edit after approval): the same picker, for that file alone,
    // never a pick for its initials and never the bar's setFileReviewers.
    expect(text(inRow("a1", '[data-import-cell="reviewer"]'))).toBe("Priya Nair");
    expect(text(inRow("a2", '[data-import-cell="reviewer"]'))).toBe("Choose reviewer");
    expect(inRow("a1", "[data-import-file-cra]").getAttribute("title")).toBe("Reviewed by CRA");
    __setMutationHandler("ingestion:editApprovedFile", () => ({ changed: ["reviewer"], brainUpdated: false }));
    await userEvent.click(inRow("a2", "[data-import-reviewer-edit]"));
    await userEvent.click(one('[data-import-name-option="user:u1"]')!);
    await expect.poll(() => __mutationCalls("ingestion:editApprovedFile")).toEqual([
      { id: "a2", patch: { reviewer: { kind: "user", userId: "u1" } } },
    ]);
    expect(__mutationCalls("ingestion:matchWriterInitials")).toHaveLength(1);
    expect(__mutationCalls("ingestion:setFileReviewers")).toHaveLength(1);
  });

  for (const width of [1280, 1100]) {
    it(`keeps every column readable with Reviewer at ${width}px, and captures it`, async () => {
      seedPage();
      await mount(width);
      await openCedarline();
      const scroller = one("[data-import-sheet]")!;
      // It fits: nothing to scroll sideways.
      expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
      for (const id of ["pd1", "pd2", "pd3", "pd4", "pd5"]) {
        const cells = all(':scope > [role="cell"]', fileRow(id));
        for (const [index, cell] of cells.entries()) {
          const next = cells[index + 1];
          if (next) expect(box(cell).right, `${id} cell ${index}`).toBeLessThanOrEqual(box(next).left + 0.5);
          for (const node of all("*", cell).filter((child) => !child.closest(".sr-only") && box(child).width > 0)) {
            expect(box(node).right, `${id} cell ${index} ${text(node)}`).toBeLessThanOrEqual(box(cell).right + 0.5);
          }
        }
        // The reviewer cell has real room: at least 102px.
        expect(box(inRow(id, '[data-import-cell="reviewer"]')).width).toBeGreaterThanOrEqual(101);
      }
      // The required amber "Choose writer" is whole, and so are a full name and "Choose reviewer".
      await document.fonts.ready;
      const whole = (node: HTMLElement) => node.scrollWidth <= node.clientWidth;
      const writerCell = inRow("pd4", '[data-import-cell="writer"]');
      const chooseWriter = one("span", inRow("pd4", "[data-import-writer-pick]"))!;
      expect(text(chooseWriter)).toBe("Choose writer");
      expect(whole(chooseWriter), "Choose writer").toBe(true);
      expect(box(inRow("pd4", "[data-import-writer-pick]")).right).toBeLessThanOrEqual(box(writerCell).right);
      // With room to spare: the pick control can take the cell's whole width,
      // and its words would still be whole drawn 8% wider (Linux, Windows).
      expect(wordsWidth(chooseWriter) * WIDER_TEXT, "Choose writer 8% wider").toBeLessThanOrEqual(wordsRoom(chooseWriter, cellRoom(writerCell)));
      const dana = one("[data-import-writer-tone]", fileRow("pd1"))!;
      expect(text(dana)).toBe("Dana Whitlock");
      expect(whole(dana), "Dana Whitlock").toBe(true);
      const danaButton = inRow("pd1", "[data-import-writer-edit]");
      expect(wordsWidth(dana) * WIDER_TEXT, "Dana Whitlock 8% wider").toBeLessThanOrEqual(wordsRoom(dana, box(danaButton).width));
      // The quiet "Choose reviewer" is whole at 1280, and cut at 1100 with its words on hover.
      const chooseReviewer = inRow("pd2", "[data-import-reviewer-choose]");
      if (width >= 1280) expect(whole(chooseReviewer), "Choose reviewer").toBe(true);
      expect(chooseReviewer.getAttribute("title")).toBe("Choose reviewer");
      const priya = one("[data-import-reviewer-tone]", fileRow("pd1"))!;
      expect(text(priya)).toBe("Priya Nair");
      expect(whole(priya), "Priya Nair").toBe(true);
      const priyaButton = inRow("pd1", "[data-import-reviewer-edit]");
      expect(wordsWidth(priya) * WIDER_TEXT, "Priya Nair 8% wider").toBeLessThanOrEqual(wordsRoom(priya, box(priyaButton).width));
      // The science code shows whole, at least.
      expect(whole(inRow("pd1", "[data-import-code]")), "code").toBe(true);
      await page.screenshot({ path: `${CAPTURES}/import-reviewer-${width}.png` });
      // The picker open on a file with no reviewer, inside the window.
      await userEvent.click(inRow("pd2", "[data-import-reviewer-edit]"));
      await expect.poll(() => all("[data-import-name-option]").length).toBe(3);
      for (const node of all("[data-import-name-option]")) expect(box(node).right).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${CAPTURES}/import-reviewer-picker-${width}.png` });
      await userEvent.keyboard("{Escape}");
      // The bar's More with Reviewer, PD number and Reviewed by CRA.
      await selectOn();
      await userEvent.click(one('[data-import-file-select="pd1"]')!);
      // With Select on a PD's title keeps reasonable room: about ten letters.
      for (const id of ["pd2", "pd3", "pd5"]) {
        const title = inRow(id, "[data-import-file-title]");
        expect(Math.min(title.scrollWidth, box(title).width), id).toBeGreaterThanOrEqual(Math.min(title.scrollWidth, 74));
      }
      await userEvent.click(page.getByRole("button", { name: "More", exact: true }));
      await expect.poll(() => all("[data-import-bar-more-choice]").length).toBe(6);
      await page.screenshot({ path: `${CAPTURES}/import-reviewer-bar-${width}.png` });
      await userEvent.keyboard("{Escape}");
    });
  }
});
